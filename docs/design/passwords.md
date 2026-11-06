# Passwords

Passwords is a Macro-managed **team vault**. Macro servers decrypt values to
serve authorized humans. This is not a zero-knowledge personal password manager:
the service, its operators, and its infrastructure are inside the trust boundary.
The `enable-passwords` PostHog flag controls discovery; authorization remains
mandatory regardless of the flag.

## Model and boundaries

`crates/passwords` owns items, typed fields, versions, folders, user/team grants,
favorites, last use, and activity. Its domain service owns authorization and
recent-authentication policy. Inbound Axum handlers translate authenticated
requests; PostgreSQL and OpenBao implement repository and secret-provider ports.
The provider boundary allows future 1Password and Bitwarden implementations.

Document storage hosts the routes because it already owns the authenticated
content API, database pool, and browser transport. A separate deployable service
would add configuration and operational overhead without changing the security
boundary: secret-provider credentials stay server-side either way.

Postgres stores the searchable metadata index and grants, never field values,
notes, passwords, TOTP seeds, or historical secret payloads. OpenBao KV v2 holds
versioned payloads. Reads of list/detail/history metadata do not resolve values.
Explicit reveal/copy and TOTP-code operations require recent authentication and
return `Cache-Control: no-store`. Updating metadata and external payloads needs
version guards: an interrupted provider write must never publish metadata that
points at missing values. Authorization must precede every provider operation.

Durable metadata-only intents correlate accepted writes with their logical
operation IDs. Recovery that resolves a provider operation marker runs only
during explicitly authorized mutations or recent-authenticated disclosure;
ordinary metadata reads never fetch payloads. Deletes retain a provider metadata
fence so a delayed write cannot recreate values after deletion.
Nonblocking team vault locks serialize changes across replicas and protect folder
assignments and grant revocation; contention returns a retryable conflict.

Each TOTP setup uses a unique enrollment key and journals its identity before
contacting OpenBao. Replacement switches the active pointer only after setup;
activation and user removal compare the authorized metadata revision so a lost
lease cannot let an older request override a newer enrollment decision.
Removal and item deletion retire enrollments. A tracked worker quarantines retired
and abandoned enrollments under the team lease, then erases them after 180 seconds,
preserving the active generation. Retained tombstones schedule hourly erasure
retries even after success, covering arbitrarily delayed provider completions
after a lost database lease. The grace covers the 60-second runtime token, a
provider request bound of at most 90 seconds, and clock margin. Hosted OpenBao
must enforce that bound and synchronized clocks with JWT leeway disabled.

## OpenBao

Use OpenBao, not the BSL-licensed Vault distribution. A namespace per team
isolates engines, policies, and tokens. Within it, `passwords` is the KV v2
mount and `totp` the TOTP mount; item UUIDs identify KV keys and enrollment UUIDs
identify TOTP keys. The provider chooses
the namespace from the authenticated team's identity, never a caller-supplied
provider path. The bootstrap script provisions mounts and JWT roles idempotently.

Macro-issued JWTs use a dedicated audience, short expiry, and a team claim bound
by the namespace's JWT role. Runtime policy allows only the required KV/TOTP
paths. Runtime tokens cannot create namespaces, policies, or auth roles. A
separate provisioning identity owns those operations; never ship a root token
to the browser or use it for hosted runtime requests. Agents may become typed
grantees later, but v1 exposes no agent tool, requests, approvals, or agent UI.

OpenBao's encrypted storage barrier provides envelope encryption. Namespaces are
authorization boundaries; they do **not** imply independently revocable team
encryption keys. Hosted deployment requires KMS auto-unseal and a reviewed
per-team envelope/key lifecycle before claiming per-team key isolation or BYOK.
Never represent an unimplemented encryption layer as shipped protection.

## Disclosure and auditing

Reveal, copy, historical-value disclosure, and current TOTP codes require a
signed authentication time within five minutes. Token refresh must not advance
that time. Missing, expired, or future authentication times fail closed; the UI
must complete an interactive login before retrying. API keys and agent identities
cannot obtain human disclosure privileges.

The human-session-only vault endpoints are deliberately excluded from SDK entity
wrappers in v1. They require interactive reauthentication and must not appear as
agent capabilities. Generated OpenAPI contracts still describe the HTTP API.

Secret wrappers redact debug output and zeroize application-owned plaintext on
drop. HTTP buffers and browser memory cannot guarantee immediate erasure: keep
their lifetime short and never persist values in browser storage. Traces contain
only opaque IDs, operation names, counts, and audit correlation. Provider error
bodies, item names, values, and TOTP material must never become log attributes.
The `vaultrs` futures disable their internal subscriber because its HTTP library
can trace raw provider error bodies; Macro retains sanitized outer provider spans.
OpenBao's audit device and Macro's activity records complement each other; a
failed audit write must not silently produce an unaudited disclosure.

## Logos

Browsers fetch authenticated Macro image-proxy `/logos?domain=…` responses.
The server requests only HTTPS `/favicon.ico`, limits time, redirects and body
size, rejects non-raster media, and checks public IPs both before requests and
at DNS resolution. A bounded in-memory cache stores public logo bytes only.
Unavailable or refused logos display the item's letter tile. No browser calls
an external icon service.

## Operations

Local development runs an isolated, loopback-bound single-node OpenBao with
development auto-unseal. Development mode is ephemeral; restarting it loses
values, so metadata cannot be treated as recovered vault contents. The bootstrap
script accepts a team and local JWT verification settings and must be rerun after
that restart. Never use development mode or local bootstrap credentials on a
hosted environment.

Hosted dev and production require explicit configuration and provisioning:
TLS, KMS auto-unseal, persistent replicated storage, backups with restore drills,
restricted networking, least-privilege runtime identities, durable audit storage,
rotation, and monitored availability. This change does not deploy OpenBao or
alter production. Disable discovery until the backing environment is ready.
Provision team namespaces explicitly before use. Team deletion does not yet
provision provider teardown: operators must purge the team's OpenBao namespace
before deleting the Macro team, because deleting its metadata also removes
enrollment cleanup journals. The runtime identity cannot administer namespaces.

Future work includes independently managed team envelopes/BYOK, end-to-end
encrypted private items, provider adapters, and agent grants with explicit
approval policy. Those features change the trust or authorization model and
require separate review.
