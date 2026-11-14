# convert_service

## What it is

Documents feature: converts uploaded Office documents (docx/xlsx/legacy
Office formats) into Macro documents using LibreOfficeKit, triggered
synchronously via HTTP or asynchronously via SQS.

## Start here

- `src/process/convert.rs` + `src/process/runner.rs`: the LibreOfficeKit
  conversion pipeline and the SQS-driven worker loop.
- `src/api/convert.rs`: the synchronous HTTP conversion endpoint.
- `src/api/backfill.rs` + `helpers/backfill.ts`: backfilling existing documents
  through conversion (bun script, hits the deployed gateway endpoint).
- `src/main.rs`: `smoke_test_lok` — forks a child process at startup to verify
  LibreOfficeKit's shared libraries load before accepting traffic.
- `src/job_folder.rs`: per-job working folders (`JobFolder`), the jobs root
  and the free-space check behind `/health`.

## Scope

- Owns: office-document-to-Macro conversion and its worker/backfill paths.

## Recipes

- Change conversion behavior: `src/process/convert.rs` → `src/process/test.rs`.
- Backfill existing documents: `helpers/backfill.ts` (`bun backfill`, needs
  `BASE_URL`/`INTERNAL_API_KEY`/`LIMIT`/`OFFSET` — see `helpers/README.md`).
- Load-test: `load-test/artillery.yml` (`artillery run artillery.yml`).

## Checks

- `cargo test -p convert_service` (`SQLX_OFFLINE` unset).

## Gotchas

- Startup fails fast if LibreOfficeKit can't load (`smoke_test_lok`); a
  conversion regression that looks like a code bug may actually be a missing
  LOK shared library in the environment.
- The `disable_worker`/`local_queue` Cargo features gate local-dev behavior —
  don't assume they're enabled in deployed builds. CI tests with
  `--all-features`, so a feature must not switch off behavior a test checks.
- Every conversion runs in a `JobFolder` under `JOBS_ROOT`
  (`$TMPDIR/convert_service_jobs`), created by `convert_file` and removed when
  it drops, on success, error or panic. The conversion child's `TMPDIR`
  points into it so LibreOffice's scratch files go with it. LibreOffice's
  user profile in `$HOME` is outside it; it does not grow across normal
  conversions, but a child killed at its timeout can leave lock files there.
  Startup empties `JOBS_ROOT`.
  Anything written elsewhere stays on the task's 20 GiB ephemeral disk until
  ECS replaces the task.
- `/health` returns 503 below `MIN_FREE_BYTES` free on the temp filesystem,
  so the gateway target group marks a task with a full disk unhealthy and ECS
  replaces it. A full disk looks like `No space left on device` or
  LibreOffice failing (`loadComponentFromURL returned an empty reference`,
  `Failed to save document`); check `ecs.fargate.ephemeral_storage.utilized`
  before debugging LibreOffice.
- Any `tracing::error!` inside `process_message` errors its span and counts
  toward the internal span error monitor; log expected outcomes (such as a
  job folder that is already gone) below `error`, and let the returned error
  mark real failures.
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
