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

## PostHog adapter

Construct once at the service composition root and clone to share its HTTP pool:

```rust
use feature_flags::outbound::posthog::PostHogFeatureFlags;
use std::time::Duration;

# fn example() -> Result<(), rootcause::Report> {
let feature_flags = PostHogFeatureFlags::new(
    "https://us.i.posthog.com", // Use the project's regional ingestion origin.
    "injected-project-token".to_owned(),
    Duration::from_secs(3),
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
uses PostHog's stored properties. Group targeting and property overrides are
not supported. Reads do not emit `$feature_flag_called` events, so this adapter
alone does not provide experiment exposure tracking.

The response must contain a `flags` map and explicit boolean
`errorsWhileComputingFlags`. Computation errors, any nonempty `quotaLimited`
array, provider error fields, and per-flag `failed: true` reject the entire load.
Malformed JSON/types, mismatched flag keys, and non-success HTTP statuses also
fail. A healthy empty map succeeds. Disabled flags remain boolean `false` even
if the provider includes a variant. Error reports omit response bodies and
request URLs; the adapter logs neither credentials nor user details.

The configured timeout bounds the load, including response-body reading.
Redirects and retries are disabled. There is no cache, polling, local evaluation,
legacy-response fallback, or hidden per-key request. Callers choose whether to
propagate errors or use an explicit fallback, such as `FlagSnapshot::default()`.

Direct HTTP is intentional: the released `posthog-rs` 0.27.0 snapshot API keeps
computation-error/quota indicators private and may return partial evaluations as
`Ok`. It cannot preserve this crate's strict load-failure contract. This adapter
only maps remote results; PostHog still owns targeting and evaluation.

Wire references:

- [Official flags API](https://posthog.com/docs/api/flags)
- [Request runtime and GeoIP fields](https://github.com/PostHog/posthog/blob/master/rust/feature-flags/src/flags/flag_request.rs)
- [Official response types, including per-flag failures](https://github.com/PostHog/posthog/blob/master/rust/feature-flags/src/api/types.rs)
