# openbao provisioning

## What it is

Passwords team provisioning for OpenBao, shared by the local stack and the
hosted dev vault. It sets up each team namespace (`passwords` KV v2, `totp`,
JWT auth `macro` with role `passwords-service`) and the parent `macro-lifecycle`
role, and never deletes or replaces secret values.

## Start here

- `openbao_provisioning.py`: the client, the KV retry, and `provision_team`, which
  holds the policy and role logic. It never chooses an address.
- `provision.py`: hosted entrypoint. It talks only to
  `https://openbao-dev.macro-internal.com`, checks TLS against that name, and
  can connect through a loopback tunnel endpoint (`--connect`).
- `../local/openbao/bootstrap.py`: local entrypoint, with its own loopback-only
  HTTP guard.

## Checks

- `python3 -m unittest discover -s infra/openbao -p 'test_*.py'`
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
