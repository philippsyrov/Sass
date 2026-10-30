# Implementation Hygiene

Rules for keeping AI-generated code clean and consistent. These prevent the "solves the same problem twice" debt pattern.

## Use Existing Helpers

- Prefer `pickRandom()` from `src/shared/commandUtils.ts` over inline `Math.floor(Math.random() * arr.length)` math
- Check `src/shared/` before adding a new utility function — it may already exist
- Check `src/database/` barrel exports before writing raw SQL helpers — query patterns are centralized there

## Extraction Rule

- If the same UI flow or logic pattern exists in 2 places, extract it into a shared helper by the 3rd occurrence
- If a helper already exists for a class of operation, use it — don't rewrite it inline

## Database Typing

- When querying Postgres, prefer typed row interfaces over `rows as SomeType[]` casts — define a local `interface FooRow` and use `pool.query<FooRow>()`
- This is opportunistic: do it when you're already touching the query file, not as a dedicated refactor pass

## Barrel Files

- Each split module (`database/`, `commands/`, `handlers/`, `shared/`) has an `index.ts` with re-exports
- New code goes in the appropriate submodule, not the barrel
- If you add a new export to a submodule, re-export it from the barrel so consumers import from `module/index.js`
