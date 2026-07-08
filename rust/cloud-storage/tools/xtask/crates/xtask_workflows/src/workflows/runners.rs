//! GitHub Actions runner labels.
//!
//! We run on Namespace (namespace.so) hosted runners, selected by the dashboard
//! *profile* name — the same convention the deploy workflows already use. Each
//! profile's persisted cache volume is configured in the Namespace dashboard;
//! that volume backs the sccache + cargo caches (see
//! [`crate::workflows::steps::mount_cache_volume`]).

use std::fmt;

/// A Namespace runner profile. The set of profiles we're allowed to target is
/// closed; `Display` renders the `runs-on` label.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Runner {
    /// Tiny profile for lightweight automation that does not need cache volume.
    TinyNoCache,
    /// Small profile for light jobs (path filtering, status aggregation).
    Small,
    /// Mid-size profile, shared with the deploy workflows. Its *default* cache
    /// volume is churned by deploys, so always pair it with
    /// [`Runner::with_cache_tag`] to give a workload its own volume.
    Mid,
    /// Dedicated CI profile for the heavy compile + test jobs. Has its own
    /// cache volume, isolated from the deploy profiles so deploy's churn can't
    /// evict the CI sccache/cargo caches.
    RustCi,
}

impl fmt::Display for Runner {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Runner::TinyNoCache => "namespace-profile-linux-tiny-no-cache",
            Runner::Small => "namespace-profile-linux-small",
            Runner::Mid => "namespace-profile-linux-mid",
            Runner::RustCi => "namespace-profile-linux-rust-ci",
        })
    }
}

impl Runner {
    /// Render the `runs-on` label with an explicit, branch-independent cache
    /// *tag* (`<profile>;overrides.cache-tag=<tag>`).
    ///
    /// By default Namespace scopes a profile's cache volume per branch: a fresh
    /// branch can only inherit the *default* branch's cache, so any branch whose
    /// workflow never runs on `main` starts cold every time. Pinning a fixed tag
    /// makes every branch read/write the *same* volume — one global cache, like
    /// the old shared S3 sccache bucket. sccache entries are content-addressed,
    /// so concurrent writers never corrupt each other; the worst case is an
    /// occasional miss that simply recompiles.
    pub fn with_cache_tag(self, tag: &str) -> String {
        format!("{self};overrides.cache-tag={tag}")
    }
}
