//! Outcomes, deferral reasons and logs shared by the Outlook sync units
//! (`outlook.sync.*` spans). Each claimed unit of work gets one root span;
//! idle polls get none.

use super::drafts::models::{DraftChange, DraftFailure, DraftLease};
use super::{MailboxError, StreamLease};
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
        MailboxError::Provider(EmailApiError::AuthRequired) => "auth_required",
        // Graph refuses one item (`ErrorAccessDenied`) while the grant still
        // works; a revoked grant answers 401 and is `auth_required`.
        MailboxError::Provider(EmailApiError::Forbidden) => "forbidden",
        MailboxError::Provider(EmailApiError::NotFound) => "not_found",
        MailboxError::Provider(EmailApiError::Permanent { .. }) => "permanent",
        MailboxError::Persistence | MailboxError::Database(_) => "persistence",
        MailboxError::Unstorable(_) => "unstorable",
        MailboxError::Effect(_) => "effect",
        MailboxError::LocationUnsettled => "location_unsettled",
        MailboxError::CalendarPartsUnavailable => "calendar_parts",
        MailboxError::NoMailbox => "no_mailbox",
        MailboxError::ClaimsUnfinished(_) => "unfinished",
        MailboxError::DraftChanged(_) => "draft_changed",
        _ => "other",
    }
}

/// The root span of one claimed folder stream.
pub(super) fn enumerate_span(lease: &StreamLease) -> Span {
    tracing::info_span!(
        "outlook.sync.enumerate",
        mailbox.link_id = %lease.mailbox.link_id,
        mailbox.sync_generation = lease.mailbox.sync_generation,
        outlook.stream_kind = lease.pass.kind().as_str(),
        outlook.stream_id = %lease.id,
        outlook.page_items = tracing::field::Empty,
        outlook.rows_queued = tracing::field::Empty,
        outlook.live_pass_opened = tracing::field::Empty,
        outlook.delta_advanced = tracing::field::Empty,
        outlook.folder_initial_complete = tracing::field::Empty,
        outlook.cursor_reset = tracing::field::Empty,
        outlook.notification_wait_ms = lease
            .notification
            .as_ref()
            .map(|notification| since_ms(notification.received_at)),
        outlook.outcome = tracing::field::Empty,
        outlook.defer_reason = tracing::field::Empty,
        outlook.defer_seconds = tracing::field::Empty,
        otel.status_description = tracing::field::Empty,
    )
}

/// A refusal by the shared request gate is routine back-pressure, so it is
/// logged at DEBUG; the span still records it.
pub(super) fn is_gate_refusal(error: &MailboxError) -> bool {
    matches!(
        error,
        MailboxError::Provider(EmailApiError::RateLimited {
            origin: RateLimitOrigin::Gate(_),
            ..
        })
    )
}

/// The unit committed its work: `imported` or, for a vanished message,
/// `absent`; `unsynced` for a notified message no folder page would list;
/// `paced` for an import round's folder that waited for its import.
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
    let attachment_id = record_effect(span, error);
    if is_gate_refusal(error) {
        tracing::debug!(parent: span, %link_id, defer_reason = reason, defer_seconds = i64::from(delay_seconds), %error, "mailbox sync work deferred");
    } else {
        tracing::warn!(parent: span, %link_id, defer_reason = reason, defer_seconds = i64::from(delay_seconds), attachment_id = attachment_id.map(tracing::field::display), %error, "mailbox sync work deferred");
    }
}

/// The unit gave up on its message (`MessageRetry::Abandon`): it stays queued,
/// unclaimed, and the health snapshot counts it as `abandoned`.
pub(super) fn record_abandoned(span: &Span, link_id: Uuid, error: &MailboxError, attempts: i32) {
    let reason = defer_reason(error);
    span.record("outlook.outcome", "abandoned");
    span.record("outlook.defer_reason", reason);
    span.record("otel.status_description", tracing::field::display(error));
    tracing::warn!(parent: span, %link_id, defer_reason = reason, attempts, %error, "mailbox message abandoned");
}

/// The projection gave up on an event (`MessageRetry::Abandon`, or claims
/// that kept ending unfinished): its entry is deleted, so this is the one
/// record of it. The line holds only ids and kinds.
pub(super) fn record_projection_abandoned(
    span: &Span,
    link_id: Uuid,
    event_id: Uuid,
    event_kind: &'static str,
    attempts: i32,
    error: &MailboxError,
) {
    let reason = defer_reason(error);
    span.record("outlook.outcome", "abandoned");
    span.record("outlook.defer_reason", reason);
    span.record("otel.status_description", tracing::field::display(error));
    let attachment_id = record_effect(span, error);
    tracing::warn!(
        parent: span,
        %link_id,
        %event_id,
        event_kind,
        attempts,
        defer_reason = reason,
        attachment_id = attachment_id.map(tracing::field::display),
        "mailbox projection abandoned"
    );
}

/// The unit stopped without releasing its work, which another worker retries
/// once the lease expires, or lost its lease to a newer owner (`Stale`).
pub(super) fn record_failed(span: &Span, link_id: Uuid, error: &MailboxError) {
    let reason = defer_reason(error);
    span.record("outlook.outcome", "failed");
    span.record("outlook.defer_reason", reason);
    span.record("otel.status_description", tracing::field::display(error));
    let attachment_id = record_effect(span, error);
    if matches!(error, MailboxError::Stale) {
        tracing::debug!(parent: span, %link_id, defer_reason = reason, %error, "mailbox sync work failed");
    } else {
        tracing::warn!(parent: span, %link_id, defer_reason = reason, attachment_id = attachment_id.map(tracing::field::display), %error, "mailbox sync work failed");
    }
}

/// Records which effect failed (`outlook.effect`) and the attachment it was
/// working on (`outlook.attachment_id`), and returns that attachment.
fn record_effect(span: &Span, error: &MailboxError) -> Option<Uuid> {
    let MailboxError::Effect(failure) = error else {
        return None;
    };
    span.record("outlook.effect", failure.kind());
    let attachment_id = failure.attachment_id();
    if let Some(attachment_id) = attachment_id {
        span.record(
            "outlook.attachment_id",
            tracing::field::display(attachment_id),
        );
    }
    attachment_id
}

/// The root span of one claimed step of a draft. Its Graph requests are its
/// children, and its failure, if any, is logged inside it.
pub(super) fn draft_span(lease: &DraftLease) -> Span {
    tracing::info_span!(
        "outlook.draft.step",
        mailbox.link_id = %lease.mailbox.link_id,
        mailbox.sync_generation = lease.mailbox.sync_generation,
        email.message_id = %lease.message_id,
        draft.stage = draft_stage(lease),
        draft.revision = lease.revision,
        draft.delete_requested = lease.delete_requested,
        draft.error_code = tracing::field::Empty,
        outlook.outcome = tracing::field::Empty,
        outlook.defer_reason = tracing::field::Empty,
        otel.status_description = tracing::field::Empty,
    )
}

/// Where the step started: a lease with no checkpoint yet inspects the draft.
fn draft_stage(lease: &DraftLease) -> &'static str {
    lease
        .checkpoint
        .as_ref()
        .map_or("inspect", |checkpoint| checkpoint.stage.into())
}

/// The draft step was put back to run again.
pub(super) fn record_draft_deferred(span: &Span, error: &MailboxError) {
    span.record("outlook.outcome", "deferred");
    span.record("outlook.defer_reason", defer_reason(error));
    span.record("otel.status_description", tracing::field::display(error));
}

/// The draft's version moved with no edit, so the step goes on with the moved
/// draft. Shows which mailboxes change drafts on their own.
pub(super) fn draft_version_moved(lease: &DraftLease) {
    tracing::info!(
        event = "email_send.draft_version_moved",
        link_id = %lease.mailbox.link_id,
        message_id = %lease.message_id,
        stage = draft_stage(lease),
        "outlook draft version moved without an edit"
    );
}

/// The draft stopped with `failure`, so every send attempt waiting on it
/// reads as failed or unconfirmed. Logs ids and field names, never content.
pub(super) fn draft_failed(
    lease: &DraftLease,
    failure: DraftFailure,
    error: Option<&MailboxError>,
    attempts: &[Uuid],
) {
    let code = failure.code();
    Span::current().record("draft.error_code", code);
    let (change, changed_fields) = match error {
        Some(MailboxError::DraftChanged(DraftChange::Content(fields))) => {
            (Some("content"), Some(fields.join(",")))
        }
        Some(MailboxError::DraftChanged(DraftChange::Unknown)) => (Some("unknown"), None),
        _ => (None, None),
    };
    let attempt_ids = attempts
        .iter()
        .map(Uuid::to_string)
        .collect::<Vec<_>>()
        .join(",");
    tracing::warn!(
        event = "email_send.draft_failed",
        link_id = %lease.mailbox.link_id,
        message_id = %lease.message_id,
        attempt_ids,
        code,
        stage = draft_stage(lease),
        revision = lease.revision,
        delete_requested = lease.delete_requested,
        change,
        changed_fields,
        reason = error.map(defer_reason),
        "outlook draft failed"
    );
}

/// Logs why a unit of the other mailbox loops stopped or was deferred. Contacts,
/// commands, settings and watches have no span.
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
