# Local Passwords vault

## What it is

Local-only OpenBao configuration and team provisioning for Passwords. The local
stack generator owns the container, instance volumes, and generated credentials.

## Start here

- `README.md`: startup, credentials, provisioning, and provider checks.
- `local.hcl`: storage, listener, seal, request timeout, and redacted audit device.
- `start.sh`: one-time seal key generation and initialization; restarts reuse both.
- `bootstrap.py`: local entrypoint and its loopback-only origin guard. The
  namespace, mount, policy, and JWT role setup lives in
  `../../openbao/openbao_provisioning.py`, which the hosted dev provisioning shares.
- `../../../tooling/xtask/crates/xtask_local/src/local/gen_compose.rs`: container
  and named-volume wiring; `local_env.rs` owns the service JWT signing identity;
  `openbao.rs` gates startup on initialized/unsealed health;
  `passwords_vault.rs` provisions every team after stack up and backs
  `just passwords_provision` for teams created later.

## Scope

- Owns local OpenBao lifecycle and provisioning only. Hosted dev and production
  require separately approved infrastructure and identities.
- Product authorization and provider operations belong in `crates/passwords`.

## Checks

- `python3 -m unittest discover -s infra/local/openbao -p 'test_*.py'` from the
  repository root; follow the README to enable real-provider checks.
- `PASSWORDS_TEST_OPENBAO_PERSISTENCE=1 python3 -m unittest discover -s
  infra/local/openbao -p 'test_persistence.py'`: disposable Docker lifecycle check.
- After lifecycle changes, verify initialized state, JWT login, KV values/history,
  TOTP, bootstrap idempotency, and audit redaction across container and stack restarts.
- Run `just check` after changes.

## Gotchas

- xtask stages `start.sh` and `local.hcl` into `infra/local/generated/<instance>/openbao/`
  with mode 0644 and mounts those copies, so private (umask 077) checkouts work;
  add any new mounted config file to `passwords_vault::CONFIG_FILES`.
- Keep the OpenBao startup wait bounded; a restarting container may never become unhealthy.
- Wait for a real status response before initialization; `operator init -status` also returns 2 when the listener is unreachable.

- Preserve `/openbao/file/data`, `seal.key`, and `bootstrap.json` together on the
  named volume; Postgres stores metadata only and cannot reconstruct lost
  credentials or TOTP seeds.
- Keep bootstrap credentials out of git, service environments, and logs. Read them
  through local credential files rather than putting tokens in command history.
- Keep the API loopback-bound and outside the browser proxy; bootstrap rejects
  remote origins and redirects.
- Never enable raw audit logging or reseed as part of an ordinary restart.
- Use Compose restart or recreation without volume deletion to preserve an
  instance; xtask up/down can reset metadata or volumes, and init snapshots omit Raft.

## Related

- [Passwords design](../../../docs/design/passwords.md)
- [Running locally](../../../docs/development/running-locally.md)

- Provision parent JWT mount `macro-lifecycle` locally, with one `team-<team-id>`
  role bound to the lifecycle subject/audience and that exact team claim. Grant
  only read/delete on the exact namespace path, no default policy, and 60-second
  maximum token TTL. Runtime services never receive the local bootstrap token.
- Provider cleanup tests delete their own synthetic namespaces and verify
  cross-team deletion denial, missing-role failure, and asynchronous completion.

- Retry only a newly mounted KV backend's temporary configuration failure within
  a bound; existing backend and authorization failures must remain visible.
