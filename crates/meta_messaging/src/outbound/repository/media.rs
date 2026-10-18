//! Stable attachment reservations across partial uploads and worker restarts.

use super::*;
use sqlx::{Postgres, Transaction};

/// Source-bound attachment claim. A stored reservation has no active lease.
pub struct AttachmentReservation {
    /// Native document UUID, allocated once before external I/O.
    pub document_id: Uuid,
    /// Current attempt; absent means already stored.
    pub lease: Option<Uuid>,
    /// Stable source ordinal.
    pub ordinal: i16,
}

impl PgMessagingRepository {
    /// Resolve only the message's own native channel, without disclosing content.
    pub async fn message_target(
        &self,
        connection: Uuid,
        provider_message: &str,
    ) -> PortResult<(Uuid, Uuid)> {
        let row=sqlx::query!("SELECT c.channel_id,m.message_id FROM meta_messaging_message m JOIN meta_messaging_conversation c ON c.connection_id=m.connection_id AND c.customer_id=m.customer_id AND c.kind=m.conversation_kind WHERE m.connection_id=$1 AND m.provider_message_id=$2",connection,provider_message).fetch_optional(&self.pool).await.map_err(failure)?.ok_or(MessagingError::NotFound)?;
        Ok((row.channel_id, row.message_id))
    }

    /// Reserve one exact content hash. A conflicting source cannot overwrite a
    /// document already published to the channel.
    pub async fn reserve_attachment(
        &self,
        connection: Uuid,
        message: &str,
        ordinal: i16,
        sha: &str,
    ) -> PortResult<AttachmentReservation> {
        if !(0..10).contains(&ordinal) {
            return Err(MessagingError::Invalid("too many attachments").into());
        }
        let mut tx = self.pool.begin().await.map_err(failure)?;
        sqlx::query!("INSERT INTO meta_messaging_attachment (connection_id,provider_message_id,ordinal,document_id,sha256) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (connection_id,provider_message_id,ordinal) DO NOTHING",connection,message,ordinal,Uuid::now_v7(),sha).execute(&mut *tx).await.map_err(failure)?;
        let row=sqlx::query!("SELECT document_id,sha256,status,COALESCE(lease_until>now(),false) AS \"leased!\" FROM meta_messaging_attachment WHERE connection_id=$1 AND provider_message_id=$2 AND ordinal=$3 FOR UPDATE",connection,message,ordinal).fetch_one(&mut *tx).await.map_err(failure)?;
        if row.sha256 != sha {
            return Err(MessagingError::Conflict.into());
        }
        if row.status == "stored" {
            return Ok(AttachmentReservation {
                document_id: row.document_id,
                lease: None,
                ordinal,
            });
        }
        if row.leased {
            // A sibling owns this upload. This is contention, not evidence that
            // the attachment is unavailable; the receipt can safely retry.
            return Err(MessagingError::Conflict.into());
        }
        let lease = Uuid::now_v7();
        sqlx::query!("UPDATE meta_messaging_attachment SET lease_id=$4,lease_until=now()+interval '5 minutes' WHERE connection_id=$1 AND provider_message_id=$2 AND ordinal=$3",connection,message,ordinal,lease).execute(&mut *tx).await.map_err(failure)?;
        tx.commit().await.map_err(failure)?;
        Ok(AttachmentReservation {
            document_id: row.document_id,
            lease: Some(lease),
            ordinal,
        })
    }

    /// Mark only the current attachment attempt stored inside the same transaction
    /// as the canonical message reference. A lost fence is an explicit conflict.
    pub async fn finish_attachment_in(
        tx: &mut Transaction<'_, Postgres>,
        connection: Uuid,
        message: &str,
        reservation: &AttachmentReservation,
    ) -> PortResult<()> {
        let Some(lease) = reservation.lease else {
            return Ok(());
        };
        let changed=sqlx::query!("UPDATE meta_messaging_attachment SET status='stored',lease_id=NULL,lease_until=NULL WHERE connection_id=$1 AND provider_message_id=$2 AND ordinal=$3 AND lease_id=$4 AND lease_until>now() AND EXISTS (SELECT 1 FROM meta_messaging_message m WHERE m.connection_id=$1 AND m.provider_message_id=$2 AND m.provenance<>'macro_reply' AND NOT EXISTS (SELECT 1 FROM meta_messaging_revision r WHERE r.connection_id=m.connection_id AND r.customer_id=m.customer_id AND r.provider_message_id=m.provider_message_id AND r.direction=m.direction AND r.deleted_at IS NOT NULL))",connection,message,reservation.ordinal,lease).execute(&mut **tx).await.map_err(failure)?;
        if changed.rows_affected() != 1 {
            return Err(MessagingError::Conflict.into());
        }
        Ok(())
    }

    /// Release a failed attempt immediately; its stable document/hash remain resumable.
    pub async fn release_attachment(
        &self,
        connection: Uuid,
        message: &str,
        reservation: &AttachmentReservation,
    ) -> PortResult<()> {
        if let Some(lease) = reservation.lease {
            sqlx::query!("UPDATE meta_messaging_attachment SET lease_id=NULL,lease_until=NULL WHERE connection_id=$1 AND provider_message_id=$2 AND ordinal=$3 AND lease_id=$4",connection,message,reservation.ordinal,lease).execute(&self.pool).await.map_err(failure)?;
        }
        Ok(())
    }

    /// Whether received-media work still belongs to this source. Serialize its
    /// final mutation with stored media and accepted-reply reconciliation.
    pub async fn received_media_open_in(
        tx: &mut Transaction<'_, Postgres>,
        connection: Uuid,
        message: &str,
    ) -> PortResult<bool> {
        Ok(sqlx::query_scalar!("SELECT message_id FROM meta_messaging_message WHERE connection_id=$1 AND provider_message_id=$2 AND provenance<>'macro_reply' AND media_state<>'stored' FOR UPDATE", connection,message)
            .fetch_optional(&mut **tx).await.map_err(failure)?.is_some())
    }

    /// Dirty native delivery after media content changes. A revision prevents a
    /// concurrently completing old websocket/search pass from acknowledging new work.
    pub async fn media_state_in(
        tx: &mut Transaction<'_, Postgres>,
        connection: Uuid,
        message: &str,
        stored: bool,
    ) -> PortResult<bool> {
        let changed = sqlx::query!("UPDATE meta_messaging_message m SET media_state=CASE WHEN $3 THEN 'stored' ELSE 'failed' END,effect_revision=effect_revision+1,native_retry_at=now() WHERE connection_id=$1 AND provider_message_id=$2 AND ($3 OR m.media_state<>'stored') AND NOT EXISTS (SELECT 1 FROM meta_messaging_revision r WHERE r.connection_id=m.connection_id AND r.customer_id=m.customer_id AND r.provider_message_id=m.provider_message_id AND r.direction=m.direction AND r.deleted_at IS NOT NULL)",connection,message,stored).execute(&mut **tx).await.map_err(failure)?;
        Ok(changed.rows_affected() == 1)
    }
}
