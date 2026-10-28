//! Postgres adapter for the external chat repository ports, over the
//! `external_chat*` tables. The helpers taking a transaction are public so a
//! provider's own adapter writes these tables and signals the same way.

use crate::domain::{models::*, ports::ExternalChatResult};
use crate::signals;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

mod chats;
mod effects;
mod media;
mod timeline;

pub use media::{fail_attachment_in, queue_publication_in};

/// Repository over MacroDB.
#[derive(Clone)]
pub struct PgExternalChatRepository {
    pool: PgPool,
}

impl PgExternalChatRepository {
    /// Wrap the shared pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// Map an infrastructure error, keeping its cause for logs.
pub fn failure(
    error: impl std::error::Error + Send + Sync + 'static,
) -> rootcause::Report<ExternalChatError> {
    rootcause::Report::new(error).context(ExternalChatError::Unavailable)
}

/// Map an `anyhow` error from another domain's transactional helper.
pub fn helper_failure(error: impl std::fmt::Display) -> rootcause::Report<ExternalChatError> {
    rootcause::report!("{error:#}").context(ExternalChatError::Unavailable)
}

/// Stored data that breaks an invariant this crate or a provider maintains.
pub fn corrupt(what: impl std::fmt::Display) -> rootcause::Report<ExternalChatError> {
    rootcause::report!("stored WhatsApp data is invalid: {what}")
        .context(ExternalChatError::Internal)
}

/// Decode a JSON column written by this crate or a provider.
pub fn decode<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> ExternalChatResult<T> {
    serde_json::from_value(value)
        .map_err(|error| rootcause::Report::new(error).context(ExternalChatError::Internal))
}

/// Signal `channel` when the transaction commits, carrying the current trace.
pub async fn notify(
    tx: &mut Transaction<'_, Postgres>,
    channel: &str,
    id: Uuid,
) -> ExternalChatResult<()> {
    let payload = serde_json::to_string(&signals::Signal {
        id,
        traceparent: signals::trace_context::current(),
    })
    .map_err(failure)?;
    sqlx::query!("SELECT pg_notify($1, $2)", channel, payload)
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
    Ok(())
}

/// Tell DSS, when the transaction commits, that pages showing this changed.
pub async fn notify_change(
    tx: &mut Transaction<'_, Postgres>,
    change: signals::Change,
) -> ExternalChatResult<()> {
    let payload = serde_json::to_string(&signals::ChangeSignal {
        change,
        traceparent: signals::trace_context::current(),
    })
    .map_err(failure)?;
    sqlx::query!("SELECT pg_notify($1, $2)", signals::CHANGED, payload)
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
    Ok(())
}

/// Serialize mutations of a chat's messages, membership and sends before
/// locking any child row. Provider accounts, when needed, must be locked first.
pub async fn lock_chat_in(
    tx: &mut Transaction<'_, Postgres>,
    chat: Uuid,
) -> ExternalChatResult<()> {
    sqlx::query!(
        "SELECT id FROM external_chat WHERE id = $1 FOR UPDATE",
        chat
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?;
    Ok(())
}

/// An `external_chat` row as selected for a [`ChatRef`].
pub struct ChatRow {
    /// Entity id.
    pub id: Uuid,
    /// Provider spelling.
    pub provider: String,
    /// Remote chat id.
    pub remote_id: String,
    /// Kind spelling.
    pub kind: String,
    /// Owner.
    pub user_id: String,
    /// State spelling.
    pub state: String,
    /// History boundary.
    pub adopted_at: chrono::DateTime<chrono::Utc>,
}

/// Read a stored chat row.
pub fn chat_ref(row: ChatRow) -> ExternalChatResult<ChatRef> {
    Ok(ChatRef {
        id: row.id,
        provider: row
            .provider
            .parse::<ExternalChatProvider>()
            .map_err(|_| corrupt(format_args!("provider {:?}", row.provider)))?,
        remote_id: row.remote_id,
        kind: row
            .kind
            .parse::<ExternalChatKind>()
            .ok()
            .ok_or_else(|| corrupt(format_args!("kind {:?}", row.kind)))?,
        user_id: row.user_id,
        state: match row.state.as_str() {
            "active" => ChatState::Active,
            "detached" => ChatState::Detached,
            other => return Err(corrupt(format_args!("chat state {other:?}"))),
        },
        adopted_at: row.adopted_at,
    })
}
