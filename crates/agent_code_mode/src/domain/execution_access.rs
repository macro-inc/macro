//! Shared authority for a credential spending one recorded execution.
use super::{CodeModeError, ExecutionRecord};
use agent_session::domain::model::AgentSessionId;
use uuid::Uuid;

/// Closed reasons for an expected execution-admission refusal.
#[derive(Clone, Copy, Debug)]
pub(super) enum Refusal {
    Uncorrelated,
    OtherSession,
    Scoped,
    UnboundOrOtherExecution,
    NotRunning,
    WrongAccount,
}
impl Refusal {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Uncorrelated => "uncorrelated",
            Self::OtherSession => "other_session",
            Self::Scoped => "scoped",
            Self::UnboundOrOtherExecution => "unbound_or_other_execution",
            Self::NotRunning => "not_running",
            Self::WrongAccount => "wrong_account",
        }
    }
    pub(super) fn error(self) -> CodeModeError {
        tracing::Span::current().record("refusal", self.as_str());
        tracing::warn!(refusal = self.as_str(), "execution admission refused");
        CodeModeError::Forbidden
    }
}

/// Only the unscoped invocation verified for this path's session may proceed.
pub(super) fn credential_for_session(session: AgentSessionId) -> Result<Uuid, CodeModeError> {
    if agent_correlation::context::is_scoped() {
        return Err(Refusal::Scoped.error());
    }
    let correlation =
        agent_correlation::context::current().ok_or_else(|| Refusal::Uncorrelated.error())?;
    if agent_correlation::context::current_session() != Some(session.as_uuid()) {
        return Err(Refusal::OtherSession.error());
    }
    Ok(correlation)
}

/// The same journal field governs foreground and background launch paths.
pub(super) fn check_binding(
    record: &ExecutionRecord,
    correlation: Uuid,
) -> Result<(), CodeModeError> {
    if record.credential_correlation_id != Some(correlation) {
        return Err(Refusal::UnboundOrOtherExecution.error());
    }
    Ok(())
}

/// Record backend failures at their severity without downgrading infrastructure
/// errors to the expected admission-refusal level.
pub(super) fn record_backend_error(error: &CodeModeError) {
    match error {
        CodeModeError::Forbidden | CodeModeError::NotFound => {
            tracing::warn!(%error, "execution backend request refused");
        }
        _ => {
            let span = tracing::Span::current();
            span.record("error", tracing::field::display(error));
            span.record("otel.status_code", "ERROR");
            tracing::error!(%error, "execution backend operation failed");
        }
    }
}
