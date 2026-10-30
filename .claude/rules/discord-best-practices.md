---
paths:
  - "src/**/*.ts"
---

# Discord.js Best Practices

## Interaction Replies
- Call `deferReply()` BEFORE any async operation that might take >2 seconds (AI API calls, database queries, member fetches)
- After deferring, use `editReply()` not `reply()`
- Always check `interaction.replied || interaction.deferred` before sending error responses
- Wrap `message.reply()` and `interaction.editReply()` in try/catch — the message/channel may have been deleted

## One Instance Rule
- NEVER run two bot instances on the same Discord token — causes double responses and double API costs
- The dedup guard in `index.ts` prevents duplicate message processing but does NOT protect against two separate processes

## Graceful Shutdown
- `index.ts` handles SIGTERM/SIGINT — if you add new persistent resources (database pools, file handles, intervals), clean them up in the shutdown handler

## Message Handling
- Buffer ALL messages (including bot's own) for conversation context
- Check `message.author.bot` early to skip bot messages
- Use the dedup guard (`isDuplicate()`) before processing any user message
- The name detection regex (`/\bsass\b/i`) will match the bot's own @mention markup — the dedup guard and bot check prevent this, but be careful when modifying message flow
