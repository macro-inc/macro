# Call guest chat differential harness

This harness runs the same `messages` service operations against `origin/main`
and the current branch. It copies the corpus into two scratch databases on the
local Postgres, so the source database is read only. Probe output and database
dumps stay under `/tmp`; the report contains counts, operation keys and IDs,
never message bodies. It also compares `ChannelSender::parse_from_str` on 20,000
seeded and adversarial inputs. The one allowed parser difference is a canonical
`participant:<uuid>` value.

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
channel participants, calls, and referenced account and parent rows. The
runner clones this prepared database. Keep dumps and restored databases under
local control and delete them after use.

The runner uses `pg_dump`/`pg_restore`, `cargo test`, and `psql` from the Nix
flake. It requires permission to create and drop `cgc_fuzz_*` databases on
`postgres://user:password@localhost:5432`. The source may be on another local
server. It compiles with `SQLX_OFFLINE=true` because a local corpus may omit
unrelated tables used by workspace SQLx macros. Set `--scratch-url` if needed.
`--keep-output` retains raw JSON under
`/tmp` for private investigation; those files contain message content.
