//! [`LinkPreviewGate`] adapter that reads the `enable-link-previews` flag for
//! each person.

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::ports::LinkPreviewGate;

#[cfg(test)]
mod test;

/// The PostHog flag, shared with the web app's flag of the same key.
pub const ENABLE_LINK_PREVIEWS: &str = "enable-link-previews";

/// Link previews for the people the `enable-link-previews` flag is on for.
/// A flag that can't be read counts as off.
pub struct FlaggedLinkPreviews<F>(pub F);

impl<F: FeatureFlags + 'static> LinkPreviewGate for FlaggedLinkPreviews<F> {
    fn enabled_for<'a>(
        &'a self,
        person: &'a MacroUserIdStr<'static>,
    ) -> std::pin::Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(async move {
            match self.0.load(person).await {
                Ok(flags) => flags.is_enabled(ENABLE_LINK_PREVIEWS),
                Err(error) => {
                    tracing::warn!(error = ?error, "failed to load the link preview flag");
                    false
                }
            }
        })
    }
}
