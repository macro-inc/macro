# capsolver_emulator

## What it is

Test support for the agent harness's CAPTCHA gateway (`/brain/captcha/solve`):
a stand-in for CapSolver's `createTask` / `getTaskResult` API that answers
scripted outcomes instead of solving anything. The gateway's CapSolver adapter
runs against it in `cargo test`, as a standalone process, or (later) as part
of a local stack. CapSolver is never called.

## How it works

- `CapsolverEmulator::start()` listens on a `127.0.0.1` port; `cargo run -p
  capsolver_emulator` is the same emulator as a process (`--listen`, default
  `127.0.0.1:8483`).
- It accepts the five token task types the gateway sends
  (`ReCaptchaV2[Enterprise]TaskProxyLess`, `ReCaptchaV3[Enterprise]TaskProxyLess`,
  `AntiTurnstileTaskProxyLess`); any other is `ERROR_TASK_NOT_SUPPORTED`. An
  empty `clientKey` is `ERROR_KEY_DENIED_ACCESS` (401); a missing
  `websiteURL`/`websiteKey` is `ERROR_INVALID_TASK_DATA`.
- A task is answered the `Outcome` scripted for its `websiteKey`, `ready`
  when none is: `ready`, `processingThenReady { polls }`, `processing`
  (forever), `unsolvable`, `timeout`, `rateLimited` and `zeroBalance` (the
  last two fail `createTask`). Errors come back as CapSolver's
  `errorId: 1` body with a 400.
- The token is `emulated-token-<taskId>`: `gRecaptchaResponse` for
  reCAPTCHA, `token` with `type: "turnstile"` for Turnstile, both with a
  `userAgent`.
- `/_emulator/…` is the control API: `PUT /_emulator/outcomes/{siteKey}`
  with `{"outcome": "..."}`, `GET /_emulator/tasks` (the last 500
  `createTask` requests, with the task id each got and `clientKeySent`;
  the `clientKey` itself is never kept or returned, since a service may
  send a real key here).
- A service reaches it through `OVERRIDE_CAPSOLVER_API_URL`
  (`macro_service_urls::CapsolverApiUrl`).

## Start here

- `src/lib.rs`: `CapsolverEmulator`, `Outcome`, `CreatedTask`.
- `src/routes.rs`: the CapSolver routes and the control API.
- `src/test.rs`: each outcome over HTTP.

## Scope

- Owns: the two calls the harness's CapSolver adapter makes.
- Not here: `getToken`, `getBalance`, image and proxy tasks, Cloudflare
  Challenge.

## Checks

- `cargo test -p capsolver_emulator`.
