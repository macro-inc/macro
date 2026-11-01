//! Admission belongs at AI boundaries, not at deterministic import claims.

use super::ImportServiceImpl;
use crate::domain::ports::SlackWorkspaceSource;
use ai_billing::{AiAdmissionError, AiAdmissionService};
use ai_usage::AiFeature;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

impl<R, S, C, W: SlackWorkspaceSource, N: Send + Sync + 'static> ImportServiceImpl<R, S, C, W, N> {
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

/// Persist stable, sanitized admission codes in existing row error fields.
/// Unavailability is retryable; exhaustion requires a quota/policy change.
pub(super) fn failure_reason(error: &anyhow::Error) -> String {
    match error.downcast_ref::<AiAdmissionError>() {
        Some(error) => format!("{}: {error}", error.code()),
        None => error.to_string(),
    }
}
