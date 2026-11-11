# Shared message UI differential harness

This harness compares the signed-in `MessageThread` and `ChannelInput` render in
`origin/main` with the current branch. It uses one fixture copied temporarily
into each checkout, then removes the copies. Only hashes, counts, and case IDs
appear in the report; message bodies stay in memory. The fixture mounts
`AppProviders` and blocks background API requests. Use a dedicated local
`origin/main` worktree as the baseline.

```sh
git worktree add --detach /tmp/cgc-fuzz-main origin/main
nix develop -c bun install --frozen-lockfile
( \cd /tmp/cgc-fuzz-main && nix develop -c bun install --frozen-lockfile )
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium \
  nix develop -c bun tooling/fuzz/call-guest-chat/run.ts
```

The default no-op corpus has 12 seeded threads. `CGC_COUNT` changes its size;
larger values include guest-only call cases whose differences are expected.
`CGC_CORPUS=/tmp/cgc-fuzz-corpus.json` loads a JSON object with `viewerId` and
`threads` (`MessageThread` objects). Set `CGC_BASELINE` if the baseline checkout
is elsewhere. The runner exits nonzero when it finds a difference.
The SQL exporter samples at most 100 threads in deterministic order;
`CGC_MAX_THREADS` can set a limit from 1 to 1000.

The local `cgc` stack export reads only `comms_messages`,
`comms_message_threads`, `comms_reactions`, `comms_attachments`,
`comms_entity_mentions`, and `comms_channels` from its
Postgres container. Keep the export under `/tmp`:

```sh
nix develop -c env -u DATABASE_URL bun \
  tooling/fuzz/call-guest-chat/export-local.ts /tmp/cgc-fuzz-local.json
CGC_CORPUS=/tmp/cgc-fuzz-local.json \
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium \
  nix develop -c bun tooling/fuzz/call-guest-chat/run.ts
```

To use a supplied dev `pg_dump` later, restore it only into a new scratch
database on the shared local Postgres. Never connect this harness to hosted dev:

```sh
read -rsp 'Local PostgreSQL password: ' CGC_DB_PASSWORD
export CGC_DB_PASSWORD
nix develop -c env PGPASSWORD="$CGC_DB_PASSWORD" \
  createdb -h localhost -U user cgc_fuzz_001
nix develop -c env PGPASSWORD="$CGC_DB_PASSWORD" \
  pg_restore --no-owner --no-privileges \
  -h localhost -U user -d cgc_fuzz_001 /tmp/comms-dev.dump
nix develop -c env \
  PGPASSWORD="$CGC_DB_PASSWORD" \
  DATABASE_URL=postgres://user@localhost:5432/cgc_fuzz_001 \
  bun tooling/fuzz/call-guest-chat/export-local.ts \
  /tmp/cgc-fuzz-dev.json
CGC_CORPUS=/tmp/cgc-fuzz-dev.json \
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium \
  nix develop -c bun tooling/fuzz/call-guest-chat/run.ts
```

The dump must include the six `comms_*` tables above. Keep the dump, restored
database, JSON export, and detailed test logs outside the repository. Remove
the temporary baseline worktree with `git worktree remove /tmp/cgc-fuzz-main`
after the comparison.

For unit suite status comparison, run `nix develop -c bun run test --maxWorkers=2
--reporter=json --outputFile=/tmp/cgc-main-vitest.json` from the baseline
`apps/web`, then the same command with `/tmp/cgc-branch-vitest.json` from the
branch `apps/web`. Compare the reports with:

```sh
nix develop -c bun tooling/fuzz/call-guest-chat/compare-vitest.ts \
  /tmp/cgc-main-vitest.json /tmp/cgc-branch-vitest.json
```
