# Dreaming

Dreaming is Sass's background memory cleanup and profile refresh. It needs a
connected PostgreSQL database and processes servers that have vector memories.
Chat uses raw facts and retrieved memories when a usable distilled profile is
unavailable.

## Schedule and budgets

The first check is five minutes after startup. PostgreSQL records each attempt
**before** model work starts. A restart cannot start another attempt until six
hours have passed, even if the previous run failed, was canceled or reached a
budget. A failed state read or write skips model work. This is designed for one
bot process per token, as the deployment guide requires.

Only one scheduled run can be active. Each run has a two-minute budget and at
most 25 profile-generation attempts, including failed attempts. Each profile
request has a 30-second limit. Work rotates across ordered servers and users so
the same first users do not always consume a limited run. Shutdown clears the
timer, cancels maintenance and waits before closing memory and PostgreSQL.
Database acquisition, queries and lock waits are bounded; canceled clients are
discarded.

Code: `src/memory/distillScheduler.ts`, `src/database/maintenanceState.ts` and
`src/vectorMemory.ts`. These defaults are code constants, not environment
settings. The six-hour interval is shared with `src/memory/profilePolicy.ts`.

## Cleanup

Each user's cleanup uses one connection and one short transaction. A
transaction-scoped advisory lock serializes overlapping cleanup for that user.
Normal memory writes can continue; the cap query operates on its database
snapshot rather than a count fetched earlier. A new roast can therefore remain
over the cap until the next cleanup. No transaction spans a model call.

1. **Dedupe roast topics only.** Keep the newest of similar roast memories
   (cosine similarity greater than 0.85). Only vectors in the same known embedding
   space are compared. Unknown legacy vector spaces are excluded.
2. **Prune roast topics only.** Delete roast memories older than 90 days.
3. **Cap roast topics only.** Keep the newest 100 roast memories per user per
   server, ordered by creation time and ID.

Facts, statements and quotes are not deleted by these automatic steps, including
semantic deduplication. Their vector rows have no automatic count or age cap.
Raw fact and roast arrays have separate limits in
[reply and memory limits](REPLY_AND_MEMORY_LIMITS.md). `/forgetme` still deletes
that user's stored data for the server.

## Distilled profiles

Profiles are refreshed when missing or at least six hours old. The model sees
the stored name, affinity tier, counters, facts, roast topics and ten newest
vector memories. The result must pass a code-enforced limit of 30 words and 500
characters, be single-line plain text, and not match known refusal, error or
canned-response patterns. Invalid output leaves the previous profile intact.

A result can update only an existing user whose source data still matches the
snapshot sent to the model. Facts, roast topics or name changes invalidate the
stored profile; stale generation cannot mark old source data as fresh.
Deletion invalidates in-flight work so it cannot recreate the user.

Both profile consumers share the validity and freshness check. A valid profile
is usable for four refresh intervals (24 hours); after that they fall back to
raw memory until rebuilding succeeds. Missing or invalid timestamps are never
fresh. This bounds stale context after a long shutdown while retaining facts.

## Diagnostics and tests

Runs log aggregate status and attempted, updated and failed profile counts,
without names, identifiers, prompts or database values. Failure leaves raw
memory available. A failed or limited run is not reported as completed.

Regression tests cover protected types, prune/cap, transaction rollback and
concurrency, profile validation and source changes, request/run limits,
cancellation, durable cadence, scheduler shutdown and deletion races. Real
PostgreSQL checks use temporary synthetic databases, never an existing install.
