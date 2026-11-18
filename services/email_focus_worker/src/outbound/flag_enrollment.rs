//! The Focus rollout is the inbox owner's `enable-email-focus` flag, the same
//! flag that shows them the Focus tab, so whoever has the tab gets it filled
//! and nobody else's mail is classified.

use std::{
    collections::HashMap,
    sync::{Mutex, MutexGuard, PoisonError},
    time::Duration,
};

use email::domain::focus::FocusEnrollment;
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use tokio::time::Instant;

#[cfg(test)]
mod test;

/// Shows the Focus tab and puts the owner's inboxes in the rollout.
const EMAIL_FOCUS_FLAG: &str = "enable-email-focus";

/// How long an owner's answer stands. A rollout step, up or back, reaches the
/// worker within this, and each owner costs at most one flag request per period.
const ANSWER_LIFETIME: Duration = Duration::from_secs(60 * 60);

type Answers = HashMap<MacroUserIdStr<'static>, (bool, Instant)>;

/// Reads each owner's flag at most once per [`ANSWER_LIFETIME`].
pub struct FlagEnrollment<F> {
    flags: F,
    /// Each owner's last answer and when it was read: one entry per owner
    /// asked about, so never more than the inbox owners.
    answers: Mutex<Answers>,
}

impl<F> FlagEnrollment<F> {
    /// Read the rollout from `flags`.
    pub fn new(flags: F) -> Self {
        Self {
            flags,
            answers: Mutex::default(),
        }
    }

    fn answers(&self) -> MutexGuard<'_, Answers> {
        self.answers.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl<F: FeatureFlags> FlagEnrollment<F> {
    /// Ask the flag service; a failure is never stored, so the next check asks again.
    #[tracing::instrument(name = "email_focus.enrollment", skip_all, fields(enrolled = tracing::field::Empty), err)]
    async fn load(&self, owner: &MacroUserIdStr<'static>) -> Result<bool, Report> {
        let enrolled = self.flags.load(owner).await?.is_enabled(EMAIL_FOCUS_FLAG);
        tracing::Span::current().record("enrolled", enrolled);
        self.answers()
            .insert(owner.clone(), (enrolled, Instant::now()));
        Ok(enrolled)
    }
}

impl<F: FeatureFlags + 'static> FocusEnrollment for FlagEnrollment<F> {
    async fn is_enrolled(&self, owner: &MacroUserIdStr<'static>) -> Result<bool, Report> {
        let answer = self
            .answers()
            .get(owner)
            .filter(|(_, read_at)| read_at.elapsed() < ANSWER_LIFETIME)
            .map(|(enrolled, _)| *enrolled);
        match answer {
            Some(enrolled) => Ok(enrolled),
            None => self.load(owner).await,
        }
    }
}
