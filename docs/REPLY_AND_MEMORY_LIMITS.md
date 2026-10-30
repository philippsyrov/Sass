# Reply and memory limits

| Area | Current limit |
|---|---|
| Claude and recognized reasoning output, including thinking | 16,384 tokens by default |
| Ordinary API or native Ollama output | 4,096 tokens by default |
| Mention context | 25 recent channel messages |
| Auto-sass context | 20 recent messages |
| Rolling buffer | 30 messages per channel |
| Compacted summary | 300 characters; expires after one hour |
| Retrieved semantic memories | 3 normally; 8 for history questions |
| Raw remembered facts | Last 20 per person per server |
| Raw roast topics | Last 5 per person per server |
| Roast vector memories | Newest 100 per person per server after cleanup; older than 90 days pruned |
| Fact, statement and quote vector memories | No automatic count or age cap |
| Total database | No global byte or row quota |

The application assembles profiles, facts, retrieved memories, recent messages and system instructions; it has no single input-token budget. `SASS_REPLY_MAX_TOKENS` can override the default output budget within the limits described in [configuration](CONFIGURATION.md). A larger output budget does not require longer visible replies.
