# Channel directory differential

Compares what the web app's channel readers see on main (M, the REST channel
list and `/activity`) with the soup channel directory, with the GraphQL device
cache (C) and without it (N), on one local stack, the same synthetic data and
the same moment. Not part of any build or CI job.

## Layout

- `lib.ts`, `docs.ts`, `sign-in.ts`, `seed.ts`: sign-in, GraphQL calls and
  the documents both sides send, and the first seed (one viewer in 14,995
  channels).
  `docs.ts` imports main's generated GraphQL types from `before-graphql.ts`,
  which is not committed (11 MB): write it from the merge base with
  `git show <base>:apps/web/src/lib/service-clients/service-storage/graphql/generated/graphql.ts > before-graphql.ts`.
- `proof-v2/seed-v2.ts`: groups of synthetic people, channels, DMs, bots and
  memberships for the sequences, written as SQL to the stack's database.
- `proof-v2/apply-probes.sh`, `patches/`: build main and the branch with a
  probe page that exposes each reader's view (`probe-main.tsx`,
  `probe-branch.tsx`) and the planted mutants (`mutant.ts`).
- `proof-v2/coord.mjs`: drives M, C and N in Playwright for reads (`read`) and
  for sequences of channel operations (`seq`, `ops.mjs`), then compares
  (`compare.mjs`) and classifies every difference (`classify.mjs`).
- `proof-v2/load.ts`: concurrent writes into the first seed's channels while
  the loaded sequences run.
- `proof-v2/run.sh`: the whole run; `summarize.sh` prints the totals.

## Running

Needs a local stack (`just run_local --instance gqlchan`), with the synthetic
people signed in (`bun sign-in.ts`, which writes `sessions.json`) and seeded
(`bun seed.ts`, then `bun proof-v2/seed-v2.ts`, which signs its own people in
and writes `proof-v2/sessions-v2.json`); apply the SQL each seed writes to the
stack's database. `seed-v2.ts` writes `proof-v2/seed-v2.manifest.json` (the
synthetic people of each group) and `augment-bot-dm.mjs` writes
`proof-v2/augment-bot-dm.json` (each group's bot DM); both are committed for the
seeds the run uses, and `group-state.mjs` reads them. The session files hold live
cookies: never commit them (`.gitignore` lists them). Set `REPO_ROOT` to the macro
checkout, `MAIN_TREE` to a checkout of the merge base and `BRANCH_TREE` to the
branch, then:

```sh
REPO_ROOT=... MAIN_TREE=... BRANCH_TREE=... proof-v2/run.sh all
```

Results land in `proof-v2/runs/final/`.

## What it cannot reach

Native (Tauri) cache hosts, other devices' sessions, and timing: it compares
what each reader shows once its sources settle, not how fast.
