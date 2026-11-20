# Disposable import measurements

`benchmark.rs` is an ignored test that drives the real repository and OpenBao
adapters. It measures 25 items and 300 items (12 sequential batches), with every
fifth item enrolling TOTP. Each configuration runs three times, with the order
of 1, 2, 4, 8 and 16 item futures varied between repetitions. Each run starts
with a fresh provider cache, so the authentication span counts cold logins.
One logical import keeps the destination-folder population fixed throughout the
sweep; source keys are unique across configurations.

Use an isolated OpenBao container configured with the raft, seal and redacted
audit settings in `infra/local/openbao`. The disposable Docker fixture in
`test_persistence.py` shows the setup. Use the `json-file` Docker logging driver
with bounded rotation: journald rate limiting can discard audit records during
the sweep. Never point this test at a live vault or start a full application
stack for it.

Create and migrate the scratch database on the shared local PostgreSQL server.
Set the URL **inside** the Nix shell, since the shell has its own default:

```sh
nix develop --command bash -c '
  export DATABASE_URL=postgres://user:password@localhost:5432/macrodb_pwconc
  sqlx database create
  sqlx migrate run --source crates/macro_db_client/migrations
'
```

Provide the disposable container's loopback address, synthetic signing/public
key file paths, and bootstrap token through the existing
`PASSWORDS_TEST_OPENBAO_*` and `BAO_TOKEN` environment variables. Keep the token
in a private fixture file and never print it. The benchmark provisions only its
synthetic team. It prints that team's opaque ID; set `PWCONC_TEAM` to reuse the
same fixture on another run against the same scratch database.

Start `docker logs --follow` for that container before the test and save its
redacted audit output to a private file. The test exports spans to the existing
collector at `127.0.0.1:4317`; it does not create or restart a collector.

```sh
nice -n 19 ionice -c3 nix develop --command bash -c '
  export DATABASE_URL=postgres://user:password@localhost:5432/macrodb_pwconc
  export CARGO_BUILD_JOBS=2 TMPDIR=/home/wolf/tmp PWCONC_MODE=after
  unset SQLX_OFFLINE
  cargo test -p passwords import_performance -- --ignored --nocapture --test-threads=1
' > /private/fixture/bench.log 2>&1

python3 crates/passwords/src/outbound/postgres/import/test/summarize.py \
  --runs /private/fixture/bench.log --audit /private/fixture/audit.log
```

The summary requires every expected request/response audit pair. Provider
latency is OpenBao's audit request-to-response time; wall time includes client
and database work too. The fully warmed pool is drained and eagerly returned between configurations.
Acquisition/return hooks count checked-out connections (including pending return
work); the output also retains the raw `size - num_idle` maximum and an occupancy
histogram sampled at acquisitions. The raw snapshot can include connections in
pool handoff/maintenance. Acquire wait comes from SQLx's acquisition event. Lease spans measure guard
lifetime through awaited release. Inspect the printed trace IDs in Tempo:
`passwords.import.item` spans must parent directly to their batch and overlap
up to the effective concurrency. Batch results must all be `created`.

For a before/after comparison, run the original sequential item loop with the
same token cache, fixture, tracing and logging. The N=1 configuration in the
sweep is an additional control that isolates concurrency from the change to
one batch lease. Stop/remove the disposable container and its volume and drop
`macrodb_pwconc` after validation.
