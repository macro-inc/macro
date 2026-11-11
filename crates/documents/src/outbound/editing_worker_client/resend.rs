//! One resend of a markdown request whose connection to the editing worker
//! was lost before a complete response.

use std::sync::Arc;

use tower::retry::budget::{Budget as _, TpsBudget};
use transport_failure::TransportFailure;

/// Allows a markdown request one resend when its connection is lost, within a
/// budget shared by every request the client sends: at least 10 resends a
/// second, beyond that a fifth of recent requests. When the edge or worker is
/// down for everyone, resends stop instead of doubling the load.
#[derive(Clone)]
pub(super) struct MarkdownResend {
    budget: Arc<TpsBudget>,
}

impl Default for MarkdownResend {
    fn default() -> Self {
        Self::with_budget(TpsBudget::default())
    }
}

impl MarkdownResend {
    pub(super) fn with_budget(budget: TpsBudget) -> Self {
        Self {
            budget: Arc::new(budget),
        }
    }

    /// Record a first attempt, which funds part of a later resend.
    pub(super) fn first_attempt(&self) {
        self.budget.deposit();
    }

    /// Whether to send again after a first attempt failed with `error`: only
    /// when its connection was refused or closed before a complete response,
    /// never after a timeout or an answer, and only while the budget lasts.
    pub(super) fn permits(&self, error: &anyhow::Error) -> bool {
        let cause = TransportFailure::classify(error.as_ref());
        if !cause.lost_connection() {
            return false;
        }
        if !self.budget.withdraw() {
            tracing::warn!(error = ?error, %cause, "editing worker connection lost and the resend budget is spent");
            return false;
        }
        tracing::warn!(error = ?error, %cause, "editing worker connection lost before a complete response; resending");
        tracing::Span::current().record("resent", true);
        true
    }
}
