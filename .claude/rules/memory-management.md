# Memory Management Rules

These rules prevent memory leaks that degrade performance over days/weeks of uptime.

## Hard Requirements
- EVERY `Map` or `Set` that stores per-channel, per-user, or per-message data MUST have a bounded size or cleanup mechanism
- Choose one cleanup strategy:
  1. **Max size cap** — evict oldest entries when size exceeds limit
  2. **Periodic cleanup** — `setInterval()` that removes expired entries
  3. **Natural expiration** — entries are removed as part of normal flow (e.g., battle ends → delete from map)

## Patterns
```javascript
// ✅ GOOD — max size cap with eviction
const map = new Map();
const MAX_SIZE = 500;
map.set(key, value);
if (map.size > MAX_SIZE) {
  const oldest = map.keys().next().value;
  map.delete(oldest);
}

// ✅ GOOD — periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of cooldowns) {
    if (now - ts > EXPIRY_MS) cooldowns.delete(id);
  }
}, 5 * 60 * 1000);

// ❌ BAD — grows forever
const counters = new Map();
counters.set(channelId, count); // never cleaned up
```
