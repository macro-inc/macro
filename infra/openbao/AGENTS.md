# openbao provisioning

## What it is

Passwords team provisioning for OpenBao, shared by the local stack, the hosted
dev vault, and the scoped provisioner. `bootstrap_root` sets up the root-level
pieces once (audit header, `macro-lifecycle` with its templated policy, the
provisioner identity and pinned policy). `provision_team` sets up each team
namespace (`passwords` KV v2, `totp`, JWT auth `macro` with role
`passwords-service`) and its `macro-lifecycle` role, and never deletes or
replaces secret values.

## Start here

- `openbao_provisioning.py`: the client, `provision_team` (create-only with
  `overwrite=False`, re-apply with `True`), `inspect_team`, `bootstrap_root`,
  and `render_provisioner_policy`. It never chooses an address.
- `provision.py`: hosted entrypoint. It talks only to
  `https://openbao-dev.macro-internal.com`, checks TLS against that name, and
  can connect through a loopback tunnel endpoint (`--connect`).
- `../local/openbao/bootstrap.py`: local entrypoint, with its own loopback-only
  HTTP guard.

## Checks

- `python3 -m unittest discover -s infra/openbao -p 'test_*.py'`; with a
  disposable OpenBao 2.7.2 it also runs the provisioner fixture tests (README).
- `python3 -m unittest discover -s infra/local/openbao -p 'test_*.py'`, plus
  the opt-in lifecycle check in `../local/openbao/README.md`
  (`PASSWORDS_TEST_OPENBAO_PERSISTENCE=1`). It runs the shared provisioning
  against a disposable vault.

## Gotchas

- Each entrypoint owns its origin guard. Never relax the local guard to reach a
  hosted vault, and never give `openbao_provisioning.py` an address of its own.
- Never print request or response bodies, tokens, JWTs, or values. Errors carry
  only the method, path, and status.
- Hosted runs read the root token from `BAO_TOKEN` (Doppler `openbao/dev`),
  never from argv. The issuer and public key come from the document storage
  service's Doppler values, so they match what it signs with.
- `overwrite=False` must stay create-only: a healthy team gets zero writes, and
  anything that differs raises `Incompatible` untouched. Write the lifecycle role
  before the namespace, so every namespace can be erased.
- The provisioner policy pins every parameter. OpenBao 2.7.2 matches a list only
  against a whole allowed list (pin `[["a", "b"]]`) and never matches JSON
  numbers (send `"100"`, `"-1"`). A key or issuer change re-renders the policy.
- Concurrent writes to one path can fail with 500 `transaction commit failed`,
  and a racing namespace POST with 400 `being created or deleted`; both re-read
  and verify. A namespace POST to an existing namespace returns 200 (an update).
