# Feature flags

Await one load for the authenticated Macro user ID, then read the stable snapshot
synchronously. Consumers depend on `FeatureFlags`; composition roots select an
outbound adapter. A variant counts as enabled. Missing flags read `false`/`None`;
a failed load returns `Err`, leaving fallback policy to the caller.

```rust
use feature_flags::{FeatureFlags, FlagSnapshot, FlagValue};
use feature_flags::outbound::fake::FakeFeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;

# async fn example() -> Result<(), rootcause::Report> {
let user_id = MacroUserIdStr::parse_from_str("macro|person@example.com")?;
let mut feature_flags = FakeFeatureFlags::default();
feature_flags.set(user_id.clone(), Ok(FlagSnapshot::new([
    ("agent-code-mode".into(), FlagValue::Boolean(true)),
    ("layout".into(), FlagValue::Variant("compact".into())),
])));
let flags = feature_flags.load(&user_id).await?;
assert!(flags.is_enabled("agent-code-mode"));
assert_eq!(flags.variant("layout"), Some("compact"));
assert_eq!(flags.get("missing"), None);
# Ok(())
# }
```

Pass the authenticated user identifier used by frontend PostHog identification.
Do not substitute an email address, derive a new ID, or share one user's snapshot
with another. Snapshots have no automatic refresh; a new load creates a new one.
No flag is an authorization grant by itself.

## Global service evaluation

Use `ServiceFeatureFlags::load_service(ServiceContext::new("service-name"))` for
an explicit global rollout. Service contexts never fabricate Macro user IDs.
The strict transport and snapshot validation are shared with authenticated-user
loads. Consumers use one stable service context across human routes, background
jobs and lifecycle calls. Consumers may require a separate authenticated-user
load of the same key for actor cohorts; configure the service context explicitly
alongside those actors rather than using an owner identity for background work.
`FakeFeatureFlags::set_service` configures service results independently of users.

## PostHog adapter

Construct once at the service composition root and clone to share its HTTP pool:

```rust
use feature_flags::outbound::posthog::PostHogFeatureFlags;
use macro_env::Environment;
use std::time::Duration;

# fn example() -> Result<(), rootcause::Report> {
let feature_flags = PostHogFeatureFlags::new(
    "https://us.i.posthog.com", // Use the project's regional ingestion origin.
    "injected-project-token".to_owned(),
    Duration::from_secs(3),
    Environment::Develop, // The service config's `environment`.
)?;
# Ok(())
# }
```

The constructor rejects blank keys, zero timeouts, and hosts with credentials,
paths, queries, or fragments. There is no silently disabled configuration. HTTP
is accepted for local tests/self-hosting; production should use HTTPS. No
configuration is loaded from the environment by this crate.

Each load makes one POST to `/flags/?v=2` with the project token and exact Macro
user ID. `evaluation_runtime: "server"` requests server/all-runtime flags;
`geoip_disable: true` prevents targeting by the backend's IP. Person targeting
uses PostHog's stored properties plus one override, `environment` (`prod`,
`dev`, or `local`), from the environment passed at construction; nothing
request-supplied can set it. Group targeting and other property overrides are
not supported.

Reads do not emit `$feature_flag_called` events, so this adapter alone does not
provide experiment exposure tracking.

Dev and prod share one PostHog project and the same Macro user IDs, so a flag
targeted only at user IDs turns on in both. Target dev-only rollouts with
`environment = dev`. The web client sends the same property: `prod`, `dev`,
or `local` for local stack bundles.

The response must contain a `flags` map and explicit boolean
`errorsWhileComputingFlags`. Computation errors, any nonempty `quotaLimited`
array, provider error fields, and per-flag `failed: true` reject the entire load.
Malformed JSON/types, mismatched flag keys, and non-success HTTP statuses also
fail. A healthy empty map succeeds. Disabled flags remain boolean `false` even
if the provider includes a variant. Error reports omit response bodies and
request URLs; the adapter logs neither credentials nor user details.

The configured timeout bounds the load, including response-body reading.
Redirects and retries are disabled. This adapter has no cache, polling, local
evaluation (see below), legacy-response fallback, or hidden per-key request. Callers choose whether to
propagate errors or use an explicit fallback, such as `FlagSnapshot::default()`.

Direct HTTP is intentional: the released `posthog-rs` 0.27.0 snapshot API keeps
computation-error/quota indicators private and may return partial evaluations as
`Ok`. It cannot preserve this crate's strict load-failure contract. This adapter
only maps remote results; PostHog still owns targeting and evaluation.

## Local evaluation adapter

`PostHogLocalFeatureFlags` evaluates named flags in memory, for a service that
checks a flag too often to pay for a remote load each time (the email focus
worker checks an owner per email event). It polls
`GET /flags/definitions?token=<project key>` with a project secret key
(`Authorization: Bearer`) at most every 5 minutes, sending the last `ETag` so an
unchanged poll is a `304`; a failed poll is retried after 30 seconds. A `401`
or `402` (revoked key, quota) drops the definitions at once. Each poll is a
`feature_flags.definitions_poll` span, and a named flag absent from the
definitions is logged.

```rust
use feature_flags::outbound::posthog_local::PostHogLocalFeatureFlags;
use macro_env::Environment;
use std::time::Duration;

# fn example() -> Result<(), rootcause::Report> {
let feature_flags = PostHogLocalFeatureFlags::new(
    "https://us.i.posthog.com",
    "injected-project-token",
    "injected-secret-key".to_owned(),
    &["enable-email-focus"],
    Duration::from_secs(10), // Bounds each poll.
    Environment::Develop,
)?;
# Ok(())
# }
```

A load evaluates only the named flags, with the person properties
`distinct_id` (the exact Macro user ID), `email` (the address in that ID, which
the web client also identifies with) and `environment`. It supports boolean
flags whose conditions compare those properties with `exact`, `is_not`,
`icontains`, `not_icontains`, `is_set` or `is_not_set`, plus a rollout
percentage, bucketed with PostHog's SHA-1 hash of `<flag key>.<distinct id>`
(checked against posthog-python's consistency vector).

It fails closed: a load fails when no poll has succeeded in the last hour, or
when a named flag uses anything else (variants, cohorts, groups, flag
dependencies, holdouts, early access, experience continuity, device bucketing,
another person property, another operator, boolean-like `exact` values, or any
set field it doesn't know, such as `early_exit`) and no
supported condition matched. A condition that matches decides even beside one
it can't evaluate, as in PostHog's SDKs. Inactive flags read `false`; deleted or
unknown flags are missing.

Wire references:

- [Official flags API](https://posthog.com/docs/api/flags)
- [Request runtime and GeoIP fields](https://github.com/PostHog/posthog/blob/master/rust/feature-flags/src/flags/flag_request.rs)
- [Official response types, including per-flag failures](https://github.com/PostHog/posthog/blob/master/rust/feature-flags/src/api/types.rs)
