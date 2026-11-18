//! The Focus rollout is the inbox owner's `enable-email-focus` flag, the same
//! flag that shows them the Focus tab, so whoever has the tab gets it filled
//! and nobody else's mail is classified.

use email::domain::focus::FocusEnrollment;
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

#[cfg(test)]
mod test;

/// Shows the Focus tab and puts the owner's inboxes in the rollout.
pub const EMAIL_FOCUS_FLAG: &str = "enable-email-focus";

/// Reads each owner's flag on every check. The worker evaluates it locally
/// from definitions polled every few minutes, so a check costs no request.
pub struct FlagEnrollment<F> {
    flags: F,
}

impl<F> FlagEnrollment<F> {
    /// Read the rollout from `flags`.
    pub fn new(flags: F) -> Self {
        Self { flags }
    }
}

impl<F: FeatureFlags + 'static> FocusEnrollment for FlagEnrollment<F> {
    /// A failed read is an error, never "not enrolled": the caller decides.
    #[tracing::instrument(name = "email_focus.enrollment", skip_all, fields(enrolled = tracing::field::Empty), err)]
    async fn is_enrolled(&self, owner: &MacroUserIdStr<'static>) -> Result<bool, Report> {
        let enrolled = self.flags.load(owner).await?.is_enabled(EMAIL_FOCUS_FLAG);
        tracing::Span::current().record("enrolled", enrolled);
        Ok(enrolled)
    }
}
