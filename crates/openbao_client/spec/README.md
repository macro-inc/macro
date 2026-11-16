# Mounted OpenBao 2.7.2 API

`openbao-2.7.2-root.json` and `openbao-2.7.2-team.json` are verbatim HTTP response
bodies from **GET /v1/sys/internal/specs/openapi**, captured on a disposable local
OpenBao on 2026-11-11. They contain schema descriptions, no credentials or values.

- Image: `openbao/openbao:2.7.2`
- Image digest: `sha256:5046911075e137e154ce49ab051502f4ec7cf367d484ae4a4dce665d9b90561f`
- Server version SHA: `9e0a0d3c3504a0a00b45e61355afac5e35c78379`
- Root source SHA256: `24256629bd88e7e3c5e1d72dfda6d58eea947da0d60d32c3718864cf157f1cea`
- Team source SHA256: `f4bb91cd38fc7e39c5de4df7545d9943e3fa567f3022c37ecf732ecc592e736d`
- Team namespace: `team-00000000-0000-7000-8000-000000000272` (synthetic).
- Loopback listener: `127.0.0.1:18272`, cluster listener `127.0.0.1:18273`.
- Root auth: JWT `macro-lifecycle/`; team auth: JWT `macro/`.
- Team engines: `passwords/` KV v2 (`cas_required=true`, `max_versions=100`),
  `totp/` TOTP. Namespace API is the root system backend.
- Provisioning: `infra/local/openbao/bootstrap.py`, issuer `macro-local-passwords`,
  fresh synthetic RSA public key, exact JWT subjects/audiences/team claims and
  policies from that script; no runtime root token. Root declarative audit device
  `passwords` writes HMAC-protected events with `log_raw=false`.

Capture used normal server mode, static seal and Raft from
`infra/local/openbao/local.hcl` with only the listener/API/cluster addresses changed
as above. Docker used `--network host`, allocating no network pool. Bind storage
was a new restricted directory outside the repository; no preview or shared volume
was mounted. The private signing key and initialization response were mode 0600
outside the repository. Initialization used local `PUT /v1/sys/init` with
`recovery_shares=1,recovery_threshold=1`; its response was written directly to the
restricted file, never printed. The root token was used only by local bootstrap,
spec capture and synthetic protocol probes. Applications receive only JWTs.

## Capture again

Start a fresh isolated normal-mode 2.7.2 server with the configuration above and
initialize it into a restricted local file. Generate a fresh RSA signing key and
its public key outside the repository, and provision the synthetic team:

```sh
python3 infra/local/openbao/bootstrap.py \
  --address http://127.0.0.1:18272 --init-file /outside/repo/bootstrap.json \
  --team-id 00000000-0000-7000-8000-000000000272 \
  --jwt-public-key /outside/repo/public.pem --jwt-issuer macro-local-passwords
python3 crates/openbao_client/spec/capture.py \
  --address http://127.0.0.1:18272 --init-file /outside/repo/bootstrap.json
python3 crates/openbao_client/spec/patch.py
nix develop --command crates/openbao_client/regen.sh
```

The capture command verifies exact version and mount types and refuses redirects,
remote origins and broadly readable bootstrap files. Wait for the server's ready
signal before initialization/bootstrap. Use the project build slot for regeneration;
it compiles a standalone generator. Do not invoke the shared preview reset scripts.
Stop only the disposable container after tests; no volume deletion is necessary.

## Normalization and limitations

Root and team sources are intentionally separate: root does not describe mounted
team KV/TOTP/JWT paths; team does not describe parent lifecycle JWT login. Source
selection is explicit in `KEPT_OPERATIONS`. The patch fails on missing operations,
keeps only called methods, prepends `/v1`, assigns mount-specific operation IDs,
and writes sorted JSON. The first team capture during plugin startup differed from
the settled capture; repeated settled capture and normalization were identical.

Plugin specs omit OpenBao's `data`/`auth` envelopes, most KV/TOTP success schemas,
headers and error envelopes. Namespace field schemas describe inner data only.
The patch supplies typed namespace/token/audit headers, exact KV CAS/options,
metadata versions/deletion/destroyed fields, JWT token, TOTP code and namespace
response envelopes. Arbitrary KV payloads stay generic because this client must
not define the application's stored secret schema. Generated secret string/data
references are replaced with redacted types by the generator configuration.

Importing an existing TOTP key and destroying KV versions return 204 despite the
source's documented 200. Namespace DELETE may return 200 or 204: both mean only
accepted, and only a later authenticated GET 404 acknowledges erasure. The wrapper
never deserializes a deletion status as proof. Missing/destroyed KV data can return
a 404 without `errors`, so the error envelope defaults the array to empty.

CAS mismatch is HTTP 400 and is identified by the **exact** server error message;
other 400s stay rejections. For TOTP code reads only, OpenBao returns HTTP 400
`unknown key: <requested name>` when a key is missing; an exact match is NotFound,
while other messages remain rejections. Missing namespace is a separate 404 cause.
HTTP 401/403 remain authentication/policy failures. Provider messages remain secret-wrapped
and never appear in Debug, Display, error source chains or tracing.

`regen.sh` mirrors `crates/incus_client/regen.sh`: pinned progenitor 0.15.1,
openapiv3 2.2.0, temporary standalone generator workspace, positional methods,
BTreeMap maps, line-doc normalization, prettyplease and rustfmt. The AST visitor
marks only progenitor's unused `ConversionError` helper with a narrow lint
expectation; a future converted parameter that uses it must remove that expectation.
Never hand-edit `openapi.json` or `src/generated.rs`.
