# Local Passwords vault

The local xtask Compose override starts OpenBao 2.7.2 in normal server mode. Its
HTTP API is bound to `127.0.0.1:8200` (the allocated `OpenBao` port for a named
instance), never to the browser reverse proxy. Rust
services reach `http://openbao:8200` on the instance's services network.
The server bounds requests to 90 seconds; hosted providers must enforce the same
maximum so the enrollment cleanup grace safely covers delayed setup requests.

Each Compose project has a named `<compose-project>_openbao_data` volume mounted
at `/openbao/file`. Single-node integrated Raft stores data at `/openbao/file/data`
with node ID `macro-local` and cluster address `https://127.0.0.1:8201`. On first start,
`start.sh` generates a raw 32-byte seal key from `/dev/urandom` at
`/openbao/file/seal.key`, starts the server, and initializes it once. The static
seal uses key ID `macro-local-v1` and automatically unseals on subsequent starts.
Initialization writes the root bootstrap token and recovery keys to
`/openbao/file/bootstrap.json` with mode `0600`; they never enter git or application
service environments. No manual unseal or team reseed is needed after a container
restart, stack restart, or host reboot.

The encrypted vault, its seal key, and initialization credentials share the local
volume. Anyone who can read that volume can recover its contents. Use synthetic
items only; this convenience is never suitable for hosted dev or production.
Hosted environments require an approved KMS auto-unseal, storage, backup, recovery,
TLS, provisioning identity, and durable audit design.

Environment generation creates a dedicated RSA signing key and verification key
under `infra/local/generated/<instance>/passwords-jwt.{private,public}.pem`.
It injects `OPENBAO_ADDRESS`, `PASSWORDS_JWT_SIGNING_KEY`, and
`PASSWORDS_JWT_ISSUER` into the local service environment. Private keys and generated
environment files are ignored by git. Applications receive no OpenBao root token.

After the local stack starts, copy the bootstrap credentials into the ignored
instance directory without printing them. Substitute the instance's actual
container name and allocated OpenBao host port below:

```sh
docker cp <instance-openbao-container>:/openbao/file/bootstrap.json \
  infra/local/generated/<instance>/openbao-bootstrap.json
chmod 600 infra/local/generated/<instance>/openbao-bootstrap.json
python3 infra/local/openbao/bootstrap.py \
  --init-file infra/local/generated/<instance>/openbao-bootstrap.json \
  --address http://127.0.0.1:8200 \
  --team-id <team-uuid> \
  --jwt-public-key infra/local/generated/<instance>/passwords-jwt.public.pem \
  --jwt-issuer macro-local-passwords
```

The provisioning logic lives in `infra/openbao/openbao_provisioning.py`, shared with the
hosted dev entrypoint (`infra/openbao/README.md`). Provision each new Macro team
explicitly. The bootstrap refuses remote origins
and redirects. It may be repeated: it preserves existing values and versions,
validates mount types, and reapplies policy/auth configuration.
It does not create teams or change Postgres.

Ordinary container and stack restarts retain namespaces, mounts, auth roles,
policies, values, versions, and TOTP seeds. Use `docker compose restart` with the
instance's project and Compose files for a non-destructive restart. Set
`MACRO_ENV_FILE` to the instance's absolute `local.generated.env` path when
invoking Compose manually; `--env-file` alone does not select the services'
environment file. Compose
`down` followed by `up` also preserves named volumes when `--volumes` is omitted.
The xtask `just stack up` and `just stack down` paths can reset metadata or remove
volumes; they are not the non-destructive restart procedure. Existing stack init
snapshots do not include the vault.

Back up the entire vault volume, including its seal key and initialization
credentials. Do not delete the volume or regenerate its seal key to repair startup.

When migrating an old `server -dev` instance, preserve its in-memory values before
replacing the container, or restore only the missing synthetic values once after
initializing and provisioning the persistent vault. Postgres metadata cannot
recover secret values. Keep Postgres and every other stack volume intact.

Each `team-<uuid>` namespace contains `passwords` (KV v2, CAS required, 100 versions),
`totp`, and JWT auth at `macro`. Role `passwords-service` accepts only RS256 JWTs
from the configured issuer with `sub=macro-passwords-service`, `aud=macro-passwords`,
and a matching `team_id`. It issues 60-second tokens with only `passwords-service`
policy and no default policy. The values policy grants KV data create/read/update,
metadata read, version destroy, TOTP key create/update/delete and code read only.
It cannot list/delete metadata, soft-delete/undelete data, read TOTP key settings,
or access namespace, auth or system endpoints. This preserves the CAS deletion fence.
JWT leeway is explicitly disabled; hosted issuer and provider clocks must stay
synchronized so credential expiration and cleanup deadlines remain bounded.
The JWT `audit_id` claim maps to token audit metadata for KV/auth correlation.
Operators can correlate HMAC-protected metadata through OpenBao's audit hash API;
TOTP HTTP requests also carry the nonsecret `x-macro-audit-id` header.
Declarative root namespace audit device `passwords` emits HMAC-redacted events to stdout;
never enable `log_raw`. Standard local container log rotation bounds retention.
Bootstrap allows the non-secret `x-macro-audit-id` header in cleartext audit records
so application trace IDs can correlate provider operations without revealing values.

Run the real-provider integration check against an isolated local OpenBao. Load
the bootstrap token from the ignored credentials file without printing it:

```sh
BAO_TOKEN="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["root_token"])' \
  infra/local/generated/<instance>/openbao-bootstrap.json)" \
PASSWORDS_TEST_OPENBAO_ADDRESS=http://127.0.0.1:8200 \
PASSWORDS_TEST_OPENBAO_CONTAINER=<instance-openbao-container> \
  python3 -m unittest discover -s infra/local/openbao -p 'test_*.py'
```

The check creates synthetic team namespaces and verifies JWT login, CAS/version
history, TOTP, repeatable bootstrap, cross-team denials, and audit correlation/redaction.
Audit-log inspection requires the explicit container name. The check does not reset the
vault. It deletes only synthetic namespaces it created. Never point it at a shared or hosted environment.

Run the disposable Docker lifecycle regression independently:

```sh
PASSWORDS_TEST_OPENBAO_PERSISTENCE=1 \
  python3 -m unittest discover -s infra/local/openbao -p 'test_persistence.py'
```

It creates its own Compose project and volume, initializes and provisions a vault,
and verifies KV values/history, TOTP, auth configuration, stable credentials, and
repeatable bootstrap after container restart and container recreation. It also
runs the configured provider checks against that disposable server. Cleanup
removes only that disposable project's containers and volume.

Upstream references: [namespaces](https://openbao.org/docs/concepts/namespaces/),
[JWT API](https://openbao.org/docs/api/auth/jwt/),
[server](https://openbao.org/docs/commands/server/),
[static seal](https://openbao.org/docs/configuration/seal/static/).

The local bootstrap also provisions JWT auth at `macro-lifecycle` in the parent
namespace. Role `team-<team-id>` binds lifecycle subject/audience and that team
claim, with read/delete limited to `sys/namespaces/team-<team-id>` and a 60-second
maximum TTL. It has no default policy. Services sign short-lived JWTs; the local
bootstrap token remains local and is never used at runtime. Hosted environments
require equivalent role provisioning before enabling namespace cleanup.

To include Rust checks, set `PASSWORDS_TEST_OPENBAO_RUST_BIN` to a compiled
passwords unit-test executable and set `DATABASE_URL` to an explicit disposable
metadata database when running the lifecycle regression. It runs all ignored Rust provider and import regressions serially against the
same disposable server, including namespace deletion acknowledgement and delayed
TOTP retirement with real metadata.

On first provisioning, bootstrap waits with bounded retries for a newly mounted
KV v2 backend to accept configuration. Existing configuration failures are not
retried or hidden.
