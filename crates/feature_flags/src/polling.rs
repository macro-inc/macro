//! Polling for rollout switches whose missing or failed reads must stay off.

use crate::{ServiceContext, ServiceFeatureFlags};
use std::{future::Future, time::Duration};

/// How often a global rollout decision is refreshed.
pub const REFRESH_INTERVAL: Duration = Duration::from_secs(60);

/// One default-off global flag and its composition-owned switch.
pub struct DefaultOffFlag<S> {
    /// Remote flag key owned by the consuming feature.
    pub key: &'static str,
    /// Human-readable feature name for bounded diagnostic logs.
    pub name: &'static str,
    /// Stable global evaluation identity, never a fabricated user ID.
    pub context: ServiceContext,
    /// Set the switch and return its previous value.
    pub set: S,
}

/// Refresh a default-off switch until the owning service is cancelled.
/// A missing adapter leaves the switch off and performs no network requests.
pub async fn run<F, S, C>(flags: Option<F>, flag: DefaultOffFlag<S>, cancellation: C)
where
    F: ServiceFeatureFlags,
    S: Fn(bool) -> bool + Send + Sync,
    C: Future<Output = ()> + Send,
{
    (flag.set)(false);
    let Some(flags) = flags else {
        tracing::warn!(
            flag = flag.key,
            "no feature flag adapter; {} stays off",
            flag.name
        );
        return;
    };
    tokio::pin!(cancellation);
    let mut interval = tokio::time::interval(REFRESH_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut failing = false;
    loop {
        tokio::select! {
            biased;
            _ = &mut cancellation => return,
            _ = interval.tick() => {},
        }
        tokio::select! {
            biased;
            _ = &mut cancellation => return,
            result = refresh(&flags, &flag, failing) => failing = !result,
        }
    }
}

/// Apply one evaluated snapshot, explicitly falling back to off on failure.
/// Returns whether evaluation succeeded; callers suppress repeated failure logs.
#[tracing::instrument(name = "feature_flag.refresh", skip_all, fields(
    feature_flag.key = flag.key,
    feature_flag.context = flag.context.distinct_id(),
    feature_flag.enabled = tracing::field::Empty,
))]
pub async fn refresh<F, S>(flags: &F, flag: &DefaultOffFlag<S>, failing: bool) -> bool
where
    F: ServiceFeatureFlags,
    S: Fn(bool) -> bool + Sync,
{
    let (enabled, succeeded) = match flags.load_service(flag.context).await {
        Ok(snapshot) => (snapshot.is_enabled(flag.key), true),
        Err(error) => {
            if !failing {
                tracing::warn!(error = ?error, flag = flag.key, "could not read {}; it is off", flag.name);
            }
            (false, false)
        }
    };
    tracing::Span::current().record("feature_flag.enabled", enabled);
    if (flag.set)(enabled) != enabled {
        tracing::info!(flag = flag.key, enabled, "{} switched", flag.name);
    }
    succeeded
}
