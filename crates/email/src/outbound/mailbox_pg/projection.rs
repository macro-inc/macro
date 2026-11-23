use super::*;
use crate::domain::mailbox::projection::*;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashSet;

impl MailboxProjectionRepository for PgMailboxSync {
    async fn renew_projection(&self, lease: &ProjectionLease) -> Result<(), MailboxError> {
        let updated = sqlx::query!(r#"
            UPDATE email_projection_outbox o SET lease_until = now() + interval '3 minutes', blocked_until = now() + interval '3 minutes'
            FROM email_links l WHERE o.id = $1 AND o.lease_id = $2 AND o.lease_until > now()
                AND l.id = o.link_id AND l.is_sync_active AND l.sync_generation = $3 AND l.grant_generation = $4
        "#,lease.id,lease.lease_id,lease.mailbox.sync_generation,lease.mailbox.grant_generation)
            .execute(&self.db).await.map_err(db_error)?;
        if updated.rows_affected() != 1 {
            return Err(MailboxError::Stale);
        }
        Ok(())
    }
    async fn claim_projection(&self, lease_id: Uuid) -> Result<ProjectionClaim, MailboxError> {
        let mut tx = self.begin().await.map_err(db_error)?;
        sqlx::query!(
            r#"
            SET LOCAL statement_timeout = '15s'
            "#,
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        let ids = self.lock_projection_window(&mut tx).await?;
        if ids.is_empty() {
            tx.commit().await.map_err(db_error)?;
            return Ok(ProjectionClaim::Idle);
        }
        let result = self.claim_locked_projection(&mut tx, lease_id, &ids).await;
        tx.commit().await.map_err(db_error)?;
        result
    }

    async fn projection_context(
        &self,
        lease: &ProjectionLease,
    ) -> Result<Option<ProjectionContext>, MailboxError> {
        let link = email_db_client::links::get::fetch_link_by_id(&self.db, lease.mailbox.link_id)
            .await
            .map_err(wrapped_db_error)?;
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
        retry: Option<MessageRetry>,
    ) -> Result<(), MailboxError> {
        let mut tx = self.begin().await.map_err(db_error)?;
        self.lock_projection_finish(&mut tx, lease.mailbox.link_id)
            .await?;
        let changed = match retry {
            None | Some(MessageRetry::Abandon) => {
                let deleted = sqlx::query!("DELETE FROM email_projection_outbox WHERE id = $1 AND lease_id = $2 AND lease_until > now()",lease.id,lease.lease_id)
                    .execute(&mut *tx).await.map_err(db_error)?;
                // An abandonment is logged once, by the worker whose lease
                // deleted the entry; one that lost its lease reports it lost.
                if matches!(retry, Some(MessageRetry::Abandon)) && deleted.rows_affected() != 1 {
                    return Err(MailboxError::Stale);
                }
                deleted.rows_affected()
            }
            Some(MessageRetry::After { seconds, counted }) => {
                sqlx::query!(
                    r#"UPDATE email_projection_outbox SET lease_id = NULL,lease_until = NULL,blocked_until = NULL,
                    available_at = now() + make_interval(secs => $3),
                    attempts = attempts - CASE WHEN $4 THEN 0 ELSE 1 END
                    WHERE id = $1 AND lease_id = $2 AND lease_until > now()"#,
                    lease.id,
                    lease.lease_id,
                    f64::from(seconds),
                    counted
                )
                .execute(&mut *tx)
                .await
                .map_err(db_error)?.rows_affected()
            }
        };
        if changed == 1 {
            // Wake exactly the successor, atomically with the fenced outcome.
            // Its own retry floor stays intact. A released head still blocks it
            // through the unfinished-sibling check until that head completes.
            self.wake_projection_successor(&mut tx, lease.mailbox.link_id, lease.id)
                .await?;
        }
        tx.commit().await.map_err(db_error)?;
        if changed == 1 {
            // A producer can insert a successor after the first wake snapshot
            // but before commit. A fresh transaction waits for any claim on it
            // and clears that claim's deferral. A crash here needs the backstop.
            if let Err(error) = self
                .wake_projection_after_commit(lease.mailbox.link_id, lease.id)
                .await
            {
                tracing::warn!(
                    projection.post_commit_wake = "failed",
                    link_id = %lease.mailbox.link_id,
                    ?error,
                    "projection successor wake retained for backstop"
                );
            }
        }
        Ok(())
    }
}

impl PgMailboxSync {
    async fn lock_projection_finish(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        link: Uuid,
    ) -> Result<(), MailboxError> {
        sqlx::query!(
            "SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended('email.projection.finish:' || $1::uuid::text,0))",
            link
        ).fetch_one(&mut **tx).await.map_err(db_error)?;
        Ok(())
    }

    async fn wake_projection_successor(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        link: Uuid,
        exclude: Uuid,
    ) -> Result<(), MailboxError> {
        sqlx::query!(
            r#"
                WITH successor AS MATERIALIZED (
                    SELECT id, blocked_until FROM email_projection_outbox
                    WHERE link_id=$1 AND id<>$2
                    ORDER BY seq NULLS FIRST,id LIMIT 1 FOR UPDATE
                )
                UPDATE email_projection_outbox o SET blocked_until=NULL
                FROM successor s WHERE o.id=s.id AND s.blocked_until IS NOT NULL
                "#,
            link,
            exclude
        )
        .execute(&mut **tx)
        .await
        .map_err(db_error)?;
        Ok(())
    }

    #[tracing::instrument(skip_all,name="email.projection.wake_after_commit",fields(
        projection.link_id=tracing::field::Empty,
    ),err)]
    async fn wake_projection_after_commit(
        &self,
        link: Uuid,
        exclude: Uuid,
    ) -> Result<(), MailboxError> {
        tracing::Span::current().record("projection.link_id", link.to_string());
        let mut tx = self.begin().await.map_err(db_error)?;
        self.lock_projection_finish(&mut tx, link).await?;
        self.wake_projection_successor(&mut tx, link, exclude)
            .await?;
        tx.commit().await.map_err(db_error)?;
        Ok(())
    }

    /// Hold the bounded window before the eligibility statement takes its
    /// fresh READ COMMITTED snapshot. A concurrent finish either commits before
    /// that snapshot or waits on these locks and overwrites the deferral later.
    pub(super) async fn lock_projection_window(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ) -> Result<Vec<Uuid>, MailboxError> {
        sqlx::query_scalar!(
            r#"
            SELECT o.id FROM email_projection_outbox o
            WHERE o.parked_at IS NULL
                AND GREATEST(o.available_at, COALESCE(o.blocked_until, '-infinity'::timestamptz)) <= now()
            ORDER BY GREATEST(o.available_at, COALESCE(o.blocked_until, '-infinity'::timestamptz)),o.id
            LIMIT 64 FOR UPDATE OF o SKIP LOCKED
            "#
        ).fetch_all(&mut **tx).await.map_err(db_error)
    }

    /// The caller must already hold every id's window lock in this transaction.
    pub(super) async fn claim_locked_projection(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        lease_id: Uuid,
        ids: &[Uuid],
    ) -> Result<ProjectionClaim, MailboxError> {
        // The expression index serves both the due range and its order; the
        // legacy available_at-only index cannot provide this ordering.
        // New events use FIFO per serialized producer. Legacy UUIDv7 ids have no defined
        // inter-process order within a millisecond; that window ends when the
        // NULL sequence cohort drains. Order-independent legacy rechecks may be v4.
        // Each claim inspects at most 64 rows; an unfinished predecessor blocks
        // even while backed off or locked before its lease has committed.
        let row = sqlx::query!(
            r#"
            WITH due AS MATERIALIZED (
                SELECT o.id, o.link_id, o.available_at, o.lease_until,
                    GREATEST(o.available_at, COALESCE(o.blocked_until, '-infinity'::timestamptz)) AS eligible_at
                FROM email_projection_outbox o
                WHERE o.id=ANY($2::uuid[])
            ), ordered AS MATERIALIZED (
                SELECT d.*, first.id AS first_id
                FROM due d
                CROSS JOIN LATERAL (
                    SELECT earlier.id
                    FROM email_projection_outbox earlier
                    WHERE earlier.link_id = d.link_id
                    ORDER BY earlier.seq NULLS FIRST, earlier.id
                    LIMIT 1
                ) first
            ), links AS MATERIALIZED (
                SELECT l.id, l.is_sync_active
                FROM email_links l
                JOIN (SELECT DISTINCT link_id FROM due) d ON d.link_id = l.id
            ), inactive AS MATERIALIZED (
                SELECT l.id
                FROM email_links l
                JOIN (SELECT DISTINCT link_id FROM due) d ON d.link_id = l.id
                WHERE NOT l.is_sync_active
                FOR SHARE OF l SKIP LOCKED
            ), deferred AS (
                UPDATE email_projection_outbox o
                SET parked_at = CASE WHEN inactive.id IS NOT NULL THEN clock_timestamp() ELSE o.parked_at END,
                    blocked_until = CASE WHEN d.first_id <> d.id THEN now() + interval '1 hour' * (1 + random())
                        WHEN d.lease_until > now() THEN d.lease_until
                        ELSE now() + interval '1 second' END
                FROM ordered d JOIN links l ON l.id = d.link_id
                    LEFT JOIN inactive ON inactive.id = d.link_id
                WHERE o.id = d.id
                    AND (NOT l.is_sync_active OR d.lease_until > now() OR d.first_id <> d.id)
                RETURNING o.id
            ), candidate AS (
                SELECT d.id
                FROM ordered d JOIN links l ON l.id = d.link_id
                WHERE l.is_sync_active
                    AND (d.lease_until IS NULL OR d.lease_until <= now())
                    AND d.id = d.first_id
                ORDER BY d.eligible_at, d.id
                LIMIT 1
            )
            , claimed AS (
            -- Every recorded outcome deletes the entry or clears its lease, so a
            -- lease still set here expired under a worker that stopped.
            UPDATE
                email_projection_outbox o
            SET
                lease_id = $1,
                lease_until = now() + interval '3 minutes',
                blocked_until = now() + interval '3 minutes',
                attempts = attempts + 1,
                unfinished_claims = CASE WHEN o.lease_id IS NULL THEN
                    0
                ELSE
                    o.unfinished_claims + 1
                END
            FROM
                candidate c,
                email_links l
            WHERE
                o.id = c.id
                AND l.id = o.link_id
            RETURNING
                o.id,
                o.link_id,
                o.generation,
                o.payload,
                o.attempts,
                o.unfinished_claims,
                l.sync_generation,
                l.grant_generation
            )
            SELECT
                claimed.id AS "id?", claimed.link_id AS "link_id?",
                claimed.generation AS "generation?", claimed.payload AS "payload?",
                claimed.attempts AS "attempts?", claimed.unfinished_claims AS "unfinished_claims?",
                claimed.sync_generation AS "sync_generation?", claimed.grant_generation AS "grant_generation?",
                (SELECT count(*) FROM deferred) AS "deferred!"
            FROM (VALUES (1)) anchor(value)
            LEFT JOIN claimed ON true
            "#,
            lease_id,
            ids,
        )
        .fetch_one(&mut **tx)
        .await
        .map_err(db_error)?;
        if row.id.is_none() {
            return Ok(if row.deferred > 0 {
                ProjectionClaim::Progress
            } else {
                ProjectionClaim::Idle
            });
        }
        let (
            Some(id),
            Some(link_id),
            Some(generation),
            Some(payload),
            Some(attempts),
            Some(unfinished_claims),
            Some(sync_generation),
            Some(grant_generation),
        ) = (
            row.id,
            row.link_id,
            row.generation,
            row.payload,
            row.attempts,
            row.unfinished_claims,
            row.sync_generation,
            row.grant_generation,
        )
        else {
            return Err(MailboxError::Persistence);
        };
        Ok(ProjectionClaim::Acquired(Box::new(ProjectionLease {
            id,
            lease_id,
            mailbox: MailboxKey {
                link_id,
                sync_generation,
                grant_generation,
            },
            event: serde_json::from_value(payload).map_err(|_| MailboxError::Persistence)?,
            from_current_generation: generation == sync_generation,
            attempts,
            unfinished_claims,
        })))
    }

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
            .map_err(wrapped_db_error)?
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
