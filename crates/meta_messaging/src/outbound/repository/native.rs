//! Transaction-aware helpers for the hosting composition root. This module
//! touches only messaging-owned tables; channel/message helpers remain in their owners.

use super::*;
use crate::domain::events::{Direction, IncomingMessage};
use sqlx::{Postgres, Transaction};

/// A locked connection-scoped conversation and message identity.
pub struct MessageReservation {
    /// Real or newly reserved channel ID.
    pub channel_id: Uuid,
    /// Stable customer author UUID, independent of display name/handle.
    pub sender_id: Uuid,
    /// Native message UUID.
    pub message_id: Uuid,
    /// Caller must create the native channel before inserting the mapping.
    pub create_channel: bool,
    /// Caller must insert the canonical message before finishing its mapping.
    pub create_message: bool,
}

/// A native message revision awaiting realtime and search publication.
#[derive(Debug, PartialEq, Eq)]
pub struct NativeEffect {
    /// Owning native channel.
    pub channel_id: Uuid,
    /// Canonical message identity.
    pub message_id: Uuid,
    /// Revision fenced by settlement.
    pub revision: i64,
    /// No earlier revision has been published, even if media changed it already.
    pub first_publication: bool,
    /// History is published to native caches without creating fresh activity.
    pub provenance: Provenance,
    /// Live customer messages notify teammates; business replies do not.
    pub direction: Direction,
}

impl PgMessagingRepository {
    /// Lock a live account so concurrent arrivals share one conversation and
    /// disconnect cannot race its commit. Accepted sends may finish after disconnect.
    pub async fn reserve_message_in(
        tx: &mut Transaction<'_, Postgres>,
        c: &Connection,
        m: &IncomingMessage,
        native_id: Option<Uuid>,
    ) -> PortResult<MessageReservation> {
        let account = sqlx::query!(
            "SELECT status,team_id,connected_at FROM meta_messaging_connection WHERE id = $1 FOR UPDATE",
            c.id
        )
        .fetch_optional(&mut **tx)
        .await
        .map_err(failure)?
        .ok_or(MessagingError::NotFound)?;
        if account.team_id != c.team_id
            || (native_id.is_none() && account.connected_at != c.connected_at)
        {
            return Err(MessagingError::Conflict.into());
        }
        if native_id.is_none() && matches!(account.status.as_str(), "disconnected" | "revoked") {
            return Err(MessagingError::Disconnected.into());
        }
        let conversation=sqlx::query!("SELECT channel_id,external_sender_id FROM meta_messaging_conversation WHERE connection_id = $1 AND customer_id = $2",c.id,m.customer_id.as_str()).fetch_optional(&mut **tx).await.map_err(failure)?;
        let (channel_id, sender_id, create_channel) = conversation.map_or_else(
            || (Uuid::now_v7(), Uuid::now_v7(), true),
            |r| (r.channel_id, r.external_sender_id, false),
        );
        let message=sqlx::query!("SELECT message_id,customer_id,direction FROM meta_messaging_message WHERE connection_id = $1 AND provider_message_id = $2",c.id,m.message_id.as_str()).fetch_optional(&mut **tx).await.map_err(failure)?;
        if message.as_ref().is_some_and(|r| {
            r.customer_id != m.customer_id.as_str() || r.direction != spelling(m.direction)
        }) {
            return Err(MessagingError::Conflict.into());
        }
        Ok(MessageReservation {
            channel_id,
            sender_id,
            message_id: message
                .as_ref()
                .map_or_else(|| native_id.unwrap_or_else(Uuid::now_v7), |r| r.message_id),
            create_channel,
            create_message: message.is_none(),
        })
    }

    /// Commit a mapping only after the owning channel/message rows exist. An
    /// inbound source timestamp opens a window only after account connection.
    pub async fn finish_message_in(
        tx: &mut Transaction<'_, Postgres>,
        c: &Connection,
        m: &IncomingMessage,
        r: &MessageReservation,
        send: Option<Uuid>,
    ) -> PortResult<()> {
        let window_until = crate::domain::meta_policy::customer_window_until(c, m, Utc::now());
        let phone = if c.provider == Provider::Whatsapp
            && m.customer_id.as_str().bytes().all(|b| b.is_ascii_digit())
        {
            Some(format!("+{}", m.customer_id.as_str()))
        } else {
            None
        };
        let customer_name = if m.direction == Direction::Inbound {
            m.author_name.as_deref()
        } else {
            None
        };
        let customer_handle = if m.direction == Direction::Inbound {
            m.author_handle.as_deref()
        } else {
            None
        };
        sqlx::query!("INSERT INTO meta_messaging_conversation (connection_id,customer_id,channel_id,external_sender_id,customer_display_name,customer_phone,customer_handle) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (connection_id,customer_id) DO UPDATE SET customer_display_name = COALESCE(EXCLUDED.customer_display_name,meta_messaging_conversation.customer_display_name),customer_handle=COALESCE(EXCLUDED.customer_handle,meta_messaging_conversation.customer_handle)",c.id,m.customer_id.as_str(),r.channel_id,r.sender_id,customer_name,phone,customer_handle).execute(&mut **tx).await.map_err(failure)?;
        if let Some(window_until) = window_until {
            sqlx::query!("UPDATE meta_messaging_conversation SET last_customer_message_at = GREATEST(last_customer_message_at,$3),standard_window_until = GREATEST(standard_window_until,$4) WHERE connection_id = $1 AND customer_id = $2",c.id,m.customer_id.as_str(),m.timestamp,window_until).execute(&mut **tx).await.map_err(failure)?;
        }
        if r.create_message {
            let states=sqlx::query_scalar!("SELECT state FROM meta_messaging_status WHERE connection_id = $1 AND provider_message_id = $2",c.id,m.message_id.as_str()).fetch_all(&mut **tx).await.map_err(failure)?;
            let mut state = DeliveryState::Accepted;
            for s in states {
                state = state.reconcile(decode(serde_json::Value::String(s))?);
            }
            sqlx::query!("INSERT INTO meta_messaging_message (connection_id,provider_message_id,message_id,customer_id,provenance,direction,provider_timestamp,reply_to_id,delivery_state,media_state,provider_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",c.id,m.message_id.as_str(),r.message_id,m.customer_id.as_str(),spelling(m.provenance),spelling(m.direction),m.timestamp,m.reply_to.as_ref().map(ProviderId::as_str),spelling(state),if m.media.is_empty()&&m.message_type!="macro_media_reply"{"none"}else{"pending"},m.message_type).execute(&mut **tx).await.map_err(failure)?;
        }
        if let Some(send) = send {
            sqlx::query!(
                r#"UPDATE meta_messaging_message SET provenance='macro_reply',provider_type=$4,
                media_state=CASE WHEN EXISTS (SELECT 1 FROM meta_messaging_revision r WHERE r.connection_id=$1 AND r.provider_message_id=$2 AND r.deleted_at IS NOT NULL) THEN 'stored' WHEN $5 THEN 'pending' ELSE 'none' END,
                effect_revision=effect_revision+1,event_published_at=NULL,native_retry_at=now()
                WHERE connection_id=$1 AND provider_message_id=$2 AND message_id=$3
                  AND direction='outbound' AND provenance<>'macro_reply'"#,
                c.id,
                m.message_id.as_str(),
                r.message_id,
                m.message_type,
                m.message_type == "macro_media_reply"
            )
            .execute(&mut **tx)
            .await
            .map_err(failure)?;
            let changed=sqlx::query!("UPDATE meta_messaging_send SET message_id = $2,state = (SELECT delivery_state FROM meta_messaging_message WHERE message_id = $2),updated_at = now() WHERE id = $1 AND connection_id = $3 AND channel_id = $4 AND provider_message_id = $5 AND (message_id IS NULL OR message_id = $2)",send,r.message_id,c.id,r.channel_id,m.message_id.as_str()).execute(&mut **tx).await.map_err(failure)?;
            if changed.rows_affected() != 1 {
                return Err(MessagingError::Conflict.into());
            }
        }
        Ok(())
    }

    /// Pending native realtime/search delivery, including accepted replies and
    /// silent history. This feed deliberately does not publish routine/agent triggers.
    pub async fn pending_native_effects(&self) -> PortResult<Vec<NativeEffect>> {
        sqlx::query!("SELECT c.channel_id,m.message_id,m.effect_revision,m.published_revision,m.provenance,m.direction FROM meta_messaging_message m JOIN meta_messaging_conversation c ON c.connection_id = m.connection_id AND c.customer_id = m.customer_id WHERE m.published_revision<m.effect_revision AND m.native_retry_at<=now() ORDER BY m.native_retry_at,m.created_at,m.message_id LIMIT 100")
            .fetch_all(&self.pool).await.map_err(failure)?
            .into_iter().map(|r| Ok(NativeEffect {
                channel_id: r.channel_id,
                message_id: r.message_id,
                revision: r.effect_revision,
                first_publication: r.published_revision == 0,
                provenance: decode(serde_json::Value::String(r.provenance))?,
                direction: decode(serde_json::Value::String(r.direction))?,
            })).collect()
    }
    /// Failed effects yield durably to other messages. A newer revision is never
    /// postponed by an older worker's failure, nor is a completed effect reopened.
    pub async fn defer_native_effect(&self, message: Uuid, revision: i64) -> PortResult<()> {
        sqlx::query!("UPDATE meta_messaging_message SET native_retry_at=now()+interval '30 seconds' WHERE message_id=$1 AND effect_revision=$2 AND published_revision<$2",message,revision)
            .execute(&self.pool).await.map_err(failure)?;
        Ok(())
    }
    /// Mark after the native delivery systems accepted the change. Replays use
    /// stable message/activity/notification identities and idempotent updates.
    pub async fn native_effects_complete(&self, message: Uuid, revision: i64) -> PortResult<()> {
        let changed=sqlx::query!("UPDATE meta_messaging_message SET event_published_at=now(),published_revision=$2 WHERE message_id=$1 AND effect_revision=$2",message,revision).execute(&self.pool).await.map_err(failure)?;
        if changed.rows_affected() != 1 {
            return Err(MessagingError::Conflict.into());
        }
        Ok(())
    }
}
