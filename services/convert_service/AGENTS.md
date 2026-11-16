# convert_service

## What it is

Documents feature: converts uploaded Office documents (docx/xlsx/legacy
Office formats) into Macro documents using LibreOfficeKit, triggered
synchronously via HTTP or asynchronously via SQS.

## Start here

- `src/process/convert.rs` + `src/process/runner.rs`: the LibreOfficeKit
  conversion pipeline and the SQS-driven worker loop.
- `src/process/child.rs`: `run_confined`, the forked child process every
  LibreOfficeKit call runs in.
- `src/scratch.rs` + `src/disk.rs`: the job folders conversions write to, and
  the free-space check behind `/health`.
- `src/api/convert.rs`: the synchronous HTTP conversion endpoint.
- `src/api/backfill.rs` + `helpers/backfill.ts`: backfilling existing documents
  through conversion (bun script, hits the deployed gateway endpoint).
- `src/main.rs`: `smoke_test_lok` — forks a child process at startup to verify
  LibreOfficeKit's shared libraries load before accepting traffic.

## Scope

- Owns: office-document-to-Macro conversion and its worker/backfill paths.

## Recipes

- Change conversion behavior: `src/process/convert.rs` → `src/process/test.rs`.
- Backfill existing documents: `helpers/backfill.ts` (`bun backfill`, needs
  `BASE_URL`/`INTERNAL_API_KEY`/`LIMIT`/`OFFSET` — see `helpers/README.md`).
- Load-test: `load-test/artillery.yml` (`artillery run artillery.yml`).

## Checks

- `cargo test -p convert_service` (`SQLX_OFFLINE` unset).
- The tests that convert real documents are `#[ignore]`d and need LibreOffice
  on the host: `LOK_PATH=/usr/lib/libreoffice/program cargo test -p
  convert_service -- --include-ignored`. Run them after changing
  `src/process/`. A test binary built in the Nix shell does not search the
  system's library directories; put LibreOffice's program directory and the
  libraries it needs (not glibc) on the binary's `LD_LIBRARY_PATH` with
  `CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER='env LD_LIBRARY_PATH=...'`.

## Gotchas

- Startup fails fast if LibreOfficeKit can't load (`smoke_test_lok`); a
  conversion regression that looks like a code bug may actually be a missing
  LOK shared library in the environment.
- The `disable_worker`/`local_queue` Cargo features gate local-dev behavior;
  don't assume they're enabled in deployed builds.
- Deploys are off (`deploy_enabled: false` in `.github/services-config.json`),
  so merging does not change what dev and prod run. Check the running image
  before assuming a merged fix is live.
- Every attempt converts in its own folder under the scratch root
  (`$TMPDIR/convert_service/jobs`), removed when its `JobFolder` drops, and
  startup empties the scratch root. Write a job's files nowhere else.
- A killed LibreOffice cleans up nothing, so `run_confined` makes the job
  folder the child's working directory, `HOME` and `TMPDIR`, turns core dumps
  off, and kills the child's process group at the time limit. Only caches are
  shared between jobs (`XDG_CACHE_HOME`): rebuilding the font cache costs over
  a second per conversion.
- The child is a fork of a multi-threaded process, so a lock another thread
  held at the fork is never released in it. In the child, never log (the
  parent logs the error the work returns) and set the environment with
  `set_child_env`, never `std::env::set_var`.
- `Converter` runs one conversion per CPU at a time, on blocking threads. On
  the async workers a conversion starves the health check; unbounded, a batch
  of messages starts a LibreOffice each.
- Below `MIN_FREE_BYTES` or `MIN_FREE_INODES` (`src/disk.rs`), `/health`
  returns 503 so ECS replaces the task, the worker stops receiving, and
  `/internal/convert` returns 503. A full disk on a build without this looks
  like LibreOffice failing (`loadComponentFromURL returned an empty
  reference`, `Failed to save document`) next to `No space left on device`;
  see the [runbook](../../docs/runbooks/convert-service.md).
- Any `tracing::error!` inside `process_message` errors its span and counts
  toward the internal span error monitor; log expected outcomes below
  `error`, and let the returned error mark real failures.
- The convert queue's visibility timeout (`infra/stacks/convert-service`)
  must stay above `conversion_timeout`; failed messages go to the DLQ after
  their second receive.
- DOCX conversions report `Completed`/`Failed` to the job update Lambda
  (`WEB_SOCKET_RESPONSE_LAMBDA`) only when the message's `notify_job` is set
  (`job_update` in `src/process/convert.rs`). The Lambda fails on job ids it
  doesn't track, and async invocation retries each failure twice, so a
  producer that mints its own `job_id` must send `notify_job: false`.

## Related

- Rules: `.agents/rules/config-and-service-urls.md`
