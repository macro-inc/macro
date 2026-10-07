//! Admission belongs at AI boundaries, not at deterministic import claims.

use super::{ImportServiceImpl, ImportSource, Result, RunStatus};
use crate::domain::ports::{ImportRepo, SlackWorkspaceSource};
use ai_billing::{AiAdmissionError, AiAdmissionService};
use ai_usage::AiFeature;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

impl<R, S, C, W: SlackWorkspaceSource> ImportServiceImpl<R, S, C, W> {
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

    pub(super) async fn admit_gather(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> std::result::Result<(), AiAdmissionError> {
        match source {
            ImportSource::Slack => Ok(()),
            ImportSource::Linear | ImportSource::Notion => self.admit_ai(user).await,
        }
    }
}

impl<R: ImportRepo, S, C, W: SlackWorkspaceSource> ImportServiceImpl<R, S, C, W> {
    /// Preserve no-op retries and settings before checking new AI spending.
    /// Slack discovery is deterministic until its fallback actually starts.
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
        self.admit_gather(user, source).await?;
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
