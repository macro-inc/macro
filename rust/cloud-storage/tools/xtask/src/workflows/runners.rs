//! GitHub Actions runner labels.
//!
//! We run on Namespace (namespace.so) hosted runners, selected by the dashboard
//! *profile* name — the same convention the deploy workflows already use
//! (`namespace-profile-linux-mid`, etc.). Each profile's persisted cache volume
//! is configured in the Namespace dashboard; that volume is what backs the
//! sccache + cargo caches (see [`crate::workflows::steps::mount_cache_volume`]).
//!
//! `runs_on` accepts any `&str`, so these are plain consts — greppable, and the
//! whole runner set lives in this one file.

/// Small profile for light jobs (path filtering, status aggregation).
pub const LINUX_SMALL: &str = "namespace-profile-linux-small";

/// Mid profile for the heavy compile + test jobs. Has a cache volume configured,
/// which is what makes the persisted sccache cache possible.
pub const LINUX_MID: &str = "namespace-profile-linux-mid";
