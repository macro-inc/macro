//! Scoped, monotonic revision facts. Pending facts do not create native entities.

use super::*;
use crate::domain::events::{Direction, IncomingRevision, MessageRevision};
use sqlx::{Postgres, Transaction};

/// Latest provider revision, resolved only within its original conversation.
pub struct StoredRevision {
    /// Existing native channel.
    pub channel_id: Uuid,
    /// Existing native message.
    pub message_id: Uuid,
    /// New text, absent for unsends.
    pub content: Option<String>,
    /// Monotonic Meta edit counter.
    pub edit_number: i64,
    /// Provider edit time.
    pub edited_at: Option<DateTime<Utc>>,
    /// Permanent tombstone time.
    pub deleted_at: Option<DateTime<Utc>>,
}

impl PgMessagingRepository {
    /// Serialize with message ingestion and reconnect. Duplicate/older revisions
    /// are no-ops; a customer cannot edit the business side of the conversation.
    pub async fn record_revision_in(
        tx: &mut Transaction<'_, Postgres>,
        c: &Connection,
        r: &IncomingRevision,
    ) -> PortResult<()> {
        let account = sqlx::query!(
            "SELECT status,connected_at FROM meta_messaging_connection WHERE id=$1 FOR UPDATE",
            c.id
        )
        .fetch_one(&mut **tx)
        .await
        .map_err(failure)?;
        if account.connected_at != c.connected_at
            || matches!(account.status.as_str(), "disconnected" | "revoked")
        {
            return Err(MessagingError::Conflict.into());
        }
        let target = sqlx::query!("SELECT customer_id,direction FROM meta_messaging_message WHERE connection_id=$1 AND provider_message_id=$2", c.id, r.message_id.as_str())
            .fetch_optional(&mut **tx).await.map_err(failure)?;
        if target.is_some_and(|m| {
            m.customer_id != r.customer_id.as_str() || m.direction != spelling(r.direction)
        }) {
            return Err(MessagingError::IdentityConflict.into());
        }
        let prior = sqlx::query_scalar!("SELECT direction FROM meta_messaging_revision WHERE connection_id=$1 AND customer_id=$2 AND provider_message_id=$3",c.id,r.customer_id.as_str(),r.message_id.as_str()).fetch_optional(&mut **tx).await.map_err(failure)?;
        if prior.is_some_and(|direction| direction != spelling(r.direction)) {
            return Err(MessagingError::IdentityConflict.into());
        }
        let (content, number, edited, deleted) = match &r.change {
            MessageRevision::Edited { text, number } => (
                Some(text.as_str()),
                i64::from(*number),
                Some(r.timestamp),
                None,
            ),
            MessageRevision::Deleted => (None, 0, None, Some(r.timestamp)),
        };
        sqlx::query!("INSERT INTO meta_messaging_revision (connection_id,customer_id,provider_message_id,direction,content,edit_number,edited_at,deleted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (connection_id,customer_id,provider_message_id) DO UPDATE SET content=EXCLUDED.content,edit_number=GREATEST(meta_messaging_revision.edit_number,EXCLUDED.edit_number),edited_at=EXCLUDED.edited_at,deleted_at=EXCLUDED.deleted_at WHERE meta_messaging_revision.deleted_at IS NULL AND (EXCLUDED.deleted_at IS NOT NULL OR EXCLUDED.edit_number>meta_messaging_revision.edit_number)",c.id,r.customer_id.as_str(),r.message_id.as_str(),spelling(r.direction),content,number,edited,deleted).execute(&mut **tx).await.map_err(failure)?;
        Ok(())
    }

    /// Resolve a pending revision without using an unscoped provider identifier.
    pub async fn revision_in(
        tx: &mut Transaction<'_, Postgres>,
        connection: Uuid,
        customer: &ProviderId,
        message: &ProviderId,
        direction: Direction,
    ) -> PortResult<Option<StoredRevision>> {
        let row = sqlx::query!("SELECT c.channel_id,m.message_id,r.content,r.edit_number,r.edited_at,r.deleted_at FROM meta_messaging_revision r JOIN meta_messaging_message m ON m.connection_id=r.connection_id AND m.customer_id=r.customer_id AND m.provider_message_id=r.provider_message_id AND m.direction=r.direction JOIN meta_messaging_conversation c ON c.connection_id=m.connection_id AND c.customer_id=m.customer_id AND c.kind=m.conversation_kind WHERE r.connection_id=$1 AND r.customer_id=$2 AND r.provider_message_id=$3 AND r.direction=$4",connection,customer.as_str(),message.as_str(),spelling(direction)).fetch_optional(&mut **tx).await.map_err(failure)?;
        Ok(row.map(|r| StoredRevision {
            channel_id: r.channel_id,
            message_id: r.message_id,
            content: r.content,
            edit_number: r.edit_number,
            edited_at: r.edited_at,
            deleted_at: r.deleted_at,
        }))
    }

    /// Schedule native publication only when the owning message actually changed.
    pub async fn revision_applied_in(
        tx: &mut Transaction<'_, Postgres>,
        message: Uuid,
        deleted: bool,
    ) -> PortResult<()> {
        sqlx::query!("UPDATE meta_messaging_message SET effect_revision=effect_revision+1,native_retry_at=now(),media_state=CASE WHEN $2 THEN 'stored' ELSE media_state END WHERE message_id=$1",message,deleted).execute(&mut **tx).await.map_err(failure)?;
        Ok(())
    }
}
