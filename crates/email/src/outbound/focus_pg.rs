//! Postgres storage for Focus classifications and the thread reads behind them.

use std::{collections::HashMap, str::FromStr};

use chrono::{DateTime, Duration, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    domain::focus::{
        CalendarPart, FOCUS_RULE_VERSION, FocusAnswers, FocusCategory, FocusInbox, FocusMail,
        FocusMessage, FocusRecord, FocusStore, ImportanceTrend, RECENT_CONTACT_DAYS, SentNote,
        StaleThread, StoredClassification, ThreadFocus, change_subject_pattern, importance_at,
    },
    outbound::invitation_pg,
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
                ) AS "bulk!",
                EXISTS (
                    SELECT 1 FROM email_message_calendar_invites i
                    WHERE i.message_id = m.id
                ) OR EXISTS (
                    SELECT 1 FROM email_attachments a
                    WHERE a.message_id = m.id
                      AND (a.filename ILIKE '%.ics'
                           OR a.mime_type IN ('text/calendar', 'application/ics'))
                ) AS "has_calendar!",
                (
                    SELECT h->>'value'
                    FROM jsonb_array_elements(
                        CASE WHEN jsonb_typeof(m.headers_jsonb) = 'array'
                             THEN m.headers_jsonb ELSE '[]'::jsonb END
                    ) h
                    WHERE LOWER(h->>'name') = 'date'
                    LIMIT 1
                ) AS date_header
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
        let with_calendar = rows
            .iter()
            .filter(|row| row.has_calendar)
            .map(|row| row.id)
            .collect::<Vec<_>>();
        let invites = if with_calendar.is_empty() {
            HashMap::new()
        } else {
            invitation_pg::load(&self.0, &with_calendar).await?
        };
        let mut messages = rows
            .into_iter()
            .map(|row| {
                // A calendar file or snapshot nothing could read still is one.
                let calendar_part = row.has_calendar.then(|| {
                    invites
                        .get(&row.id)
                        .and_then(|invites| CalendarPart::from_saved(invites, row.at))
                        .unwrap_or(CalendarPart::Unparsed)
                });
                FocusMessage {
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
                    calendar_part,
                    body: row.body,
                    snippet: row.snippet,
                    date_header: row.date_header,
                }
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
            SELECT newest.recipient AS "recipient!",
                   COALESCE(newest.internal_date_ts, m.created_at) AS "at!",
                   LEFT(m.body_text, $3) AS body
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
                at: row.at,
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
                   f.classified_message_id AS "classified_message_id?",
                   f.rule_version AS "rule_version?",
                   f.scores AS "scores?",
                   f.model AS "model?",
                   f.due_on AS "due_on?"
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
        let classified = match (
            row.classified_message_id,
            row.rule_version,
            row.scores,
            row.model,
        ) {
            (Some(message_id), Some(rule_version), Some(scores), Some(model)) => {
                // Answers that no longer decode just go back to the classifier.
                let answers = serde_json::from_value::<FocusAnswers>(scores)
                    .inspect_err(|_| {
                        tracing::warn!(thread_id = %row.id, "undecodable focus answers stored");
                    })
                    .ok();
                Some(StoredClassification {
                    message_id,
                    rule_version,
                    answers,
                    model,
                    due_on: row.due_on,
                })
            }
            _ => None,
        };
        Ok(Some(FocusInbox {
            thread_id: row.id,
            link_id: row.link_id,
            owner: MacroUserIdStr::try_from(row.macro_id)?,
            owner_email: row.email_address.to_lowercase(),
            is_signal: row.is_signal,
            inbox_visible: row.inbox_visible,
            classified,
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
                category, importance, needs_reply, needs_follow_up, scores, model, classified_at,
                rule_version, pinned, awaiting_reply, calendar_hold_until, importance_rate, due_on
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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
                classified_at = EXCLUDED.classified_at,
                rule_version = EXCLUDED.rule_version,
                pinned = EXCLUDED.pinned,
                awaiting_reply = EXCLUDED.awaiting_reply,
                calendar_hold_until = EXCLUDED.calendar_hold_until,
                importance_rate = EXCLUDED.importance_rate,
                due_on = EXCLUDED.due_on
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
            FOCUS_RULE_VERSION,
            record.verdict.pinned,
            record.verdict.awaiting_reply,
            record.verdict.calendar_hold_until,
            i16::from(record.verdict.importance_rate),
            record.due_on,
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
        after: Option<StaleThread>,
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
              AND t.latest_inbound_message_ts IS NOT NULL
              AND GREATEST(t.latest_inbound_message_ts, t.latest_outbound_message_ts) >= $1
              AND (
                  t.is_signal
                  OR t.latest_outbound_message_ts > t.latest_inbound_message_ts
                  OR f.rule_version < $4
                  -- A calendar change. The service judges whether it is the
                  -- latest message and its event isn't over; a new invite or an
                  -- RSVP never gets this far.
                  OR EXISTS (
                      SELECT 1
                      FROM email_messages notice
                      WHERE notice.thread_id = t.id
                        AND NOT notice.is_sent
                        AND NOT notice.is_draft
                        AND (
                            LOWER(notice.subject) ~ $6
                            OR EXISTS (
                                SELECT 1 FROM email_message_calendar_invites i
                                WHERE i.message_id = notice.id
                                  AND (
                                      i.snapshot->>'method' IN ('cancel', 'counter')
                                      OR (
                                          i.snapshot->>'method' = 'request'
                                          AND i.snapshot->'sequence' > '0'::jsonb
                                      )
                                  )
                            )
                        )
                  )
                  -- A sender the owner has written to lately. The service judges
                  -- whether it really is a recent contact; mail no event covers,
                  -- such as an initial sync, only arrives this way.
                  OR EXISTS (
                      SELECT 1
                      FROM email_messages inbound
                      JOIN email_message_recipients r ON r.contact_id = inbound.from_contact_id
                      JOIN email_messages sent ON sent.id = r.message_id
                      WHERE inbound.thread_id = t.id
                        AND NOT inbound.is_sent
                        AND NOT inbound.is_draft
                        AND sent.is_sent
                        AND NOT sent.is_draft
                        AND sent.internal_date_ts >= $5
                  )
              )
              AND (
                  f.thread_id IS NULL
                  OR f.rule_version < $4
                  OR f.classified_message_ts
                     < GREATEST(t.latest_inbound_message_ts, t.latest_outbound_message_ts)
              )
              AND (
                  $7::timestamptz IS NULL
                  OR (GREATEST(t.latest_inbound_message_ts, t.latest_outbound_message_ts), t.id)
                     < ($7, $8::uuid)
              )
            ORDER BY GREATEST(t.latest_inbound_message_ts, t.latest_outbound_message_ts) DESC, t.id DESC
            LIMIT $3
            "#,
            since,
            domains,
            limit,
            FOCUS_RULE_VERSION,
            since - Duration::days(RECENT_CONTACT_DAYS),
            change_subject_pattern(),
            after.map(|after| after.latest_at),
            after.map(|after| after.thread_id),
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

    #[tracing::instrument(skip(self), fields(threads = tracing::field::Empty), err)]
    async fn focus_thread_ids(
        &self,
        owner: &MacroUserIdStr<'static>,
        since: DateTime<Utc>,
        waiting_before: DateTime<Utc>,
        now: DateTime<Utc>,
        limit: i64,
    ) -> Result<Vec<Uuid>, Report> {
        // The waiting and calendar hold tests here restate `focus_for_threads`;
        // change both together.
        let thread_ids = sqlx::query_scalar!(
            r#"
            SELECT f.thread_id
            FROM email_thread_focus f
            JOIN email_threads t ON t.id = f.thread_id AND t.link_id = f.link_id
            -- Who wrote last comes from the mail itself: editing a draft moves
            -- the thread's own timestamps. An indexed per-thread top-one probe.
            CROSS JOIN LATERAL (
                SELECT COALESCE(m.internal_date_ts, m.created_at) AS at, m.is_sent
                FROM email_messages m
                WHERE m.thread_id = t.id
                  AND NOT m.is_draft
                  AND EXISTS (
                      SELECT 1 FROM email_message_mailbox_facts facts
                      WHERE facts.id = m.id AND facts.is_present AND NOT facts.in_trash
                  )
                ORDER BY COALESCE(m.internal_date_ts, m.created_at) DESC, m.id DESC
                LIMIT 1
            ) latest
            WHERE f.link_id IN (
                    -- The owner's inboxes, as Soup lists them: their own and linked ones.
                    SELECT el.id FROM email_links el WHERE el.macro_id = $1
                    UNION
                    SELECT mul.link_id FROM macro_user_links mul WHERE mul.primary_macro_id = $1
                )
              -- Every way in, indexed by email_thread_focus_list_idx and
              -- email_thread_focus_read_time_idx.
              AND (f.is_focus OR f.awaiting_reply OR f.calendar_hold_until IS NOT NULL)
              AND t.inbox_visible
              -- Never earlier than the latest mail, so this spares most probes.
              AND GREATEST(t.latest_inbound_message_ts, t.latest_outbound_message_ts) >= $2
              AND latest.at >= $2
              AND (
                  (f.is_focus AND (t.is_signal OR f.pinned))
                  OR (
                      -- Nothing reclassifies a thread as it ages, so the wait is
                      -- measured here, and a newer reply ends it before the worker
                      -- gets to the thread.
                      f.awaiting_reply
                      AND latest.is_sent
                      AND latest.at <= $3
                  )
                  -- A calendar change holds a thread until its event is over, and
                  -- a newer message ends that before the worker gets to the thread.
                  OR (f.calendar_hold_until > $4 AND latest.at <= f.classified_message_ts)
              )
            -- Newest first, so the limit keeps the newest threads.
            ORDER BY latest.at DESC, f.thread_id
            LIMIT $5
            "#,
            owner.as_ref(),
            since,
            waiting_before,
            now,
            limit,
        )
        .fetch_all(&self.0)
        .await?;
        tracing::Span::current().record("threads", thread_ids.len());
        Ok(thread_ids)
    }

    #[tracing::instrument(
        skip(self, thread_ids),
        fields(
            threads = thread_ids.len(),
            waiting = tracing::field::Empty,
            calendar_held = tracing::field::Empty,
            trending = tracing::field::Empty,
        ),
        err
    )]
    async fn focus_for_threads(
        &self,
        owner: &MacroUserIdStr<'static>,
        thread_ids: &[Uuid],
        waiting_before: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> Result<HashMap<Uuid, ThreadFocus>, Report> {
        // The labels are settled here rather than trusted from the row: who
        // wrote last can move before the worker reaches the thread, rows from an
        // older rule can carry a follow-up on someone else's message, which reads
        // as a reply needed, and a held thread's event can end.
        let rows = sqlx::query!(
            r#"
            SELECT f.thread_id, f.category, f.importance, f.classified_at, f.due_on,
                   now_state.earned OR now_state.waiting OR now_state.calendar_held
                       AS "is_focus!",
                   (now_state.earned OR now_state.calendar_held)
                       AND (f.needs_reply OR f.needs_follow_up)
                       AND NOT now_state.owner_latest
                       AS "needs_reply!",
                   ((now_state.earned OR now_state.calendar_held)
                       AND f.needs_follow_up
                       AND now_state.owner_latest)
                       OR now_state.waiting
                       AS "needs_follow_up!",
                   now_state.waiting AS "waiting!",
                   now_state.calendar_held AS "calendar_held!",
                   f.classified_message_ts,
                   f.importance_rate,
                   now_state.untouched AS "untouched!"
            FROM email_thread_focus f
            JOIN email_threads t ON t.id = f.thread_id AND t.link_id = f.link_id
            LEFT JOIN LATERAL (
                SELECT COALESCE(m.internal_date_ts, m.created_at) AS at, m.is_sent
                FROM email_messages m
                WHERE m.thread_id = t.id
                  AND NOT m.is_draft
                  AND EXISTS (
                      SELECT 1 FROM email_message_mailbox_facts facts
                      WHERE facts.id = m.id AND facts.is_present AND NOT facts.in_trash
                  )
                ORDER BY COALESCE(m.internal_date_ts, m.created_at) DESC, m.id DESC
                LIMIT 1
            ) latest ON TRUE
            CROSS JOIN LATERAL (
                SELECT COALESCE(latest.is_sent, false) AS owner_latest,
                       f.is_focus AND (t.is_signal OR f.pinned) AS earned,
                       f.awaiting_reply
                           AND t.inbox_visible
                           AND COALESCE(latest.is_sent AND latest.at <= $3, false) AS waiting,
                       t.inbox_visible
                           AND COALESCE(
                               f.calendar_hold_until > $4
                                   AND latest.at <= f.classified_message_ts,
                               false
                           ) AS calendar_held,
                       COALESCE(latest.at <= f.classified_message_ts, false) AS untouched
            ) now_state
            WHERE f.thread_id = ANY($1)
              AND f.link_id IN (
                  SELECT el.id FROM email_links el WHERE el.macro_id = $2
                  UNION
                  SELECT mul.link_id FROM macro_user_links mul WHERE mul.primary_macro_id = $2
              )
            "#,
            thread_ids,
            owner.as_ref(),
            waiting_before,
            now,
        )
        .fetch_all(&self.0)
        .await?;
        let span = tracing::Span::current();
        span.record("waiting", rows.iter().filter(|row| row.waiting).count());
        span.record(
            "calendar_held",
            rows.iter().filter(|row| row.calendar_held).count(),
        );
        span.record(
            "trending",
            rows.iter()
                .filter(|row| row.untouched && row.importance_rate != 0)
                .count(),
        );
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                // Calendar in Focus only ever means a change still ahead of its event.
                let category = if row.calendar_held {
                    FocusCategory::Calendar
                } else {
                    FocusCategory::from_str(&row.category)
                        .inspect_err(|_| {
                            tracing::warn!(thread_id = %row.thread_id, "unknown focus category stored");
                        })
                        .ok()?
                };
                // The rate judged the classified message, so newer mail stops it
                // before the worker gets to the thread.
                let rate = if row.untouched {
                    i8::try_from(row.importance_rate).unwrap_or(0)
                } else {
                    0
                };
                let importance = importance_at(
                    u8::try_from(row.importance.clamp(0, 100)).unwrap_or(0),
                    rate,
                    row.classified_message_ts,
                    now,
                );
                Some((
                    row.thread_id,
                    ThreadFocus {
                        is_focus: row.is_focus,
                        category,
                        importance,
                        needs_reply: row.needs_reply,
                        needs_follow_up: row.needs_follow_up,
                        classified_at: row.classified_at,
                        importance_trend: ImportanceTrend::of(rate, importance),
                        due_on: row.due_on,
                    },
                ))
            })
            .collect())
    }
}

#[cfg(test)]
mod test;
