# Privacy and your data

Per server, Sass stores display names, affinity, remembered facts, vector embeddings, roast and quote history, beef records and interaction logs. It's for jokes and context, not a compliance-certified datastore.

## /forgetme

**`/forgetme`** (with confirmation) deletes **your** server-scoped data: profile, facts, embeddings, beefs, pair stats, quotes, interaction logs, your reactions and command usage, plus in-memory cooldowns.

Server mood and other users' data stay. Pending writes from events already in progress are invalidated; profile generation cannot recreate a deleted user. Deletion uses one transaction, and an unsuccessful deletion is reported rather than confirmed.

This is a deletion action, not a persistent opt-out. New activity can create new memories, including a new reaction to an older Discord message. It does not delete Discord messages or purge channel conversation context and backups. The in-flight guard assumes one bot process per token; it is not a distributed lock. Don't paste passwords into her chat.

## Local memory search

Normal local bundles include the required memory model. The installer shows the source, destination and verified release download size before the initial consent. An embedding process runs locally, separate from the bot's native image libraries. Chat credentials are not passed to that process. Expert source setup has a separate explicit preparation step; it never downloads weights from doctor or ordinary runtime checks.

New local bundles select text-only EmbeddingGemma 2 (`onnx-community/embeddinggemma-2-ONNX`) at a pinned revision with q8 weights and 768-dimensional vectors. Existing explicit model selections remain separate. See [release bundle details](RELEASE_BUNDLES.md) for bundle contents and model terms.

New vector rows record their embedding space. Old rows with no known model stay stored and readable as raw memories. Search and duplicate removal exclude those old vectors. Sass does not automatically re-embed them. You can select OpenAI or Ollama through `sass settings` or `.env` (`SASS_EMBEDDING_PROVIDER`); `off` disables vector writes and semantic search.

Local model inference stays on this machine. Stored facts and vectors go to the selected Postgres database, which can be local or hosted. Chat requests send relevant message content and context, including retrieved memories, to the configured chat provider; image requests may also send image URLs or image data. Optional cloud embeddings send text to the configured embedding service. Provider retention and use are governed by that provider’s terms.

## Be nice-ish

Sass is mean on purpose, not a harassment tool. Don't use her to dogpile people or automate bullying. You're responsible for your server and your API keys.
