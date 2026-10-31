# Personality

How Sass decides when to talk, how she feels about each person, and how her tone shifts. None of this is a trained model. It's rules in code that pick what goes into the prompt. Everything that's stored (affinity, mood, cold shoulder) needs `DATABASE_URL`. Without it, affinity reads as 50 and mood stays neutral.

## When she replies

Every message in a server goes through `src/events/messageCreate.ts`, in this order:

1. **@Sass in the message.** She always handles it (`handleMention` in `src/handlers/mention/index.ts`). The exceptions are the per-user cooldown and the spam checks under [Ignoring](#ignoring).
2. **Reply to one of her messages.** If the reply has 3 or more words, there's a 70% chance she enters the auto-sass handler, which may reply, react or skip after its remaining checks. Shorter replies ("lol", "💀") drop through to step 4.
3. **"sass" anywhere in the message** (but not "sassy"). A message that's only one or two words gets a canned "what" / "you rang?". Longer ones go straight to the model, skipping the dice.
4. **Everything else goes to auto-sass** (`handleAutoSass` in `src/handlers/autoSass.ts`).

All users use the same auto-sass eligibility and cooldown rules.

### Auto-sass: the dice roll

Messages that reach the auto-sass handler are counted per channel; messages handled or filtered earlier are excluded. For unsolicited auto-sass, she only rolls if all of these hold:

| Gate | Value | Where |
| --- | --- | --- |
| Messages since her last pop-in | ≥ `AUTO_SASS_MIN_MESSAGES` (default `2`) | `autoSass.ts` |
| Words in the current message | ≥ 4 | `autoSass.ts` |
| Channel cooldown | 30 s since she last spoke in the channel | `AUTO_SASS_COOLDOWN_MS`, `src/cooldown.ts` |
| Server cooldown | 15 s since she last auto-sassed anywhere in the server | `GUILD_AUTO_SASS_COOLDOWN_MS`, `src/cooldown.ts` |
| Dice | `Math.random()` ≤ `AUTO_SASS_CHANCE` | `autoSass.ts` |

`AUTO_SASS_CHANCE` falls back to `0.55` in code if unset. `.env.example` sets `0.4`.

When the roll hits, the channel counter resets. A 10% side roll may roast someone's Discord activity instead: someone who has been playing a game for an hour or more, and at most once per person per 24 hours. Otherwise a second roll picks what she does:

| Roll | Action |
| --- | --- |
| 0.00–0.20 | Emoji react on the message (custom Sass emoji first, else the model picks one) |
| 0.20–0.30 | "Lurk" react on a message 3–6 back |
| 0.30–0.40 | Canned short reply ("nah", "bro what", "you done?"), no model call |
| 0.40–0.65 | Joins the conversation: agrees, takes a side, answers a question |
| 0.65–1.00 | Roast. This is also the fallback when another branch comes up empty |

The join and roast lines both have to pass a quality gate (`passesQualityGate`). Filler like "sure" or "checks out" is dropped, and so is anything of 1–2 words without `!` or `?`. Then a second model call rates the line 1–10, and anything under 5 is dropped. The model can also answer `SKIP` when a conversation is boring, is about images she can't see, or is unclear.

Both prompts include her last 5 lines in that channel (`src/responseMemory.ts`) so she doesn't repeat herself.

## Affinity

`src/database/affinity.ts` keeps a per-user, per-server score from 0 to 100. It starts at 50.

| Event | Change | Where |
| --- | --- | --- |
| She answers your @mention | +0.5, at most once per 10 min | `src/shared/responsePipeline.ts` |
| You react to one of her messages | +0.5, once per message, at most once per 10 min | `src/events/reactionAdd.ts` |
| You react with 👎 😐 🤡 ❌ | −2, no cooldown | `src/events/reactionAdd.ts` |
| Spam ping (see below) | −3 each | `src/handlers/mention/spamDetection.ts` |
| "kys" / "kill yourself" / "go die" at her | −3 | `src/handlers/mention/index.ts` |
| Telling her to stop (cold shoulder) | −5 | `src/handlers/mention/index.ts` |
| "kys" / "die mad" / "kill yourself" / "go die" anywhere in chat | −5 | `src/handlers/autoSass.ts` |

Gains shrink as the score rises: ×0.5 from 60, ×0.25 from 75, and ×0.1 from 90. Gains are capped at +3 per user per day. That cap is tracked in the database, so restarts don't reset it. Losses always apply in full.

After 3 days without activity she loses 1 point per day, but decay never takes a score below 30. Penalties can.

### What affinity changes

Affinity doesn't decide *whether* she answers. It decides *how*. Before each mention reply, `buildPersonalityContext` (`src/handlers/mention/personality.ts`) turns the score into one instruction:

| Score | Instruction |
| --- | --- |
| ≥ 90 | ride or die: warm, playful, protective |
| 70–89 | genuinely likes you, teases affectionately |
| 50–69 | standard sass |
| 31–49 | shorter replies, less effort |
| < 31 | cold, dismissive, minimal effort |

Auto-sass gets a similar table for everyone in the recent chat (`buildAffinityContext`: 86 / 71 / 51 / 31). Affinity also feeds `/ship`. A mild insult between two users only counts as beef if the speaker's affinity is under 30.

## Mood

`src/mood.ts` keeps one mood per server: `neutral`, `soft`, `petty`, `chaotic`, `chill`, `unhinged` or `bored`. Mood tunes from how people treat her and each other:

| Trigger | Mood | Intensity |
| --- | --- | --- |
| Compliment in a mention ("good bot", "you're the best") | soft | +40 |
| Insult in a mention, or telling her to stop | petty | +40 |
| A wild quote, or a Caught in 4k callout | chaotic | +30 |
| Hostile language in chat | unhinged | +35 |
| Wholesome chat ("love you", "thank you") | chill +25, or soft +15 (40% of the time) | |
| 30 chat messages in a row in the server with no wild quote, hostile or wholesome language (messages aimed at her don't count) | bored | +20 |

A different mood first knocks 20 off the current intensity. It only takes over once the current mood is at 10 or below.

Intensity fades 15 points every 30 minutes, back to neutral. Above 10, the mood adds a tone paragraph to the mention prompt and blends the sampling temperature from the neutral 1.2 toward the mood's own: soft 1.0, petty 1.3, chaotic 1.4, unhinged 1.5, bored 0.9. Temperature only applies on the OpenAI-compatible provider. The Ollama path doesn't pass it, so the model's own setting applies (the bundled `Modelfile` sets 0.9).

## Cold shoulder

Say something like "leave me alone", "shut up" or "stop roasting" in a mention and `userMemory.coldShoulder` (`src/userMemory.ts`) flags you. She also takes −5 off your affinity and shifts toward petty.

The flag sets a random 3–5 attempts needed. Each later mention is one attempt. Under 60% of the way you're `icy` (one word, "…"). From 60% you're `warming` (reluctant). At 100% you're `forgiven` and she makes a show of letting you back. She still replies the whole time, just barely.

## Escalation

`trackMentionEscalation` (`src/cooldown.ts`) counts your tags in a rolling 5-minute window:

| Tags in 5 min | Level |
| --- | --- |
| 0–4 | normal |
| 5–9 | annoyed |
| 10–19 | cold: one-word answers |
| 20+ | petty: calls out the count |

This combines with affinity, so favorites get "i love you but you're testing me rn". Cold shoulder overrides both.

## Ignoring

These get no reply at all:

- **Low-effort pings:** 3 or more mentions of ≤ 5 characters within 2 minutes. Each one also costs −3 affinity. Set in `isSpamPing`.
- **Repeats:** the same or near-same message twice within a minute (`isSpamming` in `messageCreate.ts`). There's also a 3 s per-user reply cooldown.
- **Self-harm bait:** the first message gets a dismissive reply. A second within 5 minutes starts a 15-minute ignore, and after that a short check-in. Set in `isSensitiveTopic`.
- **Not worth it:** auto-sass answers `SKIP`, or the line fails the quality gate.

The configured instance owner uses the same personality, affinity, spam and cooldown rules as everyone else.

## What it doesn't do

Nothing is learned between runs beyond the stored numbers above. Reactions on her messages are logged for `/bestof`; they do not update the model weights.

The `begged_back` mood event is defined in `src/mood.ts` but nothing triggers it.
