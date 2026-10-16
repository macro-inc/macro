//! Trusted source-scoped attachment/body reconciliation. It cannot post or send
//! messages and never grants document permissions or emits live routine effects.

use super::*;

/// Exact source identity and a provider-ordered native body change.
pub struct ExternalMessageRevision<'a> {
    /// Native channel owning the message.
    pub channel: Uuid,
    /// Native message identity.
    pub message: Uuid,
    /// Integration source account.
    pub connection: Uuid,
    /// Source message identifier.
    pub provider_message: &'a str,
    /// Escaped, native-renderable body.
    pub content: Option<&'a str>,
    /// Monotonic source edit number.
    pub number: i64,
    /// Provider edit time.
    pub edited_at: Option<DateTime<Utc>>,
    /// Permanent provider tombstone time.
    pub deleted_at: Option<DateTime<Utc>>,
}

/// Provider acceptance that identifies an earlier business-account echo as a
/// deliberate native human reply. The hosting domain verifies acceptance first.
pub struct ExternalReplyAttribution<'a> {
    /// Native channel.
    pub channel: Uuid,
    /// Existing native identity; never replaced by the send intent's UUID.
    pub message: Uuid,
    /// Account and provider message scope.
    pub connection: Uuid,
    /// Provider identifier from the acceptance.
    pub provider_message: &'a str,
    /// Authenticated original human sender.
    pub sender: &'a ChannelSender<'static>,
    /// Original prepared body, escaped for native rendering.
    pub content: &'a str,
}

impl PgMessageRepository {
    /// Upgrade an external business echo exactly once. Its downloaded preview
    /// references are replaced by the original send's attachments by the caller.
    /// Replays cannot overwrite a human edit or restore unsent content.
    pub async fn attribute_accepted_reply_in(
        tx: &mut Transaction<'_, Postgres>,
        reply: ExternalReplyAttribution<'_>,
    ) -> Result<bool, MessageError> {
        let changed=sqlx::query!(r#"UPDATE comms_messages SET sender_id=$5,imported_author=NULL,
            content=CASE WHEN deleted_at IS NULL AND edited_at IS NULL THEN $6 ELSE content END,
            import_metadata=import_metadata||jsonb_build_object('provenance','macro_reply'),updated_at=GREATEST(updated_at,now())
            WHERE id=$1 AND parent_entity_type='channel' AND parent_entity_id=$2
              AND import_metadata->>'connection_id'=$3 AND import_metadata->>'provider_message_id'=$4
              AND import_metadata->>'direction'='outbound'
              AND import_metadata->>'provenance' IN ('phone_echo','onboarding_history')"#,
            reply.message,reply.channel.to_string(),reply.connection.to_string(),reply.provider_message,
            reply.sender.as_ref(),reply.content).execute(&mut **tx).await.map_err(database_error)?;
        if changed.rows_affected() == 0 {
            return Ok(false);
        }
        sqlx::query!(
            "DELETE FROM comms_attachments WHERE message_id=$1",
            reply.message
        )
        .execute(&mut **tx)
        .await
        .map_err(database_error)?;
        Ok(true)
    }

    /// Apply an ordered source edit or permanent unsend to its exact native
    /// message. Native human edits are preserved; unsends remove attached content.
    pub async fn revise_external_in(
        tx: &mut Transaction<'_, Postgres>,
        revision: ExternalMessageRevision<'_>,
    ) -> Result<bool, MessageError> {
        let ExternalMessageRevision {
            channel,
            message,
            connection,
            provider_message,
            content,
            number,
            edited_at,
            deleted_at,
        } = revision;
        let edited = edited_at.map(|t| t.naive_utc());
        let deleted = deleted_at.map(|t| t.naive_utc());
        let changed = sqlx::query!(r#"UPDATE comms_messages SET
            content=CASE WHEN $6::timestamp IS NOT NULL THEN '' ELSE COALESCE($5::text,content) END,
            edited_at=COALESCE($8::timestamp,edited_at),deleted_at=COALESCE(deleted_at,$6::timestamp),
            updated_at=GREATEST(updated_at,COALESCE($6::timestamp,$8::timestamp)),
            import_metadata=import_metadata||jsonb_build_object('provider_edit_number',$7::bigint)
            WHERE id=$1 AND parent_entity_type='channel' AND parent_entity_id=$2
            AND import_metadata->>'connection_id'=$3 AND import_metadata->>'provider_message_id'=$4
            AND deleted_at IS NULL AND ($6::timestamp IS NOT NULL OR ($5::text IS NOT NULL
                AND $7::bigint>COALESCE((import_metadata->>'provider_edit_number')::bigint,0)
                AND (edited_at IS NULL OR import_metadata ? 'provider_edit_number')))
            "#,message,channel.to_string(),connection.to_string(),provider_message,content,deleted,number,edited).execute(&mut **tx).await.map_err(database_error)?.rows_affected() == 1;
        if changed && deleted.is_some() {
            sqlx::query!("DELETE FROM comms_attachments WHERE message_id=$1", message)
                .execute(&mut **tx)
                .await
                .map_err(database_error)?;
        }
        Ok(changed)
    }

    /// Repair only an untouched technical placeholder from retained evidence.
    /// Human edits, changed bodies, unsends and other source messages are fenced.
    pub async fn repair_external_placeholder_in(
        tx: &mut Transaction<'_, Postgres>,
        channel: Uuid,
        message: Uuid,
        connection: Uuid,
        provider_message: &str,
        expected: &[String],
        content: &str,
    ) -> Result<bool, MessageError> {
        Ok(sqlx::query!(
            r#"UPDATE comms_messages SET content=$6,updated_at=now()
            WHERE id=$1 AND parent_entity_type='channel' AND parent_entity_id=$2
            AND import_metadata->>'connection_id'=$3 AND import_metadata->>'provider_message_id'=$4
            AND btrim(content,E' \n\r\t')=ANY($5::text[]) AND content<>$6
            AND deleted_at IS NULL AND edited_at IS NULL
            "#,
            message,
            channel.to_string(),
            connection.to_string(),
            provider_message,
            expected,
            content
        )
        .execute(&mut **tx)
        .await
        .map_err(database_error)?
        .rows_affected()
            == 1)
    }
    /// Append a document reference only to the exact integration-owned message.
    /// Caller first authorizes and grants the document through its owning services.
    pub async fn attach_external_file_in(
        tx: &mut Transaction<'_, Postgres>,
        channel: Uuid,
        message: Uuid,
        connection: Uuid,
        provider_message: &str,
        document: Uuid,
    ) -> Result<(), MessageError> {
        let target=sqlx::query!("SELECT id FROM comms_messages WHERE id=$1 AND parent_entity_type='channel' AND parent_entity_id=$2 AND import_metadata->>'connection_id'=$3 AND import_metadata->>'provider_message_id'=$4 AND deleted_at IS NULL FOR UPDATE",message,channel.to_string(),connection.to_string(),provider_message).fetch_optional(&mut **tx).await.map_err(database_error)?;
        if target.is_none() {
            return Err(MessageError::NotFound);
        }
        sqlx::query!("INSERT INTO comms_attachments (id,message_id,entity_type,entity_id) SELECT $1::uuid,$2::uuid,'document',$3::text WHERE NOT EXISTS (SELECT 1 FROM comms_attachments WHERE message_id=$2 AND entity_type='document' AND entity_id=$3::text) ON CONFLICT (id) DO NOTHING",Uuid::now_v7(),message,document.to_string()).execute(&mut **tx).await.map_err(database_error)?;
        sqlx::query!(
            "UPDATE comms_messages SET updated_at=GREATEST(updated_at,now()) WHERE id=$1",
            message
        )
        .execute(&mut **tx)
        .await
        .map_err(database_error)?;
        Ok(())
    }

    /// Update a source-owned unavailable-media notice, preserving any human edit
    /// or tombstone. The original provider text is retained by the receipt ledger.
    pub async fn external_media_notice_in(
        tx: &mut Transaction<'_, Postgres>,
        channel: Uuid,
        message: Uuid,
        connection: Uuid,
        provider_message: &str,
        content: &str,
    ) -> Result<(), MessageError> {
        sqlx::query!("UPDATE comms_messages SET content=$5,updated_at=GREATEST(updated_at,now()) WHERE id=$1 AND parent_entity_type='channel' AND parent_entity_id=$2 AND import_metadata->>'connection_id'=$3 AND import_metadata->>'provider_message_id'=$4 AND edited_at IS NULL AND deleted_at IS NULL",message,channel.to_string(),connection.to_string(),provider_message,content).execute(&mut **tx).await.map_err(database_error)?;
        Ok(())
    }
}
