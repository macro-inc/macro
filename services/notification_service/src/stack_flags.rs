//! Where the notification stacks flag is read from.

use std::time::Duration;

use feature_flags::outbound::posthog::PostHogFeatureFlags;
use feature_flags::{FeatureFlags, FlagSnapshot, FlagValue};
use macro_env::Environment;
use macro_user_id::user_id::MacroUserIdStr;
use notification_routing::domain::models::NOTIFICATION_STACKS_FLAG;
use rootcause::Report;

const DEFAULT_POSTHOG_HOST: &str = "https://us.i.posthog.com";

/// A flag read sits on the ingress path of a routed notification, so it gets
/// a short deadline. A read that misses it counts as off.
const FLAG_TIMEOUT: Duration = Duration::from_millis(300);

/// Reads `enable-notification-stacks` for a person.
#[derive(Clone)]
pub enum StackFlags {
    /// PostHog decides per person.
    Remote(PostHogFeatureFlags),
    /// One answer for everyone.
    Fixed(bool),
}

impl StackFlags {
    /// A local stack has no PostHog project, so stacks are on for everyone
    /// there. A deployment asks PostHog, and without a key stacks are off.
    pub fn new(
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
        )?))
    }
}

impl StackFlags {
    /// Whether stacks are off for every person, so nothing can be routed and
    /// ingress need not look at stacks at all. A deployment without a flag
    /// provider key answers yes.
    pub fn off_for_everyone(&self) -> bool {
        matches!(self, Self::Fixed(false))
    }
}

impl FeatureFlags for StackFlags {
    async fn load(&self, user_id: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, Report> {
        match self {
            Self::Remote(posthog) => posthog.load(user_id).await,
            Self::Fixed(enabled) => Ok(FlagSnapshot::new([(
                NOTIFICATION_STACKS_FLAG.to_string(),
                FlagValue::Boolean(*enabled),
            )])),
        }
    }
}

#[cfg(test)]
mod test;
