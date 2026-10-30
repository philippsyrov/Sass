# Configuration

The normal Mac bundle setup writes `.env` for you. For source or advanced configuration, start from `.env.example`. `.env` is git-ignored. Never commit real tokens.

## Environment variables

| variable | what | default |
| --- | --- | --- |
| `DISCORD_TOKEN` | bot token | required |
| `CLIENT_ID` | application ID (slash command registration) | required |
| `CREATOR_ID` | instance owner ID for restricted test/admin tools; does not change personality | optional |
| `AI_PROVIDER` | `openai` (any OpenAI-compatible API) or `ollama`, lowercase | `ollama` if unset (`.env.example` sets `openai`) |
| `OPENAI_API_KEY` | OpenAI-compatible chat key; also the fallback key for API embeddings | required for `openai` chat; local memory needs no API key |
| `OPENAI_BASE_URL` | API base for chat; also the fallback host for API embeddings | OpenAI |
| `OPENAI_MODEL` | chat model | `gpt-5.4-mini` if unset (`.env.example` sets `gpt-4o-mini`) |
| `OLLAMA_HOST` | Ollama URL | `http://localhost:11434` |
| `OLLAMA_MODEL` | Ollama model | `llama3.1:8b` |
| `SASS_EMBEDDING_PROVIDER` | `local`, `openai`, `ollama` or `off` | normal setup selects local; unset keeps the legacy API path |
| `LOCAL_EMBED_MODEL` | Exact local embedding model saved by setup | pinned EmbeddingGemma 2 for new local setup |
| `EMBEDDING_DIMENSION` | Dimension of the saved local model | `768` for EmbeddingGemma; `384` for MiniLM |
| `OPENAI_EMBEDDING_MODEL` | Model served by the selected API embedding host | `text-embedding-3-small` |
| `SASS_EMBEDDED_PG` | `1` = local Postgres (data in `.sass-data/`) | `1` after setup |
| `DATABASE_URL` | Hosted Postgres URL (Railway, Neon, …) | empty when embedded is on |
| `AUTO_SASS_CHANCE` | 0–1 probability of jumping in unprompted | `0.55` if unset (`.env.example` sets `0.4`) |
| `AUTO_SASS_MIN_MESSAGES` | messages a channel needs since her last pop-in before she rolls | `2` |

How these are used: [PERSONALITY.md](PERSONALITY.md).

## Discord intents

> [!IMPORTANT]
> Sass connects with two **Privileged Gateway Intents**: **Presence Intent** and **Message Content Intent**. Turn both on in the Developer Portal → your app → **Bot** → **Privileged Gateway Intents**, and save. Without them Discord refuses the login ("Used disallowed intents") and she never comes online. Server Members Intent is not used.

## AI providers

**First run:** use the recommended API chat model offered by setup. Ollama and LM Studio (`openai` + local `OPENAI_BASE_URL`) are advanced local chat options. Choose and validate a model for Sass on suitable hardware; model quality and resource needs vary.

`AI_PROVIDER` picks the chat client. Other values aren't supported: most replies turn into a canned "can't think" line.

| `AI_PROVIDER` | client | settings |
| --- | --- | --- |
| `openai` | OpenAI SDK, Chat Completions | `OPENAI_API_KEY`, `OPENAI_MODEL`, and `OPENAI_BASE_URL` for any host other than OpenAI |
| `ollama` | Ollama's native API | `OLLAMA_HOST`, `OLLAMA_MODEL` |

`openai` works with anything that speaks the OpenAI Chat Completions API. Some base URLs:

| host | `OPENAI_BASE_URL` |
| --- | --- |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| xAI | `https://api.x.ai/v1` |
| Together | `https://api.together.xyz/v1` |
| LM Studio | `http://localhost:1234/v1` |
| Ollama | `http://localhost:11434/v1` |
| Anthropic | `https://api.anthropic.com/v1` |

**Anthropic (Claude)** works through its OpenAI-compatible endpoint: `AI_PROVIDER=openai`, `OPENAI_BASE_URL=https://api.anthropic.com/v1`, and an Anthropic key in `OPENAI_API_KEY`. Set `OPENAI_MODEL` to the exact model ID, such as `claude-sonnet-5-5`. The internal provider label `openai` describes the SDK format; it does not mean replies use an OpenAI model.

Sass omits sampling overrides for Claude and recognized OpenAI reasoning models. Other compatible models keep mood-adjusted temperature. Claude's compatibility endpoint ignores `reasoning_effort`; Sass does not claim to set effort through that field. Sonnet 5.5 currently uses adaptive thinking at the API's default high effort.

Recognized reasoning models and Claude receive a 16,384-token combined generation budget. Ordinary API chat and native Ollama default to 4,096. `SASS_REPLY_MAX_TOKENS` sets a configured budget from 64 to 131,072; it must fit the selected model and server context settings. Smaller explicit utility limits remain in effect on ordinary compatible API calls. Native Ollama uses its common reply budget. This setting changes generation, not stored memory or the amount of input history. Provider APIs can have lower limits. See [reply and memory limits](REPLY_AND_MEMORY_LIMITS.md).


## Image roasts

When someone @'s her with an image attached, the image goes to the chat model along with the prompt. Any vision-capable model works:

- **`AI_PROVIDER=openai`**: the Discord image URL is sent as an `image_url` part. Works with OpenAI and with OpenAI-compatible hosts that fetch image URLs, like OpenRouter, Groq, xAI and Together, as long as `OPENAI_MODEL` is a vision model. Ollama's `/v1` endpoint and LM Studio only take inline base64 images, so they can't see the picture this way. Use `AI_PROVIDER=ollama` for local vision.
- **`AI_PROVIDER=ollama`**: the bot downloads the image and passes it in Ollama's `images` field. Set `OLLAMA_MODEL` to a vision model such as `llama3.2-vision`, `gemma3`, `qwen2.5vl` or `llava`. If the model rejects images, she retries without the picture.

With a text-only model she still replies, but she can't see the image.

## Embeddings (vector memory)

Normal setup selects `SASS_EMBEDDING_PROVIDER=local` and checks the model included in the Mac bundle. It saves the exact model name and dimension. Source and expert workflows require separately prepared model files; an explicit model preparation may offer a download. A saved model must load as configured; a later failure does not silently select another model. `off` disables vector writes and semantic search. If the provider is unset, Sass keeps the API embedding path used by older installations.

The `openai` and `ollama` paths use **`EMBEDDING_OPENAI_BASE_URL`** and **`EMBEDDING_OPENAI_API_KEY`**. Without a separate embedding key, they use `OPENAI_BASE_URL` / `OPENAI_API_KEY`. Set `OPENAI_EMBEDDING_MODEL` to the model served by that host. Chat-only hosts need a separate embedding service.

To keep embeddings local while chat is cloud:

```bash
ollama pull nomic-embed-text
```

Then set `SASS_EMBEDDING_PROVIDER=ollama`, `OPENAI_EMBEDDING_MODEL=nomic-embed-text`, `EMBEDDING_OPENAI_BASE_URL=http://127.0.0.1:11434/v1` and `EMBEDDING_OPENAI_API_KEY=ollama`.

New vector rows record their model, endpoint and dimension in `embedding_space`. Search and duplicate removal only compare compatible vectors. Schema setup adds this nullable column without changing old rows. Old rows with no model identity remain stored and readable as raw memories, but semantic search and duplicate removal exclude them. Sass does not automatically re-embed them.

`sass doctor` checks the selected provider and model. For local memory, it loads only cached files and tests a synthetic input. It does not download a model or try a cloud fallback. If the required model is missing, restore a verified bundle or prepare the selected model explicitly; normal setup does not download it.

## Ollama differences

- Mood temperature and per-call utility limits are not passed to Ollama. Native chat sets `num_predict` from the common reply budget (4,096 by default, configurable with `SASS_REPLY_MAX_TOKENS`); it overrides the Modelfile generation limit.
- The bot sends its own system prompts, which replace the `SYSTEM` block in the `Modelfile`.

## Postgres

**Default (local):** setup sets `SASS_EMBEDDED_PG=1`. When Sass starts, it runs a local Postgres binary included in the bundle or supplied by the `embedded-postgres` npm package in a source installation. Data lives in `.sass-data/` in the project folder (gitignored). Ctrl+C stops the database with the bot. No Docker or separate Postgres install required.

**Hosted:** In `sass settings`, choose the Postgres URL option, or set `DATABASE_URL` yourself and remove `SASS_EMBEDDED_PG` (or set it to `0`). Works with Railway, Neon, and any Postgres. Tables are created on first start.

**Advanced:** `sass settings` also offers Docker or an existing Postgres on `127.0.0.1:5432` if you prefer that over the embedded option.

No `pgvector` extension is needed: embeddings are stored as `REAL[]` and compared in the bot. Railway hosting: see [DEPLOYMENT.md](../DEPLOYMENT.md).

## Custom emoji, avatar and banner

Sass's 11 custom emoji ship in `assets/emoji` (`sass_stare.png`, `sass_fire.png`, …). They have to be on your Discord app before she can use them:

- Normal setup adds missing assets; source users can also run `npm run assets` (alias `npm run emoji`). It reads `DISCORD_TOKEN` and `CLIENT_ID` from `.env`, skips emoji the app already has, and never deletes or replaces anything.
- Uploading by hand still works: Developer Portal → your app → Emojis. Keep the file names as the emoji names (`sass_fire`, `sass_mid`, …).

On startup she looks the emoji up by name, so no IDs need editing. Any that are missing fall back to a Unicode emoji (🔥, 😐, 🥱, …). Restart the bot after uploading.

Her avatar (`assets/avatar.png`, 512×512) and profile banner (`assets/banner.png`, 1360×480) ship too. The same step sets them through Discord's `PATCH /users/@me`, but only when your bot has no avatar or banner yet: if you've set your own, it is kept. Running it again changes nothing. If Discord rate-limits or rejects a change, it warns and carries on; you can also set them by hand under Developer Portal → Bot.

## `sass` command (installer)

After a successful installation, `sass` is on your PATH (from `~/.local/bin` on Mac/Linux, `~/.sass\bin` on Windows):

| command | what it does |
| --- | --- |
| `sass` or `sass start` | start the bot |
| `sass setup` | revisit connection setup using the installed runtime |
| `sass update` | bundle installs: points to the installer; source installs: pull, install and build |
| `sass doctor` | check configuration, database and embeddings |
| `sass settings` | expert configuration |
| `sass invite` | show the Discord server invite |
| `sass stop` | reminds you to use Ctrl+C in the bot terminal |

State lives in `~/.sass/env` (and `~/.sass/env.ps1` on Windows). Override install location with `SASS_DIR`.

## npm scripts

| script | what it does |
| --- | --- |
| `npm run setup` | interactive first-time setup: asks for each value, checks it, writes `.env` |
| `npm run assets` | upload the bundled custom emoji to your Discord app (skips ones it already has) and set the bundled avatar/banner if the bot has none. `npm run emoji` does the same |
| `npm run dev` | run from TypeScript with watch |
| `npm start` | run the compiled bot (`dist/index.js`) |
| `npm run verify` | type check, lint, build |
| `npm run doctor` | check env, database and embeddings |
| `npm run migrate` | one-time import of legacy local data files into Postgres. New installs don't need it. |
