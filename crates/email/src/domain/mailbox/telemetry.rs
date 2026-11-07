//! Outcomes, deferral reasons and logs shared by the Outlook sync units
//! (`outlook.sync.*` spans). Each claimed unit of work gets one root span;
//! idle polls get none.

use super::MailboxError;
use email_api_client::domain::models::{EmailApiError, GateLimit, RateLimitOrigin};
use tracing::Span;
use uuid::Uuid;

/// Why a unit of sync work was deferred or failed (`outlook.defer_reason`).
pub fn defer_reason(error: &MailboxError) -> &'static str {
    match error {
        MailboxError::Provider(EmailApiError::RateLimited { origin, .. }) => match origin {
            RateLimitOrigin::Gate(GateLimit::Window) => "gate_window",
            RateLimitOrigin::Gate(GateLimit::Concurrency) => "gate_concurrency",
            RateLimitOrigin::Gate(GateLimit::Cooldown) => "gate_cooldown",
            RateLimitOrigin::Provider { .. } => "graph_throttled",
            RateLimitOrigin::Local => "other",
        },
        MailboxError::Provider(EmailApiError::CredentialsUnavailable { .. }) => "token_unavailable",
        MailboxError::Provider(EmailApiError::AuthRequired | EmailApiError::Forbidden) => {
            "auth_required"
        }
        MailboxError::Persistence | MailboxError::Database(_) => "persistence",
        MailboxError::Effect => "effect",
        MailboxError::LocationUnsettled => "location_unsettled",
        _ => "other",
    }
}

/// A refusal by the shared request gate is routine back-pressure, so it is
/// logged at DEBUG; the span still records it.
fn is_gate_refusal(error: &MailboxError) -> bool {
    matches!(
        error,
        MailboxError::Provider(EmailApiError::RateLimited {
            origin: RateLimitOrigin::Gate(_),
            ..
        })
    )
}

/// The unit committed its work: `imported` or, for a vanished message, `absent`.
pub(super) fn record_done(span: &Span, outcome: &'static str) {
    span.record("outlook.outcome", outcome);
}

/// The unit released its work to run again after `delay_seconds`.
pub(super) fn record_deferred(
    span: &Span,
    link_id: Uuid,
    error: &MailboxError,
    delay_seconds: u32,
) {
    let reason = defer_reason(error);
    span.record("outlook.outcome", "deferred");
    span.record("outlook.defer_reason", reason);
    span.record("outlook.defer_seconds", i64::from(delay_seconds));
    if is_gate_refusal(error) {
        tracing::debug!(parent: span, %link_id, defer_reason = reason, defer_seconds = i64::from(delay_seconds), %error, "mailbox sync work deferred");
    } else {
        tracing::warn!(parent: span, %link_id, defer_reason = reason, defer_seconds = i64::from(delay_seconds), %error, "mailbox sync work deferred");
    }
}

/// The unit stopped without releasing its work, which another worker retries
/// once the lease expires, or lost its lease to a newer owner (`Stale`).
pub(super) fn record_failed(span: &Span, link_id: Uuid, error: &MailboxError) {
    let reason = defer_reason(error);
    span.record("outlook.outcome", "failed");
    span.record("outlook.defer_reason", reason);
    span.record("otel.status_description", tracing::field::display(error));
    if matches!(error, MailboxError::Stale) {
        tracing::debug!(parent: span, %link_id, defer_reason = reason, %error, "mailbox sync work failed");
    } else {
        tracing::warn!(parent: span, %link_id, defer_reason = reason, %error, "mailbox sync work failed");
    }
}

/// Logs why a unit of the other mailbox loops (contacts, drafts, commands,
/// settings, watches), which have no span, stopped or was deferred.
pub(super) fn log_unit_error(link_id: Uuid, error: &MailboxError) {
    let reason = defer_reason(error);
    if is_gate_refusal(error) || matches!(error, MailboxError::Stale) {
        tracing::debug!(%link_id, defer_reason = reason, %error, "mailbox sync work deferred");
    } else {
        tracing::warn!(%link_id, defer_reason = reason, %error, "mailbox sync work deferred");
    }
}

/// A claim query failed, so no unit (and no mailbox) was involved yet.
pub(super) fn claim_failed(unit: &'static str, error: MailboxError) -> MailboxError {
    tracing::warn!(unit, defer_reason = defer_reason(&error), %error, "mailbox sync claim failed");
    error
}

/// Milliseconds from a stored timestamp, such as a notification's arrival,
/// to now; zero if the clocks disagree.
pub(super) fn since_ms(at: chrono::DateTime<chrono::Utc>) -> i64 {
    (chrono::Utc::now() - at).num_milliseconds().max(0)
}

pub(super) fn elapsed_ms(started: std::time::Instant) -> i64 {
    span_int(started.elapsed().as_millis())
}

/// OpenTelemetry receives a span field as an integer only when it is
/// recorded as `i64`; unsigned values arrive as strings.
pub(super) fn span_int(value: impl TryInto<i64>) -> i64 {
    value.try_into().unwrap_or(i64::MAX)
}
