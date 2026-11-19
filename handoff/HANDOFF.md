# Handoff: routine suggestions climb, leg 2

Stopped on 2026-11-19 for a machine move. The goal of this leg is quality toward 100 and price
toward $2 a run of the bench's `routines` section (27 attempts, judge included), with time to
first suggestion reported as a third number. Feed must not get worse beyond its margin.

## Branches

| Branch | Head | What |
| --- | --- | --- |
| `synoet/routines-suggestions-climb-2` | `b61f51d8c25` | Leg 2: brief v7 to v9, the once-a-run judge cache in the bench, main merged, then unseen sessions (fast-forwarded). No PR. |
| `synoet/routines-suggestions-unseen` | `abf81530a2a` | climb-2 plus one commit: the suggest/check SDK reference in the routines instructions. Unbenched. No PR. |
| `synoet/routines-suggestions-climb-2-wip` | this commit | The unseen branch plus this `handoff/` folder. Never merge it. |

Leg 1 was PR #11466, squash-merged. climb-2 was branched from its head, so when you next
merge `origin/main`, keep climb-2's copy wherever main changed a file only through that squash
(`prompt.md`, `prompt.rs`, the bench README were the leg-1 head's).

Commits on climb-2 after leg 1, oldest first:
- `2c2ab3da567` brief v8: CRM only for a company that may become a client, drafts ranked by
  what the user would most regret missing, surfaces are where the user would look.
- `105fcd601dd` bench: one `now` per run for all reps and judging after the last rep, so each
  persona's judge prefix is written once a run (3 cache writes, not 9).
- `526a73934c9` merge of origin/main.
- `bf31a3b4d73` brief v9: says why request routines miss notices that leave a step.
- `b61f51d8c25` routines sessions run out of sight: the brief splits into `instructions` (the
  same for everyone, so cached) and a `prompt` (time, dismissals, apps, mail); a session prepared
  with instructions runs `Unseen` in agent_inmem, with code mode's tools only.

## Where it stands (tune, my stack; all numbers in `runs.md`)

| Run | Score | Found | Bad | First | Gen $/attempt | Judge $/attempt | Run total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| leg-1 PR (now main) | 74.4 | 4.30 | 0.11 | 150 s | 0.076 | 0.092 | $4.54 |
| v9 `bf31a3b4d7` | 70.7 | 4.00 | 0.04 | 80 s | 0.080 | 0.056 | $3.67 |
| unseen `b61f51d8c2` | 67.4 | 3.81 | 0.04 | 83 s | 0.065 | 0.054 | $3.22 |

- Leg 2 so far buys time to first suggestion (150 s to 80 s, from catalog picks in a program of
  their own before drafting) and price (unseen cuts generation 19%, 95% interval -0.021 to
  -0.008 per attempt; the judge cache cuts judging about 40%). It has not beaten main's quality:
  pr to v9 is noise (-3.7), v9 to unseen is noise (-3.3), and pr to unseen has found -0.48
  against a 0.47 margin, which `compare` calls worse.
- What was lost on tune going v9 to unseen: founder r2 3/9 to 0, sales r2 2 to 0, sales r5 1 to
  0, plumber r2 8 to 5. Gained: plumber r6 0 to 2. Drafted routines 49 to 44.
- Removing leg 1's tune-like examples (the manager's caution) cost about 7 on tune: plumber
  reviews and sales e-sign were found by them.

## Not proven yet

- The bench judge-cache change (`105fcd601dd`) moves the judge's inputs, so it must be shown not
  to make the bench blinder: run main on tune twice under it and `noise` the two against MARGINS
  (routines 11.5, found 0.47, bad 0.53). chain-7 was stopped during the first of those runs.
- No held-out confirmation of v9 or unseen. climb4 was made and never read or used, but it only
  exists on the old machine (see Skipped). dev1 and climb1-3 are spent.
- Feed was not rerun: the suggestions session is unchanged by construction (it gets no
  instructions and still runs as a conversation), which the service test asserts.
- `abf81530a2a` (the SDK reference in the instructions) passed its unit tests
  (scheduled_action suggestions 40, harness routine_code 15) and was never benched.

## Next

1. Bring up your own stack on the new machine (not `sugbench`), and run main on tune twice,
   then `noise` them: that both proves the judge cache and gives the baseline.
2. Bench `abf81530a2a` on tune. In unseen traces the first program runs 50-87 s in, after one
   ~50-70 s model call; the reference should drop the ReadCodeDocs rounds before it.
3. Pick the candidate (v9, or v9 with unseen and the reference) by tune against main, then make
   a fresh held-out set (`bench.ts heldout make`), run main and the candidate once each on it,
   aggregate only.
4. Update the bench README's "Cost and time" table (stale since the judge cache), then review,
   `just check`, audit, proof page, PR ready for review, `run-ci`.
5. Quality ideas not tried: give drafted routines more room than three (the misses are drafted
   streams); Gemini thinking level for the routines session (agent sessions never send
   `thinkingLevel`; `CompletionThinking::Low` in `crates/agent/src/structured_output.rs` shows
   the parameter), weighed against quality.

## Product questions for the user

- Meeting-brief needs (founder r2, sales r3) can't be met while calendar access is a separate
  consent from Gmail. Should onboarding ask for calendar access? Recommendation: yes, it is the
  biggest catalog-meetable miss.
- Some answer keys want bookings put on the calendar; programs can't create calendar events (the
  SDK refuses; agents propose them as review cards). Should routine programs be allowed to?

## Traps

- The chain recipe (`chain-recipe.sh`) runs main by checking out the merge-base's product files
  over the branch, bench kept. While it runs, don't edit the worktree; it restores at the end. A
  killed chain leaves those files staged: `git checkout HEAD -- $(git diff --name-only HEAD)`.
- A new worktree needs `bun install --frozen-lockfile` at the root and in `packages/sdk`, or the
  `code_mode_assets` build script fails on `@macro-inc/sdk-docs/render`.
- `suggestion_generation` has `trace_id`, `status`, `started_at` (no `ended_at`); traces are in
  the stack's Tempo at `/api/traces/<trace_id>`.
- Judge cost: the first judgement per persona writes the cache (~$0.21); later ones are ~$0.03-0.05,
  mostly output. The floor is about $1.4-1.5 a run unless the judge itself changes, which needs
  `noise` proof (`rejudge` proves a judge-only change without new generations).
- `Unseen` lowers effort only for models whose `ReasoningEffort::supported` lists it;
  gemini-3.8-flash lists none, so its effort is unchanged.

## Skipped

- Raw runs (`~/.cache/suggestions-bench/runs`, 307 MB of run.json, transcripts and seed logs):
  only their summary rows and tune hit counts are in `runs.md`. The baselines must be rerun on
  the new stack anyway.
- Held-out sets (`~/.cache/suggestions-bench/heldout`, 3 MB): not committed, so nobody reads
  them; make fresh ones.
- Session scratch scripts and traces beyond the chain recipe.

## Files here

- `runs.md`: every finished run's summary row, hits per need on tune, today's compares.
- `chain-recipe.sh`: the last chain (rebuild, run, main baselines at the merge-base).
- `project-page.md`: the running log of both legs (kept outside git on the old machine).
- `proof-leg1.html`: the source of leg 1's proof page.
