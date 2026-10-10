//! Postgres storage for Focus classifications and the thread reads behind them.

use std::{collections::HashMap, str::FromStr};

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::focus::{
    FocusCategory, FocusInbox, FocusMail, FocusMessage, FocusRecord, FocusStore, SentNote,
    StaleThread, ThreadFocus,
};

/// Most recent messages read per thread.
const THREAD_MESSAGES: i64 = 200;
/// Characters of each message body read.
const BODY_CHARS: i32 = 6_000;
/// The owner's sent messages read when judging the relationship.
const SENT_NOTES: i64 = 100;
/// Characters of each sent message read.
const SENT_NOTE_CHARS: i32 = 2_000;

/// Focus storage on the Macro database.
#[derive(Clone)]
pub struct FocusPgRepository(pub PgPool);

impl FocusPgRepository {
    async fn messages(&self, thread_id: Uuid) -> Result<Vec<FocusMessage>, Report> {
        let rows = sqlx::query!(
            r#"
            SELECT
                m.id,
                COALESCE(m.internal_date_ts, m.created_at) AS "at!",
                m.is_sent,
                m.has_attachments,
                m.subject,
                m.snippet,
                LEFT(m.body_text, $2) AS body,
                c.email_address AS "from_email?",
                COALESCE(m.from_name, c.name) AS from_name,
                COALESCE((
                    SELECT array_agg(rc.email_address ORDER BY rc.email_address)
                    FROM email_message_recipients r
                    JOIN email_contacts rc ON rc.id = r.contact_id
                    WHERE r.message_id = m.id AND r.recipient_type = 'TO'
                ), '{}') AS "to_emails!",
                COALESCE((
                    SELECT array_agg(rc.email_address ORDER BY rc.email_address)
                    FROM email_message_recipients r
                    JOIN email_contacts rc ON rc.id = r.contact_id
                    WHERE r.message_id = m.id AND r.recipient_type = 'CC'
                ), '{}') AS "cc_emails!",
                EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(
                        CASE WHEN jsonb_typeof(m.headers_jsonb) = 'array'
                             THEN m.headers_jsonb ELSE '[]'::jsonb END
                    ) h
                    WHERE LOWER(h->>'name') IN (
                            'list-unsubscribe', 'list-id', 'feedback-id', 'x-sg-eid',
                            'x-ses-outgoing', 'x-mailgun-tag', 'x-campaign'
                        )
                       OR (LOWER(h->>'name') = 'precedence'
                           AND LOWER(h->>'value') IN ('bulk', 'list', 'junk'))
                ) AS "bulk!"
            FROM email_messages m
            LEFT JOIN email_contacts c ON c.id = m.from_contact_id
            WHERE m.thread_id = $1
              AND NOT m.is_draft
              AND NOT EXISTS (
                  SELECT 1 FROM email_message_labels ml
                  JOIN email_labels l ON l.id = ml.label_id
                  WHERE ml.message_id = m.id AND l.name = 'TRASH'
              )
            ORDER BY COALESCE(m.internal_date_ts, m.created_at) DESC, m.id DESC
            LIMIT $3
            "#,
            thread_id,
            BODY_CHARS,
            THREAD_MESSAGES,
        )
        .fetch_all(&self.0)
        .await?;
        let mut messages = rows
            .into_iter()
            .map(|row| FocusMessage {
                id: row.id,
                at: row.at,
                is_sent: row.is_sent,
                from_email: row.from_email,
                from_name: row.from_name,
                to: row.to_emails,
                cc: row.cc_emails,
                subject: row.subject,
                has_attachments: row.has_attachments,
                bulk: row.bulk,
                body: row.body,
                snippet: row.snippet,
            })
            .collect::<Vec<_>>();
        messages.reverse();
        Ok(messages)
    }

    async fn sent_notes(
        &self,
        link_id: Uuid,
        recipients: &[String],
    ) -> Result<Vec<SentNote>, Report> {
        if recipients.is_empty() {
            return Ok(Vec::new());
        }
        // Pick the newest messages first and read bodies only for those: a
        // close correspondent can have thousands of messages.
        let rows = sqlx::query!(
            r#"
            SELECT newest.recipient AS "recipient!", LEFT(m.body_text, $3) AS body
            FROM (
                SELECT LOWER(rc.email_address) AS recipient, m.id, m.internal_date_ts
                FROM email_contacts rc
                JOIN email_message_recipients r ON r.contact_id = rc.id
                JOIN email_messages m ON m.id = r.message_id
                WHERE rc.link_id = $1
                  AND LOWER(rc.email_address) = ANY($2)
                  AND m.is_sent
                  AND NOT m.is_draft
                ORDER BY m.internal_date_ts DESC NULLS LAST
                LIMIT $4
            ) newest
            JOIN email_messages m ON m.id = newest.id
            ORDER BY newest.internal_date_ts DESC NULLS LAST
            "#,
            link_id,
            recipients,
            SENT_NOTE_CHARS,
            SENT_NOTES,
        )
        .fetch_all(&self.0)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| SentNote {
                recipient: row.recipient,
                body: row.body,
            })
            .collect())
    }
}

impl FocusStore for FocusPgRepository {
    #[tracing::instrument(skip(self), err)]
    async fn thread_inbox(&self, thread_id: Uuid) -> Result<Option<FocusInbox>, Report> {
        let Some(row) = sqlx::query!(
            r#"
            SELECT t.id, t.link_id, t.is_signal, t.inbox_visible, el.macro_id, el.email_address,
                   f.classified_message_id AS "classified_message_id?"
            FROM email_threads t
            JOIN email_links el ON el.id = t.link_id
            LEFT JOIN email_thread_focus f ON f.thread_id = t.id
            WHERE t.id = $1
            "#,
            thread_id,
        )
        .fetch_optional(&self.0)
        .await?
        else {
            return Ok(None);
        };
        Ok(Some(FocusInbox {
            thread_id: row.id,
            link_id: row.link_id,
            owner: MacroUserIdStr::try_from(row.macro_id)?,
            owner_email: row.email_address.to_lowercase(),
            is_signal: row.is_signal,
            inbox_visible: row.inbox_visible,
            classified_message_id: row.classified_message_id,
        }))
    }

    #[tracing::instrument(skip(self, inbox), fields(thread_id = %inbox.thread_id), err)]
    async fn thread_mail(&self, inbox: &FocusInbox) -> Result<FocusMail, Report> {
        let messages = self.messages(inbox.thread_id).await?;
        let mut senders = messages
            .iter()
            .filter(|message| !message.is_sent)
            .filter_map(|message| message.from_email.as_deref())
            .map(str::to_lowercase)
            .filter(|sender| *sender != inbox.owner_email)
            .collect::<Vec<_>>();
        senders.sort_unstable();
        senders.dedup();
        let sent_notes = self.sent_notes(inbox.link_id, &senders).await?;
        Ok(FocusMail {
            messages,
            sent_notes,
        })
    }

    #[tracing::instrument(skip(self, record), fields(thread_id = %record.thread_id), err)]
    async fn save(&self, record: &FocusRecord) -> Result<bool, Report> {
        let scores = serde_json::to_value(record.answers)?;
        // A slower classification of an older message never replaces a newer one.
        let result = sqlx::query!(
            r#"
            INSERT INTO email_thread_focus (
                thread_id, link_id, classified_message_id, classified_message_ts, is_focus,
                category, importance, needs_reply, needs_follow_up, scores, model, classified_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (thread_id) DO UPDATE SET
                link_id = EXCLUDED.link_id,
                classified_message_id = EXCLUDED.classified_message_id,
                classified_message_ts = EXCLUDED.classified_message_ts,
                is_focus = EXCLUDED.is_focus,
                category = EXCLUDED.category,
                importance = EXCLUDED.importance,
                needs_reply = EXCLUDED.needs_reply,
                needs_follow_up = EXCLUDED.needs_follow_up,
                scores = EXCLUDED.scores,
                model = EXCLUDED.model,
                classified_at = EXCLUDED.classified_at
            WHERE email_thread_focus.classified_message_ts <= EXCLUDED.classified_message_ts
            "#,
            record.thread_id,
            record.link_id,
            record.classified_message_id,
            record.classified_message_ts,
            record.verdict.is_focus,
            record.verdict.category.to_string(),
            i16::from(record.verdict.importance),
            record.verdict.needs_reply,
            record.verdict.needs_follow_up,
            scores,
            record.model,
            record.classified_at,
        )
        .execute(&self.0)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    #[tracing::instrument(skip(self), err)]
    async fn stale_threads(
        &self,
        since: DateTime<Utc>,
        domains: &[String],
        limit: i64,
    ) -> Result<Vec<StaleThread>, Report> {
        let rows = sqlx::query!(
            r#"
            SELECT t.id,
                   GREATEST(t.latest_inbound_message_ts, t.latest_outbound_message_ts)
                       AS "latest_at!"
            FROM email_links el
            JOIN email_threads t ON t.link_id = el.id
            LEFT JOIN email_thread_focus f ON f.thread_id = t.id
            WHERE LOWER(SPLIT_PART(el.email_address, '@', 2)) = ANY($2)
              AND t.inbox_visible
              AND t.is_signal
              AND t.latest_inbound_message_ts IS NOT NULL
              AND t.latest_inbound_message_ts >= $1
              AND (
                  f.thread_id IS NULL
                  OR f.classified_message_ts
                     < GREATEST(t.latest_inbound_message_ts, t.latest_outbound_message_ts)
              )
            ORDER BY t.latest_inbound_message_ts DESC
            LIMIT $3
            "#,
            since,
            domains,
            limit,
        )
        .fetch_all(&self.0)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| StaleThread {
                thread_id: row.id,
                latest_at: row.latest_at,
            })
            .collect())
    }

    #[tracing::instrument(skip(self), err)]
    async fn focus_thread_ids(
        &self,
        owner: &MacroUserIdStr<'static>,
        since: DateTime<Utc>,
        limit: i64,
    ) -> Result<Vec<Uuid>, Report> {
        Ok(sqlx::query_scalar!(
            r#"
            SELECT f.thread_id
            FROM email_thread_focus f
            JOIN email_threads t ON t.id = f.thread_id
            WHERE f.link_id IN (
                    -- The owner's inboxes, as Soup lists them: their own and linked ones.
                    SELECT el.id FROM email_links el WHERE el.macro_id = $1
                    UNION
                    SELECT mul.link_id FROM macro_user_links mul WHERE mul.primary_macro_id = $1
                )
              AND f.is_focus
              AND t.inbox_visible
              AND t.is_signal
              AND t.latest_inbound_message_ts >= $2
            ORDER BY f.importance DESC, t.latest_inbound_message_ts DESC, f.thread_id
            LIMIT $3
            "#,
            owner.as_ref(),
            since,
            limit,
        )
        .fetch_all(&self.0)
        .await?)
    }

    #[tracing::instrument(skip(self, thread_ids), fields(threads = thread_ids.len()), err)]
    async fn focus_for_threads(
        &self,
        owner: &MacroUserIdStr<'static>,
        thread_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, ThreadFocus>, Report> {
        let rows = sqlx::query!(
            r#"
            SELECT f.thread_id, f.is_focus, f.category, f.importance, f.needs_reply,
                   f.needs_follow_up, f.classified_at
            FROM email_thread_focus f
            WHERE f.thread_id = ANY($1)
              AND f.link_id IN (
                  SELECT el.id FROM email_links el WHERE el.macro_id = $2
                  UNION
                  SELECT mul.link_id FROM macro_user_links mul WHERE mul.primary_macro_id = $2
              )
            "#,
            thread_ids,
            owner.as_ref(),
        )
        .fetch_all(&self.0)
        .await?;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let category = FocusCategory::from_str(&row.category)
                    .inspect_err(|_| {
                        tracing::warn!(thread_id = %row.thread_id, "unknown focus category stored");
                    })
                    .ok()?;
                Some((
                    row.thread_id,
                    ThreadFocus {
                        is_focus: row.is_focus,
                        category,
                        importance: u8::try_from(row.importance.clamp(0, 100)).unwrap_or(0),
                        needs_reply: row.needs_reply,
                        needs_follow_up: row.needs_follow_up,
                        classified_at: row.classified_at,
                    },
                ))
            })
            .collect())
    }
}

#[cfg(test)]
mod test;
