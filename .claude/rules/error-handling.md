# Error Handling Rules

These rules apply to ALL source files. Violations of these rules have caused production crashes.

## Hard Requirements
- NEVER use `.catch(() => {})` — always log the error: `.catch((err) => console.error('Context:', err.message))`
- NEVER access a property without null-checking first — use optional chaining (`?.`) or explicit `if` checks
- NEVER call `.toLowerCase()`, `.trim()`, or any string method on a value that could be `undefined` or `null`
- EVERY `async` function that performs I/O (Discord API, OpenAI API, database, file system) MUST have error handling

## Patterns
```javascript
// ✅ GOOD — error is logged with context
storeMemory(userId, 'fact', fact).catch((err) => console.error('Vector store failed:', err.message));

// ❌ BAD — error silently swallowed, impossible to debug
storeMemory(userId, 'fact', fact).catch(() => {});

// ✅ GOOD — null-safe property access
const name = this.users[userId]?.name?.toLowerCase();
if (!name) return false;

// ❌ BAD — crashes if user doesn't exist or name is undefined
const name = this.users[userId].name.toLowerCase();
```

## Database Write Rules (CRITICAL — caused a production bug)
- NEVER use plain `UPDATE` for guild-scoped user data — the row may not exist yet on newer servers
- ALWAYS use `INSERT ... ON CONFLICT DO UPDATE` (upsert) when writing per-user data
- This applies to normal writes with `(server_id, user_id)` keys. Derived profile refresh deliberately uses a conditional UPDATE: it must not recreate a deleted user or mark changed source data as fresh. See database.md.

```sql
-- ✅ GOOD — upsert, works even if user row doesn't exist yet
INSERT INTO users (server_id, user_id, name, affinity, last_seen)
VALUES ($1, $2, '', 50 + $3, NOW())
ON CONFLICT (server_id, user_id) DO UPDATE SET
  affinity = GREATEST(0, LEAST(100, COALESCE(users.affinity, 50) + $3)),
  last_seen = NOW();

-- ❌ BAD — silently updates 0 rows if user has no row in this guild
UPDATE users SET affinity = affinity + $3
WHERE server_id = $1 AND user_id = $2;
```
