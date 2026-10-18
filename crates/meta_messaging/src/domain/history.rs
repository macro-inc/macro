//! Explicit account-level history import; live connection never implies consent.
use super::{connection::*, events::IncomingMessage, models::Provider};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

/// Durable import status safe to display in account settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaHistoryImport))]
pub struct HistoryImport {
    /// Explicit consent time, independent of connection time.
    pub requested_at: DateTime<Utc>,
    /// Current import outcome; acceptance is not completion.
    pub status: HistoryStatus,
    /// Provider progress, when available.
    pub progress: Option<u8>,
    /// Sanitized, actionable recovery reason.
    pub error_code: Option<String>,
    /// Some media was unavailable, with a notice retained in its channel.
    pub unavailable_media: bool,
}

/// Server-authorized import affordance and current progress.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaHistoryImportView))]
pub struct HistoryImportView {
    /// Whether the connector or administrator may start or resume an import now.
    pub can_import: bool,
    /// Explanation when unavailable; no credentials or provider response bodies.
    pub reason: Option<String>,
    /// Only a job explicitly requested for this connection generation.
    pub import: Option<HistoryImport>,
}

/// Provider steps; one-time WhatsApp POSTs are fenced before dispatch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HistoryStep {
    /// Contact synchronization precedes WhatsApp message synchronization.
    Contacts,
    /// Contact request may already have been accepted; never blindly repeat it.
    ContactsRequested,
    /// Ready to request WhatsApp message history.
    Messages,
    /// Message-history request may have been accepted; wait for signed webhooks.
    Waiting,
    /// Fetch the next bounded page of Instagram conversations.
    Instagram,
}

/// Claimed durable import. The lease ID is the connection ID.
#[cfg(feature = "ports")]
pub struct HistoryWork {
    /// Attempt fence.
    pub lease: super::ports::Lease,
    /// Authorization generation; reconnect invalidates pending work.
    pub connected_at: DateTime<Utc>,
    /// Consenting user; current membership and recorded consent are rechecked before every page.
    pub user_id: String,
    /// Current provider step.
    pub step: HistoryStep,
    /// Opaque Instagram cursor, never a URL to follow.
    pub cursor: Option<String>,
    /// Attempts at this checkpoint.
    pub attempts: u16,
}

/// One bounded provider page, persisted before moving the cursor.
pub struct HistoryPage {
    /// Original timestamps, identities and history provenance.
    pub messages: Vec<IncomingMessage>,
    /// More conversations; absence is completion.
    pub next: Option<String>,
}

/// Facts that make a new import unavailable. Existing history is never deleted.
pub fn unavailable_reason(c: &Connection, now: DateTime<Utc>) -> Option<&'static str> {
    if c.health_error.as_deref().is_some_and(|error| {
        error == super::health::ConnectionFailure::MetaAccess.code()
            || error.starts_with("Meta has not granted")
    }) {
        return Some(
            "Meta hasn't granted this app access. Complete any account confirmation and review messaging permissions in Meta before reconnecting.",
        );
    }
    if !c.is_ready() {
        return Some("Reconnect this account before importing history.");
    }
    if c.whatsapp_mode == Some(WhatsappMode::Platform) && !c.developer_account {
        return Some("Platform numbers have no WhatsApp Business-app history to import.");
    }
    if c.provider == Provider::Whatsapp {
        if c.developer_account {
            return Some("Meta test numbers have no Business-app history to import.");
        }
        if c.connected_at
            .is_none_or(|at| now >= at + Duration::hours(24))
        {
            return Some(
                "WhatsApp's 24-hour history-import window has closed. To import, disconnect the Business Platform in WhatsApp Business and complete setup again with history sharing enabled.",
            );
        }
    }
    None
}
