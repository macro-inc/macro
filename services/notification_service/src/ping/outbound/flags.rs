//! Where the agent notifications flag is read from.

#[cfg(test)]
mod test;

use std::time::Duration;

use feature_flags::outbound::posthog::PostHogFeatureFlags;
use feature_flags::{FeatureFlags, FlagSnapshot, FlagValue};
use macro_env::Environment;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

use crate::ping::AGENT_NOTIFICATIONS_FLAG;

const DEFAULT_POSTHOG_HOST: &str = "https://us.i.posthog.com";

/// The flag is read once per send request, where a slow answer is better
/// than a refusal.
const FLAG_TIMEOUT: Duration = Duration::from_secs(3);

/// Reads `enable-agent-notifications` for a person.
#[derive(Clone)]
pub(crate) enum NotificationFlags {
    /// PostHog decides per person.
    Remote(PostHogFeatureFlags),
    /// One answer for everyone.
    Fixed(bool),
}

impl NotificationFlags {
    /// A local stack has no PostHog project, so pings are on
    /// for everyone there. A deployment asks PostHog, and without a key they
    /// are off.
    pub(crate) fn new(
        environment: Environment,
        posthog_api_key: Option<&str>,
        posthog_host: Option<&str>,
    ) -> Result<Self, Report> {
        if matches!(environment, Environment::Local) {
            return Ok(Self::Fixed(true));
        }

        let Some(key) = posthog_api_key else {
            return Ok(Self::Fixed(false));
        };

        Ok(Self::Remote(PostHogFeatureFlags::new(
            posthog_host.unwrap_or(DEFAULT_POSTHOG_HOST),
            key.to_owned(),
            FLAG_TIMEOUT,
            environment,
        )?))
    }
}

impl FeatureFlags for NotificationFlags {
    async fn load(&self, user_id: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, Report> {
        match self {
            Self::Remote(posthog) => load_remote(posthog, user_id).await,
            Self::Fixed(enabled) => Ok(FlagSnapshot::new([(
                AGENT_NOTIFICATIONS_FLAG.to_string(),
                FlagValue::Boolean(*enabled),
            )])),
        }
    }
}

/// One request to PostHog, in a span of its own so a slow or failed flag
/// read shows in the trace of the send that waited on it.
#[tracing::instrument(name = "notification.ping_flags.load", err, skip_all)]
async fn load_remote(
    posthog: &PostHogFeatureFlags,
    user_id: &MacroUserIdStr<'_>,
) -> Result<FlagSnapshot, Report> {
    posthog.load(user_id).await
}
