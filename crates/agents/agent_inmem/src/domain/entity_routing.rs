//! Whether a code-mode turn routes SDK entities: loads the areas its request
//! needs, with their `@agent` guidance, instead of carrying every area's
//! guidance in its prompt.

use std::{future::Future, pin::Pin};

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;

#[cfg(test)]
mod test;

/// PostHog key evaluated for the session owner.
pub const AUTO_SKILLS: &str = "auto-skills";

/// Whether a turn routes SDK entities.
pub trait EntityRoutingPolicy: Send + Sync {
    /// Whether `owner`'s code-mode turns route; unavailable flags do not.
    fn routes<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>>;
}

/// Default when this deployment has no feature-flag provider.
pub struct NoEntityRouting;

impl EntityRoutingPolicy for NoEntityRouting {
    fn routes<'a>(
        &'a self,
        _: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(async { false })
    }
}

/// Routes for owners with [`AUTO_SKILLS`].
pub struct FlaggedEntityRouting<F> {
    flags: F,
}

impl<F: FeatureFlags> FlaggedEntityRouting<F> {
    /// Compose with a provider whose load has a bounded deadline.
    pub fn new(flags: F) -> Self {
        Self { flags }
    }
}

impl<F: FeatureFlags> EntityRoutingPolicy for FlaggedEntityRouting<F> {
    fn routes<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(async move {
            self.flags
                .load(owner)
                .await
                .inspect_err(|error| {
                    tracing::warn!(
                        ?error,
                        "feature flags unavailable; not routing SDK entities"
                    );
                })
                .unwrap_or_default()
                .is_enabled(AUTO_SKILLS)
        })
    }
}
