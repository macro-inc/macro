# Call guest chat differential harnesses

Two harnesses compare `origin/main` with this branch: the `messages` service (`run.py`, `cgc_*.rs`) and the shared message UI (`run.ts`, `fixture.tsx`, `corpus.ts`).

## Call guest chat differential harness

This harness runs the same `messages` service operations against `origin/main`
and the current branch. It copies the corpus into two scratch databases on the
local Postgres, so the source database is read only. Probe output and database
dumps stay under `/tmp`; the report contains counts, operation keys and IDs,
never message bodies. It also compares `ChannelSender::parse_from_str` on 20,000
seeded and adversarial inputs. The one allowed parser difference is a canonical
`participant:<uuid>` value.
Read probes use up to three verified account members per parent: active channel
participants, call owners, document owners, or message senders for other parent
types. The service test uses access receipts directly, so it compares service
behavior after authorization rather than the HTTP authorization layer.
All call records are included, even when their chat has no messages yet.
When an eligible call owner and channel exist, the write probe converts one call
to a channel discussion in each scratch copy to exercise call-root creation and
mutation rejection.

Run from the repository root:

```sh
nix develop -c python3 tooling/fuzz/call-guest-chat/run.py \
  --source-url 'postgres://user:password@localhost:30800/macrodb' \
  --old-checkout /tmp/cgc-fuzz-old --seed 10268 --operations 3000
```

Create the old checkout with
`git worktree add --detach /tmp/cgc-fuzz-old origin/main` and remove it with
`git worktree remove /tmp/cgc-fuzz-old` when finished. Use a writable
`CARGO_TARGET_DIR` with enough disk space; the runner makes separate targets
under `/tmp/cgc-fuzz-be-target-*` by default. It leaves the report and build
cache under `/tmp`, and removes its scratch databases and raw outputs.

For a hosted dev dump, obtain the dump through an approved channel yourself;
this harness never connects to hosted dev. With a full custom-format dump at
`/tmp/dev-comms.dump`, prepare a local source database and run:

```sh
nix develop -c psql postgres://user:password@localhost:5432/postgres \
  -c 'CREATE DATABASE cgc_fuzz_dev_source'
nix develop -c pg_restore --no-owner --no-acl --exit-on-error \
  --dbname postgres://user:password@localhost:5432/cgc_fuzz_dev_source \
  /tmp/dev-comms.dump
nix develop -c python3 tooling/fuzz/call-guest-chat/run.py \
  --source-url postgres://user:password@localhost:5432/cgc_fuzz_dev_source \
  --old-checkout /tmp/cgc-fuzz-old --seed 10268 --operations 3000
```

For a comms-table-only dump, first create the source database with the current
MacroDB schema and restore the dump there. Include `comms_messages`,
`comms_message_threads`, `comms_reactions`, attachments, mentions, channels,
channel participants, calls, activity rows, and referenced `User`, `Document`,
`call_entities`, and other parent rows. The
runner clones this prepared database. Keep dumps and restored databases under
local control and delete them after use.

The runner uses `pg_dump`/`pg_restore`, `cargo test`, and `psql` from the Nix
flake. It requires permission to create and drop `cgc_fuzz_*` databases on
`postgres://user:password@localhost:5432`. The source may be on another local
server. It compiles with `SQLX_OFFLINE=true` because a local corpus may omit
unrelated tables used by workspace SQLx macros. Set `--scratch-url` if needed.
`--keep-output` retains raw JSON under
`/tmp` for private investigation; those files contain message content.

## Shared message UI differential harness

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
