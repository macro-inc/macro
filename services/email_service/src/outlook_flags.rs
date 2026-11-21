//! PostHog flags that switch Outlook sync behavior for the whole service,
//! each read about once a minute into a switch the domain reads.

use crate::config::{Config, Environment};
use feature_flags::outbound::posthog::PostHogFeatureFlags;
use feature_flags::{ServiceContext, ServiceFeatureFlags};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[cfg(test)]
mod test;

/// Turns on newest-first Outlook imports and the live pass that stores a
/// folder's new mail during its import round (pubsub workers).
pub const LIVE_IMPORT_PASS_FLAG: &str = "enable-outlook-import-live-pass";

/// Turns on reading the message a Graph change notification names as soon as
/// the webhook accepts it (email-service API).
pub const NOTIFIED_MESSAGE_READS_FLAG: &str = "enable-outlook-notified-message-reads";

/// The service identity every Outlook sync flag is evaluated for.
const OUTLOOK_SYNC_CONTEXT: ServiceContext = ServiceContext::new("outlook-mailbox-sync");

/// How often a flag is read.
const REFRESH: Duration = Duration::from_secs(60);

/// PostHog's US ingestion origin, used when `POSTHOG_HOST` is unset.
const DEFAULT_POSTHOG_HOST: &str = "https://us.i.posthog.com";

/// The PostHog client this service's flags (the Outlook sync's and
/// `contacts-list-writes`) are read with, or `None` without a project key,
/// which leaves every flag off.
pub fn posthog(config: &Config) -> anyhow::Result<Option<PostHogFeatureFlags>> {
    posthog_client(
        config.environment,
        config.posthog_api_key(),
        config.posthog_host.value(),
    )
}

/// The PostHog client for `key`, or `None` without one. A blank key counts as
/// none.
pub fn posthog_client(
    environment: Environment,
    key: Option<&str>,
    host: Option<&str>,
) -> anyhow::Result<Option<PostHogFeatureFlags>> {
    key.filter(|key| !key.trim().is_empty())
        .map(|key| {
            PostHogFeatureFlags::new(
                host.unwrap_or(DEFAULT_POSTHOG_HOST),
                key.to_owned(),
                Duration::from_secs(3),
                environment,
            )
        })
        .transpose()
        .map_err(|error| anyhow::anyhow!("invalid feature flag configuration: {error}"))
}

/// One flag and the switch it sets. `name` reads as the subject of its log
/// lines, such as "outlook import live pass switched".
pub struct OutlookFlag<S> {
    pub key: &'static str,
    pub name: &'static str,
    pub set: S,
}

/// Sets the switch from its flag about once a minute. Without flags, or while
/// a read fails, the switch is off, as the sync ran before the flag existed;
/// a failing read warns once until one succeeds.
pub async fn run<F, S>(flags: Option<F>, flag: OutlookFlag<S>, cancellation: CancellationToken)
where
    F: ServiceFeatureFlags,
    S: Fn(bool) -> bool,
{
    let Some(flags) = flags else {
        tracing::warn!(
            flag = flag.key,
            "no PostHog project key; the {} stays off",
            flag.name
        );
        return;
    };
    let mut interval = tokio::time::interval(REFRESH);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut failing = false;
    loop {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            _ = interval.tick() => {},
        }
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            read = refresh(&flags, &flag, failing) => failing = !read,
        }
    }
}

/// One read of the flag; returns whether it succeeded.
#[tracing::instrument(
    name = "outlook.feature_flag.refresh",
    skip_all,
    fields(feature_flag.key = flag.key, feature_flag.enabled = tracing::field::Empty)
)]
async fn refresh<F, S>(flags: &F, flag: &OutlookFlag<S>, failing: bool) -> bool
where
    F: ServiceFeatureFlags,
    S: Fn(bool) -> bool,
{
    let (enabled, read) = match flags.load_service(OUTLOOK_SYNC_CONTEXT).await {
        Ok(snapshot) => (snapshot.is_enabled(flag.key), true),
        Err(error) => {
            if !failing {
                tracing::warn!(
                    error = ?error,
                    flag = flag.key,
                    "could not read the {} flag; it is off",
                    flag.name
                );
            }
            (false, false)
        }
    };
    tracing::Span::current().record("feature_flag.enabled", enabled);
    if (flag.set)(enabled) != enabled {
        tracing::info!(flag = flag.key, enabled, "{} switched", flag.name);
    }
    read
}
