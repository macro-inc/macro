//! Postgres sequence steps, on the caller's connection.

use super::{contact, draft, message, send_attempt, thread};
use crate::domain::{
    models::{
        ContactInfo, EmailErr, ParsedAddresses, ResolvedDraftInput, ScheduledSendSource,
        ScheduledSendStatus, ThreadRow, UpsertedContacts, UserProvider,
    },
    sequence_steps::{
        CancelExpectation, CancelOutcome, InboundMessage, NewStep, PendingStep, ReplySearch,
        SendingInbox, SequenceStepStore, StepState,
    },
};
use chrono::{DateTime, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

/// Sequence steps over the email tables. Holds nothing: every call runs on
/// the connection it is given.
#[derive(Debug, Clone, Copy, Default)]
pub struct PgSequenceSteps;

fn storage(error: impl Into<anyhow::Error>) -> EmailErr {
    EmailErr::RepoErr(error.into())
}

fn schedule_status(
    delivery_status: &str,
    processing: bool,
    claimed: bool,
    started: bool,
) -> ScheduledSendStatus {
    match delivery_status {
        "failed" => ScheduledSendStatus::Failed,
        "unconfirmed" => ScheduledSendStatus::Unconfirmed,
        _ if started || (processing && !claimed) => ScheduledSendStatus::Sending,
        _ => ScheduledSendStatus::Pending,
    }
}

/// `[{name, value}]` headers as pairs; anything else reads as none.
fn header_pairs(headers: Option<serde_json::Value>) -> Vec<(String, String)> {
    let Some(serde_json::Value::Array(entries)) = headers else {
        return Vec::new();
    };
    entries
        .iter()
        .filter_map(|entry| {
            Some((
                entry.get("name")?.as_str()?.to_owned(),
                entry.get("value")?.as_str()?.to_owned(),
            ))
        })
        .collect()
}

impl SequenceStepStore for PgSequenceSteps {
    type Conn = PgConnection;
    type Err = EmailErr;

    async fn sending_inbox(
        &self,
        conn: &mut PgConnection,
        link_id: Uuid,
    ) -> Result<Option<SendingInbox>, EmailErr> {
        let row = sqlx::query!(
            r#"SELECT id, macro_id, email_address, provider AS "provider: String",
                      (deleting_at IS NULL AND disconnect_requested_at IS NULL
                       AND is_sync_active AND NOT needs_reauth) AS "healthy!"
               FROM email_links WHERE id = $1"#,
            link_id,
        )
        .fetch_optional(&mut *conn)
        .await
        .map_err(storage)?;
        row.map(|row| {
            Ok(SendingInbox {
                link_id: row.id,
                macro_id: row.macro_id,
                email_address: row.email_address,
                provider: match row.provider.as_str() {
                    "GMAIL" => UserProvider::Gmail,
                    "OUTLOOK" => UserProvider::Outlook,
                    other => return Err(storage(anyhow::anyhow!("unknown provider {other}"))),
                },
                healthy: row.healthy,
            })
        })
        .transpose()
    }

    async fn upsert_contacts(
        &self,
        conn: &mut PgConnection,
        link_id: Uuid,
        from: &ContactInfo,
        to: &ContactInfo,
    ) -> Result<UpsertedContacts, EmailErr> {
        contact::upsert_contacts(
            conn,
            link_id,
            ParsedAddresses {
                from_email: from.email.clone(),
                from_name: from.name.clone(),
                to: vec![to.clone()],
                cc: vec![],
                bcc: vec![],
            },
        )
        .await
        .map_err(storage)
    }

    #[tracing::instrument(skip_all, fields(link_id = %step.link_id, reply = step.reply_to.is_some()), err)]
    async fn create_step(
        &self,
        conn: &mut PgConnection,
        step: &NewStep<'_>,
    ) -> Result<Uuid, EmailErr> {
        if step.send_time <= Utc::now() {
            return Err(EmailErr::InvalidScheduleTime);
        }
        let message_id = macro_uuid::generate_uuid_v7();
        let (thread_id, provider_thread_id) = match step.reply_to {
            Some(parent) => {
                let parent_row = sqlx::query!(
                    "SELECT thread_id, provider_thread_id FROM email_messages WHERE id = $1 AND link_id = $2 AND is_sent",
                    parent,
                    step.link_id,
                )
                .fetch_optional(&mut *conn)
                .await
                .map_err(storage)?
                .ok_or(EmailErr::MessageNotFound(parent))?;
                // Thread rows after the provider-thread lock, as sync and completion take them.
                if let Some(provider_thread_id) = parent_row.provider_thread_id.as_deref() {
                    email_db_client::threads::provider_identity::lock_provider_thread(
                        conn,
                        step.link_id,
                        provider_thread_id,
                    )
                    .await
                    .map_err(EmailErr::RepoErr)?;
                }
                (parent_row.thread_id, parent_row.provider_thread_id)
            }
            None => {
                let now = Utc::now();
                let thread = ThreadRow {
                    db_id: macro_uuid::generate_uuid_v7(),
                    provider_id: None,
                    link_id: step.link_id,
                    inbox_visible: false,
                    is_read: true,
                    has_received_mail: false,
                    latest_inbound_message_ts: None,
                    latest_outbound_message_ts: None,
                    latest_non_spam_message_ts: None,
                    created_at: now,
                    updated_at: now,
                    project_id: None,
                };
                thread::insert_thread(conn, &thread, step.link_id)
                    .await
                    .map_err(storage)?;
                (thread.db_id, None)
            }
        };
        let input = ResolvedDraftInput {
            draft_generation: 0,
            db_id: message_id,
            provider_id: None,
            replying_to_id: step.reply_to,
            provider_thread_id,
            thread_db_id: thread_id,
            subject: step.subject.to_owned(),
            to: vec![step.to.clone()],
            cc: vec![],
            bcc: vec![],
            body_text: Some(step.body_text.to_owned()),
            body_html: None,
            body_macro: None,
            headers_json: step
                .reply_to
                .map(|parent| serde_json::json!([{ "Macro-In-Reply-To": parent.to_string() }])),
            send_time: Some(step.send_time),
            actor_id: Some(step.actor.to_owned()),
            draft_client_id: None,
            thread_client_id: None,
        };
        let inserted = draft::upsert_draft(
            conn,
            &input,
            message_id,
            thread_id,
            step.contacts.from_contact_id,
            step.link_id,
            true,
        )
        .await
        .map_err(storage)?;
        if !inserted {
            return Err(EmailErr::MessageDeliveryConflict(message_id));
        }
        message::upsert_recipients(conn, message_id, step.contacts)
            .await
            .map_err(storage)?;
        let source: &'static str = ScheduledSendSource::Sequence.into();
        sqlx::query!(
            r#"INSERT INTO email_scheduled_messages
                (link_id, message_id, send_time, sent, processing, actor_id, source, list_unsubscribe_url)
               VALUES ($1, $2, $3, false, false, $4, $5, $6)"#,
            step.link_id,
            message_id,
            step.send_time,
            step.actor,
            source,
            step.list_unsubscribe_url,
        )
        .execute(&mut *conn)
        .await
        .map_err(storage)?;
        email_db_client::threads::update::recompute_thread_metadata(conn, thread_id, step.link_id)
            .await
            .map_err(storage)?;
        Ok(message_id)
    }

    #[tracing::instrument(skip(self, conn), err)]
    async fn cancel_step(
        &self,
        conn: &mut PgConnection,
        message_id: Uuid,
        expect: CancelExpectation,
    ) -> Result<CancelOutcome, EmailErr> {
        let Some(found) = sqlx::query!(
            "SELECT link_id, provider_thread_id FROM email_messages WHERE id = $1",
            message_id,
        )
        .fetch_optional(&mut *conn)
        .await
        .map_err(storage)?
        else {
            return Ok(CancelOutcome::Gone);
        };
        // Lock order: provider thread, message, schedule, thread rows.
        if let Some(provider_thread_id) = found.provider_thread_id.as_deref() {
            email_db_client::threads::provider_identity::lock_provider_thread(
                conn,
                found.link_id,
                provider_thread_id,
            )
            .await
            .map_err(EmailErr::RepoErr)?;
        }
        let Some(locked) = sqlx::query!(
            "SELECT link_id, thread_id, is_sent FROM email_messages WHERE id = $1 FOR UPDATE",
            message_id,
        )
        .fetch_optional(&mut *conn)
        .await
        .map_err(storage)?
        else {
            return Ok(CancelOutcome::Gone);
        };
        if locked.is_sent {
            return Ok(CancelOutcome::Sent);
        }
        let schedule = sqlx::query!(
            r#"SELECT sent, processing, delivery_status, delivery_started_at, delivery_claim_id, source
               FROM email_scheduled_messages WHERE message_id = $1 AND link_id = $2 FOR UPDATE"#,
            message_id,
            locked.link_id,
        )
        .fetch_optional(&mut *conn)
        .await
        .map_err(storage)?;
        if schedule.is_none() && expect == CancelExpectation::Scheduled {
            return Ok(CancelOutcome::Changed);
        }
        if let Some(schedule) = schedule {
            if schedule.sent {
                return Ok(CancelOutcome::Sent);
            }
            // The owner scheduled or sent it from Mail: it is theirs.
            if schedule.source.is_none() {
                return Ok(CancelOutcome::Changed);
            }
            // The rule `change_schedule` applies: a submitted or uncertain
            // delivery can't be withdrawn; a failed one can.
            match schedule_status(
                &schedule.delivery_status,
                schedule.processing,
                schedule.delivery_claim_id.is_some(),
                schedule.delivery_started_at.is_some(),
            ) {
                ScheduledSendStatus::Sending | ScheduledSendStatus::Unconfirmed => {
                    return Ok(CancelOutcome::DeliveryStarted);
                }
                ScheduledSendStatus::Pending | ScheduledSendStatus::Failed => {}
            }
            sqlx::query!(
                "DELETE FROM email_scheduled_messages WHERE message_id = $1 AND link_id = $2",
                message_id,
                locked.link_id,
            )
            .execute(&mut *conn)
            .await
            .map_err(storage)?;
            send_attempt::cancel_revoked_attempts(conn, &[message_id], locked.link_id)
                .await
                .map_err(storage)?;
        }
        sqlx::query!("DELETE FROM email_messages WHERE id = $1", message_id)
            .execute(&mut *conn)
            .await
            .map_err(storage)?;
        if !email_db_client::threads::delete::delete_thread_if_empty(conn, locked.thread_id)
            .await
            .map_err(EmailErr::RepoErr)?
        {
            email_db_client::threads::update::recompute_thread_metadata(
                conn,
                locked.thread_id,
                locked.link_id,
            )
            .await
            .map_err(storage)?;
        }
        Ok(CancelOutcome::Cancelled)
    }

    async fn step_state(
        &self,
        conn: &mut PgConnection,
        message_id: Uuid,
    ) -> Result<StepState, EmailErr> {
        let Some(row) = sqlx::query!(
            r#"SELECT m.is_sent, m.internal_date_ts, m.updated_at, m.global_id,
                      s.message_id AS "scheduled?", s.send_time AS "send_time?", s.source,
                      s.processing AS "processing?", s.delivery_status AS "delivery_status?",
                      s.delivery_started_at, s.delivery_claim_id, s.delivery_message_id,
                      (COALESCE((m.mailbox_state->>'provider_missing')::boolean, false)
                       OR EXISTS (SELECT 1 FROM email_message_mailbox_facts mf
                                  WHERE mf.id = m.id AND mf.in_trash)) AS "discarded!"
               FROM email_messages m
               LEFT JOIN email_scheduled_messages s ON s.message_id = m.id AND s.link_id = m.link_id
               WHERE m.id = $1"#,
            message_id,
        )
        .fetch_optional(&mut *conn)
        .await
        .map_err(storage)?
        else {
            return Ok(StepState::Gone);
        };
        if row.is_sent {
            return Ok(StepState::Sent {
                sent_at: row.internal_date_ts.unwrap_or(row.updated_at),
                submitted_at: row.delivery_started_at,
                delivery_message_id: row.delivery_message_id,
                global_id: row.global_id,
            });
        }
        Ok(match (row.scheduled, row.send_time, row.delivery_status) {
            (Some(_), Some(send_time), Some(delivery_status)) if row.source.is_some() => {
                StepState::Scheduled {
                    send_time,
                    status: schedule_status(
                        &delivery_status,
                        row.processing.unwrap_or_default(),
                        row.delivery_claim_id.is_some(),
                        row.delivery_started_at.is_some(),
                    ),
                }
            }
            (Some(_), _, _) => StepState::TakenOver,
            (None, _, _) if row.discarded => StepState::Discarded,
            (None, _, _) => StepState::TakenOver,
        })
    }

    async fn is_sent_in(
        &self,
        conn: &mut PgConnection,
        link_id: Uuid,
        message_id: Uuid,
    ) -> Result<bool, EmailErr> {
        sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM email_messages WHERE id = $1 AND link_id = $2 AND is_sent) AS "sent!""#,
            message_id,
            link_id,
        )
        .fetch_one(&mut *conn)
        .await
        .map_err(storage)
    }

    async fn lock_send_slot(
        &self,
        conn: &mut PgConnection,
        link_id: Uuid,
    ) -> Result<Option<DateTime<Utc>>, EmailErr> {
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            format!("email_sequence_send_slot:{link_id}"),
        )
        .execute(&mut *conn)
        .await
        .map_err(storage)?;
        sqlx::query_scalar!(
            r#"SELECT max(send_time) FROM email_scheduled_messages
               WHERE link_id = $1 AND source IS NOT NULL AND NOT sent"#,
            link_id,
        )
        .fetch_one(&mut *conn)
        .await
        .map_err(storage)
    }

    async fn inbound_message(
        &self,
        conn: &mut PgConnection,
        link_id: Uuid,
        message_id: Uuid,
    ) -> Result<Option<InboundMessage>, EmailErr> {
        let row = sqlx::query!(
            r#"SELECT m.id, m.internal_date_ts, m.replying_to_id, m.headers_jsonb, m.body_text,
                      lower(c.email_address) AS "from_email?"
               FROM email_messages m LEFT JOIN email_contacts c ON c.id = m.from_contact_id
               WHERE m.id = $1 AND m.link_id = $2 AND NOT m.is_sent AND NOT m.is_draft"#,
            message_id,
            link_id,
        )
        .fetch_optional(&mut *conn)
        .await
        .map_err(storage)?;
        Ok(row.map(|row| InboundMessage {
            id: row.id,
            received_at: row.internal_date_ts,
            from: row.from_email,
            replying_to_id: row.replying_to_id,
            headers: header_pairs(row.headers_jsonb),
            body_text: row.body_text,
        }))
    }

    async fn resolve_references(
        &self,
        conn: &mut PgConnection,
        link_id: Uuid,
        references: &[String],
    ) -> Result<Vec<Uuid>, EmailErr> {
        if references.is_empty() {
            return Ok(Vec::new());
        }
        // Stored Message-IDs keep their angle brackets; minted ones have none.
        let bracketed: Vec<String> = references.iter().map(|id| format!("<{id}>")).collect();
        sqlx::query_scalar!(
            r#"SELECT id AS "id!" FROM email_messages
               WHERE link_id = $1 AND (global_id = ANY($2) OR global_id = ANY($3))
               UNION
               SELECT message_id FROM email_scheduled_messages
               WHERE link_id = $1 AND delivery_message_id = ANY($3)"#,
            link_id,
            &bracketed,
            references,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(storage)
    }

    async fn replies_since(
        &self,
        conn: &mut PgConnection,
        search: ReplySearch<'_>,
    ) -> Result<Vec<InboundMessage>, EmailErr> {
        // Bounded: the first answer stops the enrollment.
        const MAX_CANDIDATES: i64 = 200;
        // One indexed branch per way a message can answer the steps: from the
        // contact, from the mail system (a bounce in a thread of its own), a
        // reply to a step, or anything in a step's thread. Only bounces carry
        // their text, which can name the failed address.
        let rows = sqlx::query!(
            r#"WITH candidates AS (
                   SELECT m.id FROM email_contacts c JOIN email_messages m ON m.from_contact_id = c.id
                   WHERE c.link_id = $1 AND lower(c.email_address) = $2 AND m.internal_date_ts > $4
                   UNION
                   -- `email_contacts_mail_system_idx`
                   SELECT m.id FROM email_contacts c JOIN email_messages m ON m.from_contact_id = c.id
                   WHERE c.link_id = $1 AND m.internal_date_ts > $4
                     AND split_part(lower(c.email_address::text), '@', 1) IN ('mailer-daemon', 'postmaster')
                   UNION
                   SELECT id FROM email_messages
                   WHERE link_id = $1 AND replying_to_id = ANY($3) AND internal_date_ts > $4
                   UNION
                   SELECT t.id FROM email_messages s
                   JOIN email_messages t ON t.link_id = s.link_id AND t.thread_id = s.thread_id
                   WHERE s.id = ANY($3) AND s.link_id = $1 AND t.internal_date_ts > $4
               )
               SELECT m.id, m.internal_date_ts, m.replying_to_id, m.headers_jsonb,
                      lower(c.email_address) AS "from_email?",
                      CASE WHEN split_part(lower(c.email_address), '@', 1) IN ('mailer-daemon', 'postmaster')
                           THEN m.body_text END AS "body_text?"
               FROM candidates JOIN email_messages m ON m.id = candidates.id
               LEFT JOIN email_contacts c ON c.id = m.from_contact_id
               WHERE NOT m.is_sent AND NOT m.is_draft
               ORDER BY m.internal_date_ts
               LIMIT $5"#,
            search.link_id,
            search.email,
            search.step_message_ids,
            search.since,
            MAX_CANDIDATES,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(storage)?;
        Ok(rows
            .into_iter()
            .map(|row| InboundMessage {
                id: row.id,
                received_at: row.internal_date_ts,
                from: row.from_email,
                replying_to_id: row.replying_to_id,
                headers: header_pairs(row.headers_jsonb),
                body_text: row.body_text,
            })
            .collect())
    }

    async fn pending_steps(
        &self,
        conn: &mut PgConnection,
        after: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<PendingStep>, EmailErr> {
        let rows = sqlx::query!(
            r#"SELECT link_id, message_id FROM email_scheduled_messages
               WHERE source IS NOT NULL AND NOT sent
                 -- What trash may withdraw (`delete_scheduled_messages_batch`).
                 AND (delivery_status = 'failed' OR
                      (delivery_started_at IS NULL AND delivery_status <> 'unconfirmed'
                       AND (NOT processing OR delivery_claim_id IS NOT NULL)))
                 AND ($1::uuid IS NULL OR message_id > $1)
               ORDER BY message_id LIMIT $2"#,
            after,
            limit,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(storage)?;
        Ok(rows
            .into_iter()
            .map(|row| PendingStep {
                link_id: row.link_id,
                message_id: row.message_id,
            })
            .collect())
    }
}
