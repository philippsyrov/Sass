# Hosted Sass deployment

This route is separate from the ordinary local installer. It is intended for maintainers and coding agents preparing Railway or another managed server. Do not assume an old deployment or automatic deploy trigger is still active.

## Application contract

- Use a supported Node version from package.json and the repository lockfile.
- Install dependencies with npm ci. Run npm run verify and npm test before review.
- Build with npm run build; start the built bot with node dist/index.js.
- Configure DISCORD_TOKEN, CLIENT_ID, any optional CREATOR_ID and the selected chat provider credentials through the host's secret manager. Never publish these values or commit .env.
- Set SASS_EMBEDDED_PG=0 and DATABASE_URL for a managed PostgreSQL database. Keep its data persistent and back it up before migrations.
- Set SASS_EMBEDDING_PROVIDER explicitly. Local embeddings need the pinned model files and a persistent cache path; the runtime does not download weights. A selected cloud embedding service needs its own explicit endpoint, key and model configuration. Do not silently send local memory to a cloud backend.
- Keep model identity and embedding dimensions pinned with stored memory. Do not replace a model without an explicit migration plan.
- Run node dist/register-commands.js after command definition changes, against the intended Discord application. Show the invite with node dist/invite.js.
- Enable the required Presence and Message Content intents in the Discord Developer Portal.
- Run only one bot instance per token unless a separate multi-instance design has been reviewed.

See docs/CONFIGURATION.md for the variable reference and docs/RELEASE_BUNDLES.md for local artifact packaging. Server operators may configure custom databases and models directly; ordinary local users should not see these choices during onboarding.

## Deployment checks

Check the host's configured build command, start command, persistence and release trigger. Do not invent service IDs, assume a push to main deploys, create paid resources, or deploy without authorization. A coding agent should prepare a reviewable change and identify any required service configuration.

Verify a test-server login, a model reply, representative commands, memory persistence across restart, deletion scope, asset rendering and graceful shutdown in the target environment. Unit tests do not replace these checks. Do not use a personal or production server as a smoke test without approval.
