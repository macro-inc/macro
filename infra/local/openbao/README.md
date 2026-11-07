# Local Passwords vault

The local xtask Compose override starts OpenBao 2.7.2 in development mode, already
initialized and unsealed. Its HTTP API is bound to `127.0.0.1:8200` (the allocated
`OpenBao` port for a named instance), never to the browser reverse proxy. Rust
services reach `http://openbao:8200` on the instance's services network.
The server bounds requests to 90 seconds; hosted providers must enforce the same
maximum so the enrollment cleanup grace safely covers delayed setup requests.

**Development mode is ephemeral:** restarting OpenBao loses its values, namespaces,
and configuration. Postgres metadata survives independently. Use synthetic items;
rerun bootstrap after a restart. This mode is never suitable for hosted dev or
production. Persistent hosted environments require an approved KMS auto-unseal,
storage, backup, recovery, TLS, provisioning identity, and durable audit design.

Environment generation creates a dedicated RSA signing key and verification key
under `infra/local/generated/<instance>/passwords-jwt.{private,public}.pem`.
It injects `OPENBAO_ADDRESS`, `PASSWORDS_JWT_SIGNING_KEY`, and
`PASSWORDS_JWT_ISSUER` into the local service environment. Private keys and generated
environment files are ignored by git. Applications receive no OpenBao root token.

After the local stack starts, provision each existing Macro team explicitly:

```sh
BAO_TOKEN=macro-local-passwords-bootstrap python3 infra/local/openbao/bootstrap.py \
  --address http://127.0.0.1:8200 \
  --team-id <team-uuid> \
  --jwt-public-key infra/local/generated/<instance>/passwords-jwt.public.pem \
  --jwt-issuer macro-local-passwords
```

For a named instance, substitute its allocated OpenBao host port. The bootstrap
refuses remote origins and redirects. It may be repeated: it preserves existing
values and versions, validates mount types, and reapplies policy/auth configuration.
It does not create teams or change Postgres.

Each `team-<uuid>` namespace contains `passwords` (KV v2, CAS required, 100 versions),
`totp`, and JWT auth at `macro`. Role `passwords-service` accepts only RS256 JWTs
from the configured issuer with `sub=macro-passwords-service`, `aud=macro-passwords`,
and a matching `team_id`. It issues 60-second tokens with only `passwords-service`
policy and no default policy. The policy has no namespace, auth, or system rights.
JWT leeway is explicitly disabled; hosted issuer and provider clocks must stay
synchronized so credential expiration and cleanup deadlines remain bounded.
The JWT `audit_id` claim maps to token audit metadata for KV/auth correlation.
Operators can correlate HMAC-protected metadata through OpenBao's audit hash API;
TOTP HTTP requests also carry the nonsecret `x-macro-audit-id` header.
Declarative root namespace audit device `passwords` emits HMAC-redacted events to stdout;
never enable `log_raw`. Standard local container log rotation bounds retention.
Bootstrap allows the non-secret `x-macro-audit-id` header in cleartext audit records
so application trace IDs can correlate provider operations without revealing values.

Run the real-provider integration check against an isolated local dev OpenBao:

```sh
BAO_TOKEN=macro-local-passwords-bootstrap \
PASSWORDS_TEST_OPENBAO_ADDRESS=http://127.0.0.1:8200 \
PASSWORDS_TEST_OPENBAO_CONTAINER=<instance-openbao-container> \
  python3 -m unittest discover -s infra/local/openbao -p 'test_*.py'
```

The check creates synthetic team namespaces and verifies JWT login, CAS/version
history, TOTP, repeatable bootstrap, cross-team denials, and audit correlation/redaction.
Audit-log inspection requires the explicit container name. The check does not reset the
vault or delete namespaces. Never point it at a shared or hosted environment.

Upstream references: [namespaces](https://openbao.org/docs/concepts/namespaces/),
[JWT API](https://openbao.org/docs/api/auth/jwt/),
[development server](https://openbao.org/docs/commands/server/).
