---
paths:
  - "src/database/**/*.ts"
---

# Database Rules

## Schema initialization safety
- **NEVER add constraints/indexes to the main `createTables()` SQL block** if existing data might violate them
- Adding a UNIQUE index on a table with duplicates will fail, and if it's in the same SQL block as table creation, it **kills the entire DB connection** — no affinity, no logging, no halloffame, NOTHING
- **Always** put new constraints/indexes in a **separate try/catch** after the main schema block
- **Always** deduplicate existing data BEFORE creating a UNIQUE constraint
- Test schema migrations against synthetic rows that include duplicates, missing users and older column types.

```typescript
// ✅ GOOD — separate try/catch, dedup first, non-fatal
try {
  await pool.query(`DELETE FROM table a USING table b WHERE a.id > b.id AND a.key = b.key`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ... ON table (key)`);
} catch (err) {
  console.error('Index creation failed (non-fatal):', err.message);
}

// ❌ BAD — inside main schema block, takes down everything if it fails
await pool.query(`
  CREATE TABLE IF NOT EXISTS ...;
  CREATE UNIQUE INDEX IF NOT EXISTS ... ON table (key);  -- BOOM if duplicates exist
`);
```

## Write rules
- **NEVER use plain `UPDATE` for guild-scoped user data** — the row may not exist on newer servers
- **ALWAYS use `INSERT ... ON CONFLICT DO UPDATE` (upsert)** when writing per-user data
- **Use REAL (not INTEGER) for columns that receive fractional values** — INTEGER silently truncates 0.25 to 0
- **ALWAYS use explicit `::REAL` casts and float literals (`50.0` not `50`) in SQL expressions with REAL columns** — PostgreSQL infers parameter types from context, and `50 + $3` makes it think `$3` is integer, rejecting `"0.5"` even if the column is REAL
- **NEVER put schema migrations (ALTER COLUMN) in the main multi-statement SQL block** — if any statement in the block fails, the entire implicit transaction rolls back, undoing the ALTER. Always use a separate `try/catch` query.
- This applies to normal writes with `(server_id, user_id)` keys. Derived profile refresh is an intentional exception: conditional UPDATE must never recreate a deleted user, and must reject a changed source snapshot.

```typescript
// ✅ GOOD — float literals + explicit REAL cast
await pool.query(
  `UPDATE users SET affinity = COALESCE(users.affinity, 50.0) + $3::REAL
   WHERE server_id = $1 AND user_id = $2`,
  [guildId, userId, 0.5]
);

// ❌ BAD — integer literal 50 makes PostgreSQL infer $3 as integer
await pool.query(
  `UPDATE users SET affinity = COALESCE(users.affinity, 50) + $3
   WHERE server_id = $1 AND user_id = $2`,
  [guildId, userId, 0.5]  // ERROR: invalid input syntax for type integer: "0.5"
);

// ✅ GOOD — ALTER in separate try/catch
try {
  await pool.query('ALTER TABLE users ALTER COLUMN col TYPE REAL USING col::REAL');
} catch (err) {
  console.error('Migration failed (non-fatal):', err.message);
}

// ❌ BAD — ALTER inside main schema block (rolled back if anything else fails)
await pool.query(`
  CREATE TABLE IF NOT EXISTS ...;
  ALTER TABLE users ALTER COLUMN col TYPE REAL;  -- rolled back if later statement fails
`);
```

## Connection
- Always use parameterized queries (`$1, $2, $3`) — NEVER string concatenation for SQL
- The database module fails silently without `DATABASE_URL` — local dev works without Postgres
- Use Railway's private `DATABASE_URL` (internal network, no egress fees), NOT `DATABASE_PUBLIC_URL`
- **Disable public networking** on Railway Postgres when not debugging — exposed URLs are a security risk

## Logging
- Log ALL interactions (mentions, auto-sass, slash commands) with full context
- Include mood state at time of interaction where required by the logging schema
- Use `.catch((err) => console.error())` on log calls — logging failures should never crash the bot

## Shutdown
- `closeDatabase()` is called during graceful shutdown — if you add new pool resources, close them there too
