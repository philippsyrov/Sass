# Contributor guidance

Sass is a self-hosted Discord bot. Keep replies short, playful and non-hurtful. Follow the detailed rules in `.claude/rules/` when changing code.

Run `npm run verify` and `npm test` before proposing changes. Preserve unrelated changes and private data; never commit `.env`, credentials or secrets. Do not deploy, publish or modify a live Discord application without authorization.

Use the appropriate submodule for new code and update barrel exports where needed. Preserve guild scoping, handle errors explicitly, bound in-memory collections, and defer Discord replies before slow AI or database calls. Do not re-add `/dare`, `/confess` or `/predict`.

See [configuration](docs/CONFIGURATION.md), [privacy](docs/PRIVACY.md), [deployment](DEPLOYMENT.md), and [release bundles](docs/RELEASE_BUNDLES.md).

Keep personal working notes in a separate private notes repository. Product documentation here should describe neutral product decisions and actual behavior.
