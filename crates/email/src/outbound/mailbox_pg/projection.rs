use super::*;
use crate::domain::mailbox::projection::*;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashSet;

impl MailboxProjectionRepository for PgMailboxSync {
    async fn renew_projection(&self, lease: &ProjectionLease) -> Result<(), MailboxError> {
        let updated = sqlx::query!(r#"
            UPDATE email_projection_outbox o SET lease_until = now() + interval '3 minutes'
            FROM email_links l WHERE o.id = $1 AND o.lease_id = $2 AND o.lease_until > now()
                AND l.id = o.link_id AND l.is_sync_active AND l.sync_generation = $3 AND l.grant_generation = $4
        "#,lease.id,lease.lease_id,lease.mailbox.sync_generation,lease.mailbox.grant_generation)
            .execute(&self.db).await.map_err(db_error)?;
        if updated.rows_affected() != 1 {
            return Err(MailboxError::Stale);
        }
        Ok(())
    }
    async fn claim_projection(
        &self,
        lease_id: Uuid,
    ) -> Result<Option<ProjectionLease>, MailboxError> {
        let row = sqlx::query!(r#"
            WITH candidate AS (
                SELECT o.id FROM email_projection_outbox o JOIN email_links l ON l.id = o.link_id
                WHERE l.is_sync_active AND o.available_at <= now() AND (o.lease_until IS NULL OR o.lease_until < now())
                ORDER BY o.available_at,o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED
            )
            UPDATE email_projection_outbox o SET lease_id = $1,lease_until = now() + interval '3 minutes',attempts = attempts + 1
            FROM candidate c,email_links l WHERE o.id = c.id AND l.id = o.link_id
            RETURNING o.id,o.link_id,o.generation,o.payload,l.sync_generation,l.grant_generation
        "#,lease_id).fetch_optional(&self.db).await.map_err(db_error)?;
        row.map(|row| {
            Ok(ProjectionLease {
                id: row.id,
                lease_id,
                mailbox: MailboxKey {
                    link_id: row.link_id,
                    sync_generation: row.sync_generation,
                    grant_generation: row.grant_generation,
                },
                event: serde_json::from_value(row.payload)
                    .map_err(|_| MailboxError::Persistence)?,
                from_current_generation: row.generation == row.sync_generation,
            })
        })
        .transpose()
    }

    async fn projection_context(
        &self,
        lease: &ProjectionLease,
    ) -> Result<Option<ProjectionContext>, MailboxError> {
        let link = email_db_client::links::get::fetch_link_by_id(&self.db, lease.mailbox.link_id)
            .await
            .map_err(|_| MailboxError::Persistence)?;
        let Some(link) = link.filter(|link| link.is_sync_active) else {
            return Ok(None);
        };
        let active = sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM email_links WHERE id = $1 AND sync_generation = $2 AND grant_generation = $3) AS "active!""#,
            lease.mailbox.link_id,lease.mailbox.sync_generation,lease.mailbox.grant_generation).fetch_one(&self.db).await.map_err(db_error)?;
        if !active {
            return Err(MailboxError::Stale);
        }
        let delegates = sqlx::query_scalar!("SELECT primary_macro_id FROM macro_user_links WHERE link_id = $1 AND child_macro_id = $2",link.id,link.macro_id.as_ref())
            .fetch_all(&self.db).await.map_err(db_error)?;
        let mut viewers = HashSet::from([link.macro_id.clone()]);
        for delegate in delegates {
            viewers
                .insert(MacroUserIdStr::try_from(delegate).map_err(|_| MailboxError::Persistence)?);
        }
        let message_id = match &lease.event {
            ProjectionEvent::Message { message_id, .. }
            | ProjectionEvent::AttachmentRecheck { message_id } => Some(*message_id),
            _ => None,
        };
        let message = if let Some(id) = message_id {
            self.projected_message(link.id, id).await?
        } else {
            None
        };
        Ok(Some(ProjectionContext {
            link,
            message,
            viewers,
        }))
    }

    async fn finish_projection(
        &self,
        lease: &ProjectionLease,
        success: bool,
    ) -> Result<(), MailboxError> {
        if success {
            sqlx::query!("DELETE FROM email_projection_outbox WHERE id = $1 AND lease_id = $2 AND lease_until > now()",lease.id,lease.lease_id)
                .execute(&self.db).await.map_err(db_error)?;
        } else {
            sqlx::query!(
                r#"UPDATE email_projection_outbox SET lease_id = NULL,lease_until = NULL,
                available_at = now() + make_interval(secs => LEAST(600,30 * attempts))
                WHERE id = $1 AND lease_id = $2"#,
                lease.id,
                lease.lease_id
            )
            .execute(&self.db)
            .await
            .map_err(db_error)?;
        }
        Ok(())
    }
}

impl PgMailboxSync {
    async fn projected_message(
        &self,
        link_id: Uuid,
        message_id: Uuid,
    ) -> Result<Option<ProjectedMessage>, MailboxError> {
        let db_message = sqlx::query_as!(models_email::db::message::Message,r#"
            SELECT m.id,m.provider_id,m.global_id,m.thread_id,m.provider_thread_id,m.replying_to_id,m.link_id,
                m.provider_history_id,m.internal_date_ts,m.snippet,m.size_estimate,m.subject,m.from_name,
                m.from_contact_id,m.sent_at,m.has_attachments,m.is_read,m.is_starred,m.is_sent,m.is_draft,
                m.headers_jsonb,m.created_at,m.updated_at,
                NULL::text AS body_text,NULL::text AS body_html_sanitized,NULL::text AS body_macro
            FROM email_messages m WHERE m.id = $1 AND m.link_id = $2
        "#,message_id,link_id).fetch_optional(&self.db).await.map_err(db_error)?;
        let Some(db_message) = db_message else {
            return Ok(None);
        };
        let facts = sqlx::query!(r#"
            SELECT f.in_inbox,f.in_trash,f.in_junk,f.is_present,t.inbox_visible,t.is_signal,m.provider_version
            FROM email_messages m JOIN email_message_mailbox_facts f ON f.id = m.id JOIN email_threads t ON t.id = m.thread_id
            WHERE m.id = $1 AND m.link_id = $2
        "#,message_id,link_id).fetch_optional(&self.db).await.map_err(db_error)?;
        let Some(facts) = facts else {
            return Ok(None);
        };
        let Some(message) =
            email_db_client::messages::get::convert_db_messages_to_service_concurrent(
                &self.db,
                vec![db_message],
            )
            .await
            .map_err(|_| MailboxError::Persistence)?
            .pop()
        else {
            return Ok(None);
        };
        Ok(Some(ProjectedMessage {
            message,
            in_inbox: facts.in_inbox.unwrap_or(false),
            in_trash: facts.in_trash.unwrap_or(false),
            in_junk: facts.in_junk.unwrap_or(false),
            is_present: facts.is_present.unwrap_or(false),
            thread_inbox_visible: facts.inbox_visible,
            is_signal: facts.is_signal,
            version: facts.provider_version,
        }))
    }
}
