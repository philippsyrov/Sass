<p align="center">
  <img src="assets/sass-avatar.png" alt="Sass" width="128">
</p>

<h1 align="center">Sass</h1>

<p align="center">A Discord bot that roasts your friends. Chronically online, emotionally unavailable.</p>

**Sass is a self-hosted Discord bot that roasts people in your server and uses remembered context in replies.**

| Feature | What it does |
| --- | --- |
| **Roasts** | @ her for a one-liner, reply to one of her messages, or just say "sass" in chat. |
| **Auto-sass** | Reads every message and decides on her own when to jump in, with a dice roll per message. A second model pass drops weak lines. See [docs/PERSONALITY.md](docs/PERSONALITY.md). |
| **Image roasts** | Attach an image when you @ her and she roasts the picture. Needs a vision-capable model on any provider. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md#image-roasts). |
| **Roast battles** | `/roastbattle @user` runs 3 rounds in a thread, 2 minutes per turn or forfeit, and the model picks the winner. |
| **Vector memory** | Stores facts, statements and roast topics as embeddings and pulls the relevant ones into replies; add your own with `@Sass remember <fact>` or `@Sass remember @user <fact>`. |
| **Profiles** | `/profile [@user]` gives a behavioural read and an archetype built from that user's history. |
| **Caught in 4k** | Extracts claims from messages and calls you out when you contradict something you said earlier in the same server. |
| **Mood** | Each server has a mood that shifts with how people treat her and each other (soft, petty, unhinged, chaotic, bored) and fades over time. |
| **Affinity** | A per-user score that rises when you talk to her or react to her messages and drops when you insult or spam her. It sets how warm or dismissive she is with you. |
| **Cold shoulder** | Tell her to stop and she goes cold, with one-word replies until you win her back. |
| **Escalation** | Tag her 5, 10 or 20 times in 5 minutes and she gets annoyed, then cold, then petty about it. |
| **Ignoring** | Spam pings, repeats and bait get no reply at all, and she can choose to skip a chat that isn't worth it. |
| **Dreaming** | Every 6 hours she consolidates memory in the background: dedupes near-identical memories, prunes stale roast topics, caps roast memories per user and refreshes a one-line profile of each user. See [docs/DREAMING.md](docs/DREAMING.md). |
| **Ship cards** | `/ship @u1 @u2` renders a compatibility card whose background follows the score: storm clouds for doomed ships, sakura when it's cute. |
| **Commands** | `/help` `/fortune` `/quote` `/hottake` `/horoscope` `/conspiracy` `/ship` `/compliment` `/profile` `/leaderboard` `/status` `/favorite` `/halloffame` `/bestof` `/beef` `/forgetme` |
| **Models** | Any **OpenAI-compatible API** (OpenAI, OpenRouter, Groq, xAI, Together, LM Studio, …) or **Ollama**. Memory search can use a local model, an installed Ollama embedding model, or a separate OpenAI-compatible API. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md#ai-providers). |
| **Forget me** | `/forgetme` deletes your server-scoped data after a confirmation. See [docs/PRIVACY.md](docs/PRIVACY.md). |

## Quick start

### Local installation (macOS)

The local installer downloads a ready-to-run bundle from the project releases. Check that a matching Apple Silicon bundle is published before installing. If none is available, the installer stops without starting a source build or changing your installation. See [release bundles](docs/RELEASE_BUNDLES.md) for requirements and the scope of testing.

```bash
curl -fsSL https://raw.githubusercontent.com/philippsyrov/Sass/main/install.sh | bash
```

The bundle includes a private Node 24 runtime, built bot, local PostgreSQL, pinned memory-search model and standard artwork. These are required parts of the normal local setup; you do not need to install Git, npm, a compiler or a separate database. The installer shows the size, destinations and model terms before proceeding. It does not silently download a replacement model.

Before setup, prepare these:

1. In the [Discord Developer Portal](https://discord.com/developers/applications), create an application. Under **Bot**, reset and copy the bot token. Keep it private.
2. Under **Bot → Privileged Gateway Intents**, enable **Presence Intent** and **Message Content Intent**, then save. Both are required; Server Members Intent is not needed.
3. Choose a chat provider and have its API key ready. For first run, use the recommended API chat model offered by setup. Provider usage may incur charges.

Setup checks the Discord connection, derives the application and owner IDs where available, and asks for any missing information. If it asks for your user ID, enable Developer Mode in Discord settings, then right-click your name and choose **Copy User ID**. It saves private settings, verifies local memory, prepares the database schema and slash commands, and adds missing standard Discord assets without replacing custom artwork. Follow the invitation shown during setup or run `sass invite` to add her to a server. You need permission to add a bot to that server; global slash commands may take a few minutes to appear.

Chat and memory search are separate: the chosen chat provider generates replies, while the included memory model searches locally. Ollama and other local chat options are supported as advanced choices. Choose and validate a model yourself on suitable hardware; response quality and resource needs vary. See [configuration](docs/CONFIGURATION.md#ai-providers).

After installation:

```bash
sass start       # start Sass
sass setup       # revisit connection setup
sass settings    # expert configuration
sass invite      # show the server invite
sass doctor      # check readiness without downloading a model
```

Keep the terminal running while using Sass. Ctrl+C stops the bot and local database; closing or sleeping the computer takes her offline. Local data persists between runs. Run only one bot instance per token.

The ready-to-run bundle requires **macOS 15 or newer on Apple Silicon**. Intel Mac, Linux and Windows bundles are not yet verified.

### Source and server setup

For developers and server operators, the separate source workflow requires Node.js 20 or newer and npm. See [deployment](DEPLOYMENT.md) and [configuration](docs/CONFIGURATION.md). Ready-to-run bundles for other architectures and platforms are unverified.

## Docs

| Doc | Covers |
| --- | --- |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Environment variables, AI providers, image roasts, embeddings, Postgres, custom emoji, avatar and banner, npm scripts |
| [docs/PERSONALITY.md](docs/PERSONALITY.md) | When she replies, affinity, mood, cold shoulder and escalation, with the knobs |
| [docs/DREAMING.md](docs/DREAMING.md) | Background memory consolidation: schedule, steps, limits |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Source and hosted deployment |
| [docs/RELEASE_BUNDLES.md](docs/RELEASE_BUNDLES.md) | Mac bundle contents and requirements |
| [docs/PRIVACY.md](docs/PRIVACY.md) | What she stores, what `/forgetme` deletes, usage rules |

## License

ISC, see [LICENSE](LICENSE).

