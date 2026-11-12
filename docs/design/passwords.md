# Passwords

Passwords is a Macro-managed **team vault**. Macro servers decrypt values to
serve authorized humans. This is not a zero-knowledge personal password manager:
the service, its operators, and its infrastructure are inside the trust boundary.
The `enable-passwords-v1` PostHog flag controls discovery and backend admission; authorization remains
mandatory regardless of the flag.

## Model and boundaries

`crates/passwords` owns items, typed fields, versions, folders, user/team grants,
favorites, last use, and activity. Its domain service owns human membership, grant and administrator policy. Inbound Axum handlers translate authenticated
requests; PostgreSQL and OpenBao implement repository and secret-provider ports.
The provider boundary allows future 1Password and Bitwarden implementations.

Document storage hosts the routes because it already owns the authenticated
content API, database pool, and browser transport. A separate deployable service
would add configuration and operational overhead without changing the security
boundary: secret-provider credentials stay server-side either way.

Postgres stores the searchable metadata index and grants, never field values,
notes, passwords, TOTP seeds, or historical secret payloads. OpenBao KV v2 holds
versioned payloads. Reads of list/detail/history metadata do not resolve values.
Password reveal/copy and TOTP-code operations require normal human item access and
return `Cache-Control: no-store`. Updating metadata and external payloads needs
version guards: an interrupted provider write must never publish metadata that
points at missing values. Authorization must precede every provider operation.

Selecting an item resolves its non-secret username through a separate,
human-authorized projection. Only the username and committed version reach the
browser; passwords, notes, and custom fields stay protected. Username copies are
explicitly audited. Display reads leave the mutation lease free for interactive
actions and recheck current authorization and revisions after the provider read.
Explicit copies retain the lease. Neither endpoint populates the metadata
index or browser query cache. Sharing counts derive from distinct explicit
user/team grants already loaded with metadata; a team grant counts as one share.

Durable metadata-only intents correlate accepted writes with their logical
operation IDs. Recovery that resolves a provider operation marker runs only
during explicitly authorized mutations or disclosure;
ordinary metadata reads never fetch payloads. Deletes retain a provider metadata
fence so a delayed write cannot recreate values after deletion.
Nonblocking team vault locks serialize changes across replicas and protect folder
assignments and grant revocation. Rollout and membership are checked before
lease admission and access is rechecked under the lease. Contention returns
typed `vault_busy`, distinct from `version_conflict`; the client uses at most
three attempts with jittered exponential backoff and traces the retry count. Journal
publication locks the actual publisher's membership row until the intent commits,
serializing publication with membership revocation. If revocation already committed, publication
fails without leaving an unseen intent. Every disclosure shares a post-provider-I/O
access check, so a lost lease cannot return values after access was revoked. A
denied recheck records `post_io_access_denied=true`; verification codes also require
the same active enrollment generation.

Each TOTP setup uses a unique enrollment key and journals its identity before
contacting OpenBao. Replacement switches the active pointer only after setup;
activation and enrollment removal compare the authorized metadata revision so a lost
lease cannot let an older request override a newer enrollment decision.
Removal and item deletion retire enrollments. A tracked worker quarantines retired
and abandoned enrollments under the team lease, then erases them after 180 seconds,
preserving the active generation. Never-erased enrollments and initial quarantine
receive priority over acknowledged hourly repeats in each bounded batch. Erasure
acknowledgement is explicit; journal tombstones remain indefinitely while the
namespace exists. Retained tombstones schedule hourly erasure retries even after
success, covering arbitrarily delayed provider completions
after a lost database lease. The grace covers the 60-second runtime token, a
provider request bound of at most 90 seconds, and clock margin. Hosted OpenBao
must enforce that bound and synchronized clocks with JWT leeway disabled.

## Team ownership and deletion

Items belong to the team; `Record.user_id` records the immutable creator. New items
include a team Edit grant unless `private=true`. Updates preserve grants; sharing
replaces grants explicitly. Current human team administrators can view, edit,
delete and change access to private items after their creator leaves. `canManage`,
`canEdit` and `sharedWithTeam` are actor-specific response fields, never stored
authority. `canEdit` reflects current edit grants or administrator access; a view-only
recipient can reveal/copy but cannot edit fields or verification-code enrollment.
Edit recipients can edit without creator/administrator grant-management privileges.
Private means no team grant; direct recipients and administrators may retain access.

Membership removal and account deletion do not erase items, transfer creators or
create Passwords lifecycle journals. Every access uses current membership, and
post-provider-I/O rechecks prevent values returning after revocation. Ordinary
membership compensation stays unchanged.

Team deletion invokes the existing owned-entity cleanup preflight before ordinary
entity/session/billing side effects. Authoritative empty metadata means no vault
RPC or provider work. The caller rechecks emptiness under the existing vault lease
and retains its opaque guard in `ClearedTeam` through ordinary team deletion, so a
first create cannot race the proof. If data appears under that lease, release it
before DSS takes the same lease for namespace purge. Any retained item or tombstone requires
the internal team purge, with the same global rollout and provider gate as human
admission. Off-existing, remote error and absent provider configuration fail before
ordinary team cleanup. Namespace erasure precedes metadata purge; incomplete
erasure retains retry identities and the closed-team fence.

The global rollout evaluates `enable-passwords-v1` for explicit service context
`passwords-v1` through the shared strict feature_flags transport. Human admissions
also require the same key for the authenticated actor, matching frontend discovery.
Configure the service context explicitly alongside the intended human cohorts. Local
composition enables both explicitly; missing/error results in either never default on.
Both bounded jobs gate before discovery: explicit failed-item deletion and retained
TOTP generation cleanup pause while off and resume on enablement. No person-erasure
queue or per-person fence is used.

## OpenBao

Use OpenBao, not the BSL-licensed Vault distribution. A namespace per team
isolates engines, policies, and tokens. Within it, `passwords` is the KV v2
mount and `totp` the TOTP mount; item UUIDs identify KV keys and enrollment UUIDs
identify TOTP keys. The provider chooses
the namespace from the authenticated team's identity, never a caller-supplied
provider path. The bootstrap script provisions mounts and JWT roles idempotently.

Macro-issued JWTs use a dedicated audience, short expiry, and a team claim bound
by the namespace's JWT role. Value-role policy allows only the required KV/TOTP
paths; the separate lifecycle role permits exact-team namespace read/delete.
Runtime tokens cannot create namespaces, policies, or auth roles. A
separate provisioning identity owns those operations; never ship a root token
to the browser or use it for hosted runtime requests. Agents may become typed
grantees later, but v1 exposes no agent tool, requests, approvals, or agent UI.

OpenBao's encrypted storage barrier provides envelope encryption. Namespaces are
authorization boundaries; they do **not** imply independently revocable team
encryption keys. Hosted deployment requires KMS auto-unseal and a reviewed
per-team envelope/key lifecycle before claiming per-team key isolation or BYOK.
Never represent an unimplemented encryption layer as shipped protection.

## Disclosure and auditing

Reveal/copy, history, username and TOTP codes require normal authenticated human
item access, without a separate reauthentication step. Session origin alone is
insufficient: fresh authoritative `User.isAgent=false` is required even when agent
claims are absent. Missing classification fails closed. Direct recipients must be
canonical current human members; team grants never admit an agent account.

These human-only endpoints are excluded from SDK entity wrappers and agent
capabilities in v1. Generated OpenAPI contracts describe the HTTP API.

Secret wrappers redact debug output and zeroize application-owned plaintext on
drop. HTTP buffers and browser memory cannot guarantee immediate erasure: keep
their lifetime short and never persist values in browser storage. Traces contain
only opaque IDs, operation names, counts, and audit correlation. Provider error
bodies, item names, values, and TOTP material must never become log attributes.
The `openbao_client` wrapper calls only the generated mounted OpenBao API. It
retains typed provider causes and secret-wrapped messages while ordinary error
formatting, source chains and tracing expose only safe categories. The adapter
maps those causes to sanitized domain failures; only a true CAS mismatch becomes
a version conflict.
OpenBao's audit device and Macro's activity records complement each other; a
failed audit write must not silently produce an unaudited disclosure.

## Logos

Browsers fetch authenticated Macro image-proxy `/logos?domain=…` responses.
The initial request uses HTTPS `/favicon.ico`; bounded redirects may use HTTP
or HTTPS and other paths. Every hop checks public IPs before requests and at
DNS resolution. Fetches bound time and body size and reject non-raster media.
A bounded in-memory cache stores public logo bytes only; eight shared semaphore
permits cap concurrent cache-miss fetches while cached reads need no permit.
Unavailable or refused logos display the item's letter tile. No browser calls
an external icon service.

## Operations

Local development runs an isolated, loopback-bound single-node OpenBao in normal
server mode with single-node integrated Raft on a named Compose volume per instance.
Startup initializes a new vault once and unseals it automatically using a generated
32-byte static seal key. Raft storage, the seal key, and bootstrap credentials
live together on the local volume and stay outside git; application services
receive only their JWT signing identity. Container and stack restarts
preserve values, history, TOTP seeds, namespaces, and JWT configuration. The
[local bootstrap](../../infra/local/openbao/README.md) provisions each team
idempotently without replacing stored values. Keep the vault volume and its seal
key together when backing up or moving an instance; stack init snapshots omit the
vault. Use Compose restart or recreation without deleting volumes to preserve the
whole instance; xtask up/down can reset metadata or remove volumes. Never use this
local seal or bootstrap identity in a hosted environment.

Hosted dev and production require explicit configuration and provisioning:
TLS, KMS auto-unseal, persistent replicated storage, backups with restore drills,
restricted networking, least-privilege runtime identities, durable audit storage,
rotation, and monitored availability. This change does not deploy OpenBao or
alter production. Disable discovery until the backing environment is ready.
Provision team namespaces explicitly before use. Namespace erasure uses a separate
parent JWT role, `auth/macro-lifecycle/role/team-<team-id>`, bound to the lifecycle
subject/audience and exact team claim. Its token may read/delete only that team's
namespace and expires within 60 seconds; the normal values role gains no parent
privileges. Local bootstrap provisions it idempotently. Hosted deployment must
provision the same role before deploying this deletion path; missing roles fail
loudly. Runtime services never receive the bootstrap token. OpenBao DELETE begins
asynchronous erasure, so the adapter confirms namespace disappearance before
acknowledging success and removing vault metadata. Closed team identities remain
fenced against delayed senders.

Future work includes independently managed team envelopes/BYOK, end-to-end
encrypted private items, provider adapters, and agent grants with explicit
approval policy. Those features change the trust or authorization model and
require separate review.
