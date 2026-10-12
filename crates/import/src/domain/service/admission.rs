//! Admission belongs at AI boundaries, not at deterministic import claims.

use super::{ImportServiceImpl, ImportSource, Result, RunStatus};
use crate::domain::ports::{ImportRepo, SlackWorkspaceSource};
use ai_billing::{AiAdmissionError, AiAdmissionService};
use ai_usage::AiFeature;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

impl<R, S, C, W: SlackWorkspaceSource, A> ImportServiceImpl<R, S, C, W, A> {
    /// Attach configured shared admission. Production hosts must supply this;
    /// the source-compatible constructor defaults to disabled enforcement.
    pub fn with_admission(mut self, admission: Arc<dyn AiAdmissionService>) -> Self {
        self.admission = admission;
        self
    }

    pub(super) async fn admit_ai(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> std::result::Result<(), AiAdmissionError> {
        self.admission.admit(user, AiFeature::Import).await
    }
}

impl<R: ImportRepo, S, C, W: SlackWorkspaceSource, A> ImportServiceImpl<R, S, C, W, A> {
    /// Preserve no-op retries and settings. Discovery spends no AI; an
    /// agent fallback admits itself when it actually starts.
    pub(super) async fn prepare_gather(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        from: &[RunStatus],
    ) -> Result<bool> {
        if let Some(run) = self
            .repo
            .list_runs(user)
            .await?
            .iter()
            .find(|run| run.source == source)
            && !from.contains(&run.status)
        {
            return Ok(false);
        }
        Ok(true)
    }
}

/// Persist stable, sanitized admission codes in existing run/row error fields.
/// Unavailability is retryable; exhaustion requires a quota/policy change.
pub(super) fn failure_reason(error: &anyhow::Error) -> String {
    match error.downcast_ref::<AiAdmissionError>() {
        Some(error) => format!("{}: {error}", error.code()),
        None => error.to_string(),
    }
}
