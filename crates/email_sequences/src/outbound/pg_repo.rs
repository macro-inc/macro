//! Postgres persistence for sequences.

#[cfg(test)]
mod test;

use chrono::{DateTime, NaiveTime, Utc};
use sqlx::{PgConnection, PgPool, Postgres, Transaction, types::Json};
use uuid::Uuid;

use crate::domain::{
    models::{
        ContactEnrollment, EnrollmentCounts, EnrollmentDetail, EnrollmentReason, EnrollmentRow,
        EnrollmentStep, EnrollmentSummary, HistoryRow, Owner, SendClock, Sequence, SequenceStatus,
        SequenceSummary, Step, StepStatus, UnsubscribeToken,
    },
    ports::{
        DueEnrollment, NewEnrollment, NewSequence, RecipientState, ReplyCandidates, SentStep,
        SequenceRepo,
    },
};

/// Sequences over MacroDB.
#[derive(Debug, Clone)]
pub struct PgSequenceRepo {
    pool: PgPool,
}

impl PgSequenceRepo {
    /// Wrap a pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// A database failure, or a stored value this code can't read.
#[derive(Debug, thiserror::Error)]
pub enum PgSequenceError {
    /// The query failed.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    /// A stored value is out of range.
    #[error("unreadable stored value: {0}")]
    Decode(&'static str),
}

fn parse<T: std::str::FromStr>(value: &str, what: &'static str) -> Result<T, PgSequenceError> {
    value.parse().map_err(|_| PgSequenceError::Decode(what))
}

fn parse_reason(value: Option<&str>) -> Result<Option<EnrollmentReason>, PgSequenceError> {
    value.map(|value| parse(value, "reason")).transpose()
}

fn reason_str(reason: Option<EnrollmentReason>) -> Option<&'static str> {
    reason.map(Into::into)
}

/// Live statuses, as stored.
const LIVE: [&str; 3] = ["active", "paused", "needs_attention"];

struct SequenceRecord {
    id: Uuid,
    name: String,
    link_id: Option<Uuid>,
    footer: String,
    status: String,
    steps: Json<Vec<Step>>,
    version: i32,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl TryFrom<SequenceRecord> for Sequence {
    type Error = PgSequenceError;
    fn try_from(record: SequenceRecord) -> Result<Self, Self::Error> {
        Ok(Sequence {
            id: record.id,
            name: record.name,
            link_id: record.link_id,
            footer: record.footer,
            status: parse(&record.status, "sequence status")?,
            steps: record.steps.0,
            version: record.version,
            created_at: record.created_at,
            updated_at: record.updated_at,
        })
    }
}

struct EnrollmentRecord {
    id: Uuid,
    sequence_id: Uuid,
    owner_id: String,
    team_id: Uuid,
    sequence_status: String,
    sequence_link_id: Option<Uuid>,
    link_id: Option<Uuid>,
    email: String,
    contact_name: Option<String>,
    steps: Json<Vec<Step>>,
    status: String,
    reason: Option<String>,
    next_step: i16,
    due_at: Option<DateTime<Utc>>,
    attempts: i16,
    timezone: String,
    send_time: NaiveTime,
    replies_after: Option<DateTime<Utc>>,
}

impl TryFrom<EnrollmentRecord> for EnrollmentRow {
    type Error = PgSequenceError;
    fn try_from(record: EnrollmentRecord) -> Result<Self, Self::Error> {
        Ok(EnrollmentRow {
            id: record.id,
            sequence_id: record.sequence_id,
            owner_id: record.owner_id,
            team_id: record.team_id,
            sequence_status: parse(&record.sequence_status, "sequence status")?,
            sequence_link_id: record.sequence_link_id,
            link_id: record.link_id,
            email: record.email,
            contact_name: record.contact_name,
            steps: record.steps.0,
            status: parse(&record.status, "enrollment status")?,
            reason: parse_reason(record.reason.as_deref())?,
            next_step: record.next_step,
            due_at: record.due_at,
            attempts: record.attempts,
            clock: SendClock {
                timezone: parse(&record.timezone, "time zone")?,
                send_time: record.send_time,
            },
            replies_after: record.replies_after,
        })
    }
}

struct SummaryRecord {
    id: Uuid,
    crm_contact_id: Option<Uuid>,
    email: String,
    contact_name: Option<String>,
    status: String,
    reason: Option<String>,
    next_step: i16,
    step_count: i32,
    last_sent_at: Option<DateTime<Utc>>,
    next_send_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

impl TryFrom<SummaryRecord> for EnrollmentSummary {
    type Error = PgSequenceError;
    fn try_from(record: SummaryRecord) -> Result<Self, Self::Error> {
        Ok(EnrollmentSummary {
            id: record.id,
            crm_contact_id: record.crm_contact_id,
            email: record.email,
            contact_name: record.contact_name,
            status: parse(&record.status, "enrollment status")?,
            reason: parse_reason(record.reason.as_deref())?,
            next_step: record.next_step,
            step_count: record.step_count,
            last_sent_at: record.last_sent_at,
            next_send_at: record.next_send_at,
            created_at: record.created_at,
        })
    }
}

struct HistoryRecord {
    step: i16,
    message_id: Uuid,
    delivery_message_id: Option<String>,
    provider_message_id: Option<String>,
    status: String,
    scheduled_at: DateTime<Utc>,
    sent_at: Option<DateTime<Utc>>,
}

impl TryFrom<HistoryRecord> for HistoryRow {
    type Error = PgSequenceError;
    fn try_from(record: HistoryRecord) -> Result<Self, Self::Error> {
        Ok(HistoryRow {
            step: record.step,
            message_id: record.message_id,
            delivery_message_id: record.delivery_message_id,
            provider_message_id: record.provider_message_id,
            status: parse(&record.status, "step status")?,
            scheduled_at: record.scheduled_at,
            sent_at: record.sent_at,
        })
    }
}

fn collect<T, U: TryFrom<T, Error = PgSequenceError>>(
    records: Vec<T>,
) -> Result<Vec<U>, PgSequenceError> {
    records.into_iter().map(U::try_from).collect()
}

async fn summaries(
    conn: &mut PgConnection,
    sequence_id: Option<Uuid>,
    enrollment_id: Option<Uuid>,
    owner: Option<&Owner>,
) -> Result<Vec<EnrollmentSummary>, PgSequenceError> {
    let records = sqlx::query_as!(
        SummaryRecord,
        r#"SELECT e.id, e.crm_contact_id, e.email, e.contact_name, e.status, e.reason, e.next_step,
                  jsonb_array_length(e.steps) AS "step_count!", e.created_at,
                  (SELECT max(h.sent_at) FROM email_sequence_steps h WHERE h.enrollment_id = e.id) AS last_sent_at,
                  COALESCE((SELECT h.scheduled_at FROM email_sequence_steps h
                            WHERE h.enrollment_id = e.id AND h.status = 'scheduled'), e.due_at) AS next_send_at
           FROM email_sequence_enrollments e
           JOIN email_sequences s ON s.id = e.sequence_id
           WHERE ($1::uuid IS NULL OR e.sequence_id = $1)
             AND ($2::uuid IS NULL OR e.id = $2)
             AND ($3::text IS NULL OR (s.user_id = $3 AND s.team_id = $4))
           ORDER BY e.created_at DESC, e.id"#,
        sequence_id,
        enrollment_id,
        owner.map(|owner| owner.user_id.as_str()),
        owner.map(|owner| owner.team_id),
    )
    .fetch_all(&mut *conn)
    .await?;
    collect(records)
}

async fn history(
    conn: &mut PgConnection,
    enrollment_id: Uuid,
) -> Result<Vec<HistoryRow>, PgSequenceError> {
    let records = sqlx::query_as!(
        HistoryRecord,
        r#"SELECT step, message_id, delivery_message_id, provider_message_id, status, scheduled_at, sent_at
           FROM email_sequence_steps WHERE enrollment_id = $1 ORDER BY step"#,
        enrollment_id,
    )
    .fetch_all(&mut *conn)
    .await?;
    collect(records)
}

impl SequenceRepo for PgSequenceRepo {
    type Err = PgSequenceError;
    type Tx = Transaction<'static, Postgres>;
    type Conn = PgConnection;

    fn conn(tx: &mut Self::Tx) -> &mut PgConnection {
        tx
    }

    async fn begin(&self) -> Result<Self::Tx, PgSequenceError> {
        Ok(self.pool.begin().await?)
    }

    async fn commit(&self, tx: Self::Tx) -> Result<(), PgSequenceError> {
        Ok(tx.commit().await?)
    }

    async fn list_sequences(&self, owner: &Owner) -> Result<Vec<SequenceSummary>, PgSequenceError> {
        let rows = sqlx::query!(
            r#"SELECT s.id, s.name, s.status, jsonb_array_length(s.steps) AS "step_count!", s.updated_at,
                      count(e.id) FILTER (WHERE e.status = 'active') AS "active!",
                      count(e.id) FILTER (WHERE e.status = 'paused') AS "paused!",
                      count(e.id) FILTER (WHERE e.status = 'needs_attention') AS "needs_attention!",
                      count(e.id) FILTER (WHERE e.status = 'stopped') AS "stopped!",
                      count(e.id) FILTER (WHERE e.status = 'completed') AS "completed!"
               FROM email_sequences s
               LEFT JOIN email_sequence_enrollments e ON e.sequence_id = s.id
               WHERE s.user_id = $1 AND s.team_id = $2
               GROUP BY s.id
               ORDER BY s.updated_at DESC, s.id"#,
            owner.user_id,
            owner.team_id,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(SequenceSummary {
                    id: row.id,
                    name: row.name,
                    status: parse(&row.status, "sequence status")?,
                    step_count: row.step_count,
                    counts: EnrollmentCounts {
                        active: row.active,
                        paused: row.paused,
                        needs_attention: row.needs_attention,
                        stopped: row.stopped,
                        completed: row.completed,
                    },
                    updated_at: row.updated_at,
                })
            })
            .collect()
    }

    async fn sequence(&self, owner: &Owner, id: Uuid) -> Result<Option<Sequence>, PgSequenceError> {
        sqlx::query_as!(
            SequenceRecord,
            r#"SELECT id, name, link_id, footer, status, steps AS "steps: Json<Vec<Step>>", version, created_at, updated_at
               FROM email_sequences WHERE id = $1 AND user_id = $2 AND team_id = $3"#,
            id,
            owner.user_id,
            owner.team_id,
        )
        .fetch_optional(&self.pool)
        .await?
        .map(Sequence::try_from)
        .transpose()
    }

    async fn enrollments(
        &self,
        sequence_id: Uuid,
    ) -> Result<Vec<EnrollmentSummary>, PgSequenceError> {
        let mut conn = self.pool.acquire().await?;
        summaries(&mut conn, Some(sequence_id), None, None).await
    }

    async fn insert_sequence(
        &self,
        owner: &Owner,
        input: &NewSequence,
    ) -> Result<Sequence, PgSequenceError> {
        sqlx::query_as!(
            SequenceRecord,
            r#"INSERT INTO email_sequences (id, team_id, user_id, link_id, name, footer, steps)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING id, name, link_id, footer, status, steps AS "steps: Json<Vec<Step>>", version, created_at, updated_at"#,
            macro_uuid::generate_uuid_v7(),
            owner.team_id,
            owner.user_id,
            input.link_id,
            input.name,
            input.footer,
            Json(&input.steps) as _,
        )
        .fetch_one(&self.pool)
        .await?
        .try_into()
    }

    async fn lock_sequence(
        &self,
        tx: &mut Self::Tx,
        owner: &Owner,
        id: Uuid,
        share: bool,
    ) -> Result<Option<Sequence>, PgSequenceError> {
        let record = if share {
            sqlx::query_as!(
                SequenceRecord,
                r#"SELECT id, name, link_id, footer, status, steps AS "steps: Json<Vec<Step>>", version, created_at, updated_at
                   FROM email_sequences WHERE id = $1 AND user_id = $2 AND team_id = $3 FOR SHARE"#,
                id,
                owner.user_id,
                owner.team_id,
            )
            .fetch_optional(&mut **tx)
            .await?
        } else {
            sqlx::query_as!(
                SequenceRecord,
                r#"SELECT id, name, link_id, footer, status, steps AS "steps: Json<Vec<Step>>", version, created_at, updated_at
                   FROM email_sequences WHERE id = $1 AND user_id = $2 AND team_id = $3 FOR UPDATE"#,
                id,
                owner.user_id,
                owner.team_id,
            )
            .fetch_optional(&mut **tx)
            .await?
        };
        record.map(Sequence::try_from).transpose()
    }

    async fn save_sequence(
        &self,
        tx: &mut Self::Tx,
        sequence: &Sequence,
    ) -> Result<Sequence, PgSequenceError> {
        let status: &'static str = sequence.status.into();
        sqlx::query_as!(
            SequenceRecord,
            r#"UPDATE email_sequences
               SET name = $2, link_id = $3, footer = $4, status = $5, steps = $6,
                   version = version + 1, updated_at = now()
               WHERE id = $1
               RETURNING id, name, link_id, footer, status, steps AS "steps: Json<Vec<Step>>", version, created_at, updated_at"#,
            sequence.id,
            sequence.name,
            sequence.link_id,
            sequence.footer,
            status,
            Json(&sequence.steps) as _,
        )
        .fetch_one(&mut **tx)
        .await?
        .try_into()
    }

    async fn delete_sequence(&self, tx: &mut Self::Tx, id: Uuid) -> Result<(), PgSequenceError> {
        sqlx::query!("DELETE FROM email_sequences WHERE id = $1", id)
            .execute(&mut **tx)
            .await?;
        Ok(())
    }

    async fn lock_live_enrollments(
        &self,
        tx: &mut Self::Tx,
        sequence_id: Uuid,
    ) -> Result<Vec<EnrollmentRow>, PgSequenceError> {
        let records = sqlx::query_as!(
            EnrollmentRecord,
            r#"SELECT e.id, e.sequence_id, s.user_id AS owner_id, e.team_id, s.status AS sequence_status,
                      s.link_id AS sequence_link_id, e.link_id, e.email, e.contact_name,
                      '[]'::jsonb AS "steps!: Json<Vec<Step>>", e.status, e.reason, e.next_step, e.due_at,
                      e.attempts, e.timezone, e.send_time, e.replies_after
               FROM email_sequence_enrollments e JOIN email_sequences s ON s.id = e.sequence_id
               WHERE e.sequence_id = $1 AND e.status = ANY($2)
               ORDER BY e.id
               FOR UPDATE OF e"#,
            sequence_id,
            &LIVE.map(str::to_owned) as &[String],
        )
        .fetch_all(&mut **tx)
        .await?;
        collect(records)
    }

    async fn owned_enrollment(
        &self,
        owner: &Owner,
        id: Uuid,
    ) -> Result<Option<EnrollmentSummary>, PgSequenceError> {
        let mut conn = self.pool.acquire().await?;
        Ok(summaries(&mut conn, None, Some(id), Some(owner))
            .await?
            .into_iter()
            .next())
    }

    async fn enrollment_detail(
        &self,
        owner: &Owner,
        id: Uuid,
    ) -> Result<Option<EnrollmentDetail>, PgSequenceError> {
        let mut conn = self.pool.acquire().await?;
        let Some(enrollment) = summaries(&mut conn, None, Some(id), Some(owner))
            .await?
            .into_iter()
            .next()
        else {
            return Ok(None);
        };
        let steps = sqlx::query_scalar!(
            r#"SELECT steps AS "steps: Json<Vec<Step>>" FROM email_sequence_enrollments WHERE id = $1"#,
            id,
        )
        .fetch_one(&mut *conn)
        .await?
        .0;
        let history = history(&mut conn, id).await?;
        let steps = steps
            .into_iter()
            .zip(0_i16..)
            .map(|(step, index)| {
                let recorded = history.iter().find(|row| row.step == index);
                EnrollmentStep {
                    step,
                    status: recorded.map_or(StepStatus::Pending, |row| row.status),
                    scheduled_at: recorded.map(|row| row.scheduled_at),
                    sent_at: recorded.and_then(|row| row.sent_at),
                }
            })
            .collect();
        Ok(Some(EnrollmentDetail { enrollment, steps }))
    }

    async fn lock_enrollment(
        &self,
        tx: &mut Self::Tx,
        id: Uuid,
        skip_locked: bool,
    ) -> Result<Option<EnrollmentRow>, PgSequenceError> {
        let record = if skip_locked {
            sqlx::query_as!(
                EnrollmentRecord,
                r#"SELECT e.id, e.sequence_id, s.user_id AS owner_id, e.team_id, s.status AS sequence_status,
                          s.link_id AS sequence_link_id, e.link_id, e.email, e.contact_name,
                          e.steps AS "steps: Json<Vec<Step>>", e.status, e.reason, e.next_step, e.due_at,
                          e.attempts, e.timezone, e.send_time, e.replies_after
                   FROM email_sequence_enrollments e JOIN email_sequences s ON s.id = e.sequence_id
                   WHERE e.id = $1
                   FOR UPDATE OF e SKIP LOCKED"#,
                id,
            )
            .fetch_optional(&mut **tx)
            .await?
        } else {
            sqlx::query_as!(
                EnrollmentRecord,
                r#"SELECT e.id, e.sequence_id, s.user_id AS owner_id, e.team_id, s.status AS sequence_status,
                          s.link_id AS sequence_link_id, e.link_id, e.email, e.contact_name,
                          e.steps AS "steps: Json<Vec<Step>>", e.status, e.reason, e.next_step, e.due_at,
                          e.attempts, e.timezone, e.send_time, e.replies_after
                   FROM email_sequence_enrollments e JOIN email_sequences s ON s.id = e.sequence_id
                   WHERE e.id = $1
                   FOR UPDATE OF e"#,
                id,
            )
            .fetch_optional(&mut **tx)
            .await?
        };
        record.map(EnrollmentRow::try_from).transpose()
    }

    async fn history(
        &self,
        tx: &mut Self::Tx,
        enrollment_id: Uuid,
    ) -> Result<Vec<HistoryRow>, PgSequenceError> {
        history(tx, enrollment_id).await
    }

    async fn update_enrollment(
        &self,
        tx: &mut Self::Tx,
        row: &EnrollmentRow,
    ) -> Result<(), PgSequenceError> {
        let status: &'static str = row.status.into();
        sqlx::query!(
            r#"UPDATE email_sequence_enrollments
               SET link_id = $2, status = $3, reason = $4, next_step = $5, due_at = $6,
                   attempts = $7, replies_after = $8, updated_at = now()
               WHERE id = $1"#,
            row.id,
            row.link_id,
            status,
            reason_str(row.reason),
            row.next_step,
            row.due_at,
            row.attempts,
            row.replies_after,
        )
        .execute(&mut **tx)
        .await?;
        Ok(())
    }

    async fn insert_step(
        &self,
        tx: &mut Self::Tx,
        enrollment_id: Uuid,
        step: i16,
        message_id: Uuid,
        scheduled_at: DateTime<Utc>,
    ) -> Result<(), PgSequenceError> {
        sqlx::query!(
            r#"INSERT INTO email_sequence_steps (enrollment_id, step, message_id, status, scheduled_at)
               VALUES ($1, $2, $3, 'scheduled', $4)"#,
            enrollment_id,
            step,
            message_id,
            scheduled_at,
        )
        .execute(&mut **tx)
        .await?;
        Ok(())
    }

    async fn mark_sent(
        &self,
        tx: &mut Self::Tx,
        enrollment_id: Uuid,
        step: i16,
        sent: &SentStep,
    ) -> Result<(), PgSequenceError> {
        sqlx::query!(
            r#"UPDATE email_sequence_steps
               SET status = 'sent', sent_at = $3, delivery_message_id = $4, provider_message_id = $5
               WHERE enrollment_id = $1 AND step = $2"#,
            enrollment_id,
            step,
            sent.sent_at,
            sent.delivery_message_id,
            sent.provider_message_id,
        )
        .execute(&mut **tx)
        .await?;
        Ok(())
    }

    async fn mark_unknown(
        &self,
        tx: &mut Self::Tx,
        enrollment_id: Uuid,
        step: i16,
    ) -> Result<(), PgSequenceError> {
        sqlx::query!(
            "UPDATE email_sequence_steps SET status = 'unknown' WHERE enrollment_id = $1 AND step = $2",
            enrollment_id,
            step,
        )
        .execute(&mut **tx)
        .await?;
        Ok(())
    }

    async fn delete_step(
        &self,
        tx: &mut Self::Tx,
        enrollment_id: Uuid,
        step: i16,
    ) -> Result<(), PgSequenceError> {
        sqlx::query!(
            "DELETE FROM email_sequence_steps WHERE enrollment_id = $1 AND step = $2",
            enrollment_id,
            step,
        )
        .execute(&mut **tx)
        .await?;
        Ok(())
    }

    async fn upsert_recipients(
        &self,
        tx: &mut Self::Tx,
        team_id: Uuid,
        emails: &[String],
    ) -> Result<Vec<(String, RecipientState)>, PgSequenceError> {
        if emails.is_empty() {
            return Ok(Vec::new());
        }
        let tokens: Vec<String> = emails
            .iter()
            .map(|_| UnsubscribeToken::generate().as_str().to_owned())
            .collect();
        // Callers pass sorted addresses, so concurrent enrolls lock rows in one order.
        let rows = sqlx::query!(
            r#"INSERT INTO email_sequence_recipients (team_id, email, token)
               SELECT $1, address, token FROM unnest($2::text[], $3::text[]) AS input(address, token)
               ON CONFLICT (team_id, email) DO UPDATE SET email = EXCLUDED.email
               RETURNING email, token, unsubscribed_at"#,
            team_id,
            emails,
            &tokens,
        )
        .fetch_all(&mut **tx)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok((
                    row.email,
                    RecipientState {
                        token: UnsubscribeToken::parse(&row.token)
                            .ok_or(PgSequenceError::Decode("token"))?,
                        unsubscribed: row.unsubscribed_at.is_some(),
                    },
                ))
            })
            .collect()
    }

    async fn insert_enrollment(
        &self,
        tx: &mut Self::Tx,
        enrollment: &NewEnrollment<'_>,
    ) -> Result<Option<Uuid>, PgSequenceError> {
        Ok(sqlx::query_scalar!(
            r#"INSERT INTO email_sequence_enrollments
                (id, sequence_id, team_id, link_id, crm_contact_id, email, contact_name, steps,
                 status, due_at, timezone, send_time)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10, $11)
               ON CONFLICT (sequence_id, email) DO NOTHING
               RETURNING id"#,
            macro_uuid::generate_uuid_v7(),
            enrollment.sequence_id,
            enrollment.team_id,
            enrollment.link_id,
            enrollment.crm_contact_id,
            enrollment.email,
            enrollment.contact_name,
            Json(enrollment.steps) as _,
            enrollment.due_at,
            enrollment.timezone,
            enrollment.send_time,
        )
        .fetch_optional(&mut **tx)
        .await?)
    }

    async fn recipient(
        &self,
        tx: &mut Self::Tx,
        team_id: Uuid,
        email: &str,
    ) -> Result<Option<RecipientState>, PgSequenceError> {
        sqlx::query!(
            "SELECT token, unsubscribed_at FROM email_sequence_recipients WHERE team_id = $1 AND email = $2",
            team_id,
            email,
        )
        .fetch_optional(&mut **tx)
        .await?
        .map(|row| {
            Ok(RecipientState {
                token: UnsubscribeToken::parse(&row.token)
                    .ok_or(PgSequenceError::Decode("token"))?,
                unsubscribed: row.unsubscribed_at.is_some(),
            })
        })
        .transpose()
    }

    async fn unsubscribe_token(
        &self,
        token: &UnsubscribeToken,
    ) -> Result<Option<(Uuid, String)>, PgSequenceError> {
        Ok(sqlx::query!(
            r#"UPDATE email_sequence_recipients
               SET unsubscribed_at = COALESCE(unsubscribed_at, now()), source = COALESCE(source, 'link')
               WHERE token = $1
               RETURNING team_id, email"#,
            token.as_str(),
        )
        .fetch_optional(&self.pool)
        .await?
        .map(|row| (row.team_id, row.email)))
    }

    async fn unsubscribe_address(&self, team_id: Uuid, email: &str) -> Result<(), PgSequenceError> {
        let token = UnsubscribeToken::generate();
        sqlx::query!(
            r#"INSERT INTO email_sequence_recipients (team_id, email, token, unsubscribed_at, source)
               VALUES ($1, $2, $3, now(), 'manual')
               ON CONFLICT (team_id, email) DO UPDATE
               SET unsubscribed_at = COALESCE(email_sequence_recipients.unsubscribed_at, now()),
                   source = COALESCE(email_sequence_recipients.source, 'manual')"#,
            team_id,
            email,
            token.as_str(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn live_enrollments_of_address(
        &self,
        team_id: Uuid,
        email: &str,
    ) -> Result<Vec<Uuid>, PgSequenceError> {
        Ok(sqlx::query_scalar!(
            r#"SELECT id FROM email_sequence_enrollments
               WHERE team_id = $1 AND email = $2 AND status = ANY($3)
               ORDER BY id"#,
            team_id,
            email,
            &LIVE.map(str::to_owned) as &[String],
        )
        .fetch_all(&self.pool)
        .await?)
    }

    async fn contact_enrollments(
        &self,
        team_id: Uuid,
        email: &str,
        viewer: &str,
    ) -> Result<Vec<ContactEnrollment>, PgSequenceError> {
        let rows = sqlx::query!(
            r#"SELECT s.id AS sequence_id, s.name AS sequence_name, s.user_id AS owner_id,
                      s.status AS sequence_status, e.status, e.reason,
                      (SELECT max(h.sent_at) FROM email_sequence_steps h WHERE h.enrollment_id = e.id) AS last_sent_at,
                      COALESCE((SELECT h.scheduled_at FROM email_sequence_steps h
                                WHERE h.enrollment_id = e.id AND h.status = 'scheduled'), e.due_at) AS next_send_at
               FROM email_sequence_enrollments e JOIN email_sequences s ON s.id = e.sequence_id
               WHERE e.team_id = $1 AND e.email = $2
               ORDER BY e.created_at DESC, e.id"#,
            team_id,
            email,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(ContactEnrollment {
                    is_owner: row.owner_id == viewer,
                    sequence_id: row.sequence_id,
                    sequence_name: row.sequence_name,
                    owner_id: row.owner_id,
                    status: parse(&row.status, "enrollment status")?,
                    reason: parse_reason(row.reason.as_deref())?,
                    sequence_paused: parse::<SequenceStatus>(
                        &row.sequence_status,
                        "sequence status",
                    )? == SequenceStatus::Paused,
                    last_sent_at: row.last_sent_at,
                    next_send_at: row.next_send_at,
                })
            })
            .collect()
    }

    async fn scheduled_page(
        &self,
        after: Option<(DateTime<Utc>, Uuid)>,
        limit: i64,
    ) -> Result<Vec<(DateTime<Utc>, Uuid)>, PgSequenceError> {
        let rows = sqlx::query!(
            r#"SELECT scheduled_at, enrollment_id FROM email_sequence_steps
               WHERE status = 'scheduled'
                 AND ($1::timestamptz IS NULL OR (scheduled_at, enrollment_id) > ($1, $2))
               ORDER BY scheduled_at, enrollment_id
               LIMIT $3"#,
            after.map(|(at, _)| at),
            after.map(|(_, id)| id),
            limit,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| (row.scheduled_at, row.enrollment_id))
            .collect())
    }

    async fn due_page(
        &self,
        after: Option<(DateTime<Utc>, Uuid)>,
        limit: i64,
    ) -> Result<Vec<DueEnrollment>, PgSequenceError> {
        let rows = sqlx::query!(
            r#"SELECT e.id, e.due_at AS "due_at!", e.link_id, e.email, e.contact_name
               FROM email_sequence_enrollments e
               JOIN email_sequences s ON s.id = e.sequence_id AND s.status = 'active'
               WHERE e.status = 'active' AND e.due_at <= now()
                 AND ($1::timestamptz IS NULL OR (e.due_at, e.id) > ($1, $2))
                 AND NOT EXISTS (SELECT 1 FROM email_sequence_steps h
                                 WHERE h.enrollment_id = e.id AND h.status = 'scheduled')
               ORDER BY e.due_at, e.id
               LIMIT $3"#,
            after.map(|(at, _)| at),
            after.map(|(_, id)| id),
            limit,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| DueEnrollment {
                id: row.id,
                due_at: row.due_at,
                link_id: row.link_id,
                email: row.email,
                contact_name: row.contact_name,
            })
            .collect())
    }

    async fn heal_stranded(&self, due_at: DateTime<Utc>) -> Result<u64, PgSequenceError> {
        Ok(sqlx::query!(
            r#"UPDATE email_sequence_enrollments SET due_at = $1, updated_at = now()
               WHERE id IN (
                   SELECT e.id FROM email_sequence_enrollments e
                   WHERE e.status = 'active' AND e.due_at IS NULL
                     AND NOT EXISTS (SELECT 1 FROM email_sequence_steps h
                                     WHERE h.enrollment_id = e.id AND h.status = 'scheduled')
                   FOR UPDATE SKIP LOCKED)"#,
            due_at,
        )
        .execute(&self.pool)
        .await?
        .rows_affected())
    }

    async fn defer(
        &self,
        enrollment_id: Uuid,
        due_at: DateTime<Utc>,
    ) -> Result<(), PgSequenceError> {
        sqlx::query!(
            r#"UPDATE email_sequence_enrollments SET due_at = $2, updated_at = now()
               WHERE id = $1 AND status = 'active'"#,
            enrollment_id,
            due_at,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn known_steps(&self, message_ids: &[Uuid]) -> Result<Vec<Uuid>, PgSequenceError> {
        Ok(sqlx::query_scalar!(
            "SELECT message_id FROM email_sequence_steps WHERE message_id = ANY($1)",
            message_ids,
        )
        .fetch_all(&self.pool)
        .await?)
    }

    async fn has_live_enrollments(&self, link_id: Uuid) -> Result<bool, PgSequenceError> {
        Ok(sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM email_sequence_enrollments
                              WHERE link_id = $1 AND status = ANY($2)) AS "live!""#,
            link_id,
            &LIVE.map(str::to_owned) as &[String],
        )
        .fetch_one(&self.pool)
        .await?)
    }

    async fn reply_candidates(
        &self,
        candidates: ReplyCandidates<'_>,
    ) -> Result<Vec<Uuid>, PgSequenceError> {
        let references: Vec<String> = candidates
            .references
            .iter()
            .map(|reference| reference.to_lowercase())
            .collect();
        Ok(sqlx::query_scalar!(
            r#"SELECT e.id FROM email_sequence_enrollments e
               WHERE e.link_id = $1 AND e.status = ANY($2)
                 AND (e.email = $3 OR e.email = ANY($4)
                      OR ($7::text IS NOT NULL AND strpos($7, e.email) > 0)
                      OR EXISTS (SELECT 1 FROM email_sequence_steps h
                                 WHERE h.enrollment_id = e.id
                                   AND (h.message_id = ANY($6)
                                        OR lower(h.delivery_message_id) = ANY($5)
                                        OR lower(h.provider_message_id) = ANY($5))))
               ORDER BY e.id"#,
            candidates.link_id,
            &LIVE.map(str::to_owned) as &[String],
            candidates.from,
            candidates.failed_recipients,
            &references,
            candidates.message_ids,
            candidates.bounce_text,
        )
        .fetch_all(&self.pool)
        .await?)
    }
}
