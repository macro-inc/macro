//! The `agent_response_feedback` table, and which accounts are agents.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::{Report, report};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::model::{
    AppendOutcome, ExportCursor, ExportLimit, FeedbackEvent, FeedbackState, FeedbackWrite,
    MyFeedback, Rating, SubjectKind,
};
use crate::domain::ports::{AgentAccounts, FeedbackRepo};

#[cfg(test)]
mod test;

/// Ratings in MacroDB.
#[derive(Clone)]
pub struct PgFeedbackRepo {
    pool: PgPool,
}

impl PgFeedbackRepo {
    /// Read and write through `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// A newest row's rating, note and time.
struct Latest {
    rating: Option<String>,
    note: Option<String>,
    created_at: DateTime<Utc>,
}

impl Latest {
    fn state(self) -> Result<FeedbackState, Report> {
        Ok(FeedbackState {
            rating: self.rating.as_deref().map(parse_rating).transpose()?,
            note: self.note,
            updated_at: Some(self.created_at),
        })
    }
}

fn parse_rating(value: &str) -> Result<Rating, Report> {
    value.parse().map_err(|_| report!("unknown rating {value}"))
}

fn turn_column(turn: Option<u32>) -> Result<Option<i32>, Report> {
    turn.map(i32::try_from)
        .transpose()
        .map_err(|_| report!("turn out of range"))
}

fn turn_value(turn: Option<i32>) -> Result<Option<u32>, Report> {
    turn.map(u32::try_from)
        .transpose()
        .map_err(|_| report!("negative turn stored"))
}

impl FeedbackRepo for PgFeedbackRepo {
    async fn append_if_changed(&self, write: &FeedbackWrite) -> Result<AppendOutcome, Report> {
        let kind = write.subject.kind();
        let container_id = write.subject.container_id();
        let subject_id = write.subject.subject_id();
        let turn = turn_column(write.subject.turn())?;
        let mut transaction = self.pool.begin().await?;

        // One writer per person and response: the replay check, the
        // comparison with the newest row and the insert see each other's
        // writes. Held until commit.
        sqlx::query!(
            r#"SELECT pg_advisory_xact_lock(hashtextextended(
                   concat_ws('|', 'agent_response_feedback', $1::text, $2::text, $3::text, $4::text), 0))"#,
            write.user.as_ref(),
            kind.as_ref(),
            subject_id.to_string(),
            turn.map(|turn| turn.to_string()),
        )
        .execute(&mut *transaction)
        .await?;

        let latest = sqlx::query_as!(
            Latest,
            r#"SELECT rating::text AS rating, note, created_at
               FROM agent_response_feedback
               WHERE user_id = $1
                 AND subject_kind = $2::text::agent_response_feedback_subject
                 AND container_id = $3
                 AND subject_id = $4
                 AND turn IS NOT DISTINCT FROM $5
               ORDER BY created_at DESC, id DESC
               LIMIT 1"#,
            write.user.as_ref(),
            kind.as_ref(),
            container_id,
            subject_id,
            turn,
        )
        .fetch_optional(&mut *transaction)
        .await?;

        let stored = sqlx::query!(
            r#"SELECT user_id, subject_kind::text AS "subject_kind!", subject_id, turn
               FROM agent_response_feedback WHERE id = $1"#,
            write.id,
        )
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(stored) = stored {
            let same_response = stored.user_id == write.user.as_ref()
                && stored.subject_kind == kind.as_ref()
                && stored.subject_id == subject_id
                && stored.turn == turn;
            if !same_response {
                return Ok(AppendOutcome::IdTaken);
            }
            let state = match latest {
                Some(latest) => latest.state()?,
                None => FeedbackState::default(),
            };
            return Ok(AppendOutcome::Replayed(state));
        }

        let note = write.note.as_ref().map(|note| note.as_str());
        let rating = write.rating.map(|rating| rating.as_ref().to_owned());
        let current_rating = latest.as_ref().and_then(|latest| latest.rating.as_deref());
        let current_note = latest.as_ref().and_then(|latest| latest.note.as_deref());
        if current_rating == rating.as_deref() && current_note == note {
            let state = match latest {
                Some(latest) => latest.state()?,
                None => FeedbackState::default(),
            };
            return Ok(AppendOutcome::Unchanged(state));
        }

        // clock_timestamp, not now(): rows for one response are ordered by
        // when they were written under the lock, not when their
        // transactions began.
        let context = &write.context;
        let created_at = sqlx::query_scalar!(
            r#"INSERT INTO agent_response_feedback (
                   id, user_id, subject_kind, container_id, subject_id, turn, rating, note,
                   surface, message_parent_type, agent_session_id, agent_bot_id, agent_user_id,
                   agent_kind, harness, model, trace_id, created_at)
               VALUES ($1, $2, $3::text::agent_response_feedback_subject, $4, $5, $6,
                   $7::text::agent_response_rating, $8, $9::text::agent_response_feedback_surface,
                   $10, $11, $12, $13, $14::text::agent_response_agent_kind, $15, $16, $17,
                   clock_timestamp())
               ON CONFLICT (id) DO NOTHING
               RETURNING created_at"#,
            write.id,
            write.user.as_ref(),
            kind.as_ref(),
            container_id,
            subject_id,
            turn,
            rating,
            note,
            write.surface.as_ref(),
            context.message_parent_type,
            context.agent_session_id.map(|id| id.as_uuid()),
            context.agent_bot_id.map(|id| id.as_uuid()),
            context.agent_user_id.as_ref().map(|user| user.as_ref()),
            context.agent_kind.map(|kind| kind.as_ref().to_owned()),
            context.harness,
            context.model,
            write.trace_id,
        )
        .fetch_optional(&mut *transaction)
        .await?;
        // Another response's write took the id after the check above.
        let Some(created_at) = created_at else {
            return Ok(AppendOutcome::IdTaken);
        };
        transaction.commit().await?;

        Ok(AppendOutcome::Created(FeedbackState {
            rating: write.rating,
            note: note.map(str::to_owned),
            updated_at: Some(created_at),
        }))
    }

    async fn current_in_container(
        &self,
        user: &MacroUserIdStr<'static>,
        kind: SubjectKind,
        container_id: &str,
    ) -> Result<Vec<MyFeedback>, Report> {
        let rows = sqlx::query!(
            r#"SELECT subject_id AS "subject_id!", turn, rating::text AS "rating!", note,
                      created_at AS "created_at!"
               FROM (
                   SELECT DISTINCT ON (subject_id, turn) subject_id, turn, rating, note, created_at
                   FROM agent_response_feedback
                   WHERE user_id = $1
                     AND subject_kind = $2::text::agent_response_feedback_subject
                     AND container_id = $3
                   ORDER BY subject_id, turn, created_at DESC, id DESC
               ) latest
               WHERE rating IS NOT NULL
               ORDER BY subject_id, turn"#,
            user.as_ref(),
            kind.as_ref(),
            container_id,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(MyFeedback {
                    subject_id: row.subject_id,
                    turn: turn_value(row.turn)?,
                    rating: parse_rating(&row.rating)?,
                    note: row.note,
                    updated_at: row.created_at,
                })
            })
            .collect()
    }

    async fn events_after(
        &self,
        after: Option<ExportCursor>,
        limit: ExportLimit,
    ) -> Result<Vec<FeedbackEvent>, Report> {
        let limit = i64::from(limit.get());
        // The first page and the rest are separate statements, so each is a
        // plain range scan of the (created_at, id) index.
        let rows = match after {
            None => {
                sqlx::query_as!(
                    EventRow,
                    r#"SELECT id, user_id, subject_kind::text AS "subject_kind!", container_id,
                              subject_id, turn, rating::text AS rating, note,
                              surface::text AS "surface!", message_parent_type, agent_session_id,
                              agent_bot_id, agent_user_id, agent_kind::text AS agent_kind,
                              harness, model, trace_id, created_at
                       FROM agent_response_feedback
                       ORDER BY created_at, id
                       LIMIT $1"#,
                    limit,
                )
                .fetch_all(&self.pool)
                .await?
            }
            Some(after) => {
                sqlx::query_as!(
                    EventRow,
                    r#"SELECT id, user_id, subject_kind::text AS "subject_kind!", container_id,
                              subject_id, turn, rating::text AS rating, note,
                              surface::text AS "surface!", message_parent_type, agent_session_id,
                              agent_bot_id, agent_user_id, agent_kind::text AS agent_kind,
                              harness, model, trace_id, created_at
                       FROM agent_response_feedback
                       WHERE (created_at, id) > ($1, $2)
                       ORDER BY created_at, id
                       LIMIT $3"#,
                    after.after_created_at,
                    after.after_id,
                    limit,
                )
                .fetch_all(&self.pool)
                .await?
            }
        };
        rows.into_iter().map(EventRow::event).collect()
    }
}

/// An export row as stored.
struct EventRow {
    id: Uuid,
    user_id: String,
    subject_kind: String,
    container_id: String,
    subject_id: Uuid,
    turn: Option<i32>,
    rating: Option<String>,
    note: Option<String>,
    surface: String,
    message_parent_type: Option<String>,
    agent_session_id: Option<Uuid>,
    agent_bot_id: Option<Uuid>,
    agent_user_id: Option<String>,
    agent_kind: Option<String>,
    harness: Option<String>,
    model: Option<String>,
    trace_id: Option<String>,
    created_at: DateTime<Utc>,
}

impl EventRow {
    fn event(self) -> Result<FeedbackEvent, Report> {
        Ok(FeedbackEvent {
            id: self.id,
            user_id: self.user_id,
            subject_kind: self
                .subject_kind
                .parse()
                .map_err(|_| report!("unknown subject kind {}", self.subject_kind))?,
            container_id: self.container_id,
            subject_id: self.subject_id,
            turn: turn_value(self.turn)?,
            rating: self.rating.as_deref().map(parse_rating).transpose()?,
            note: self.note,
            surface: self
                .surface
                .parse()
                .map_err(|_| report!("unknown surface {}", self.surface))?,
            message_parent_type: self.message_parent_type,
            agent_session_id: self.agent_session_id,
            agent_bot_id: self.agent_bot_id,
            agent_user_id: self.agent_user_id,
            agent_kind: self
                .agent_kind
                .as_deref()
                .map(|kind| {
                    kind.parse()
                        .map_err(|_| report!("unknown agent kind {kind}"))
                })
                .transpose()?,
            harness: self.harness,
            model: self.model,
            trace_id: self.trace_id,
            created_at: self.created_at,
        })
    }
}

impl AgentAccounts for PgFeedbackRepo {
    async fn is_agent_account(&self, user: &MacroUserIdStr<'_>) -> Result<bool, Report> {
        let is_agent = sqlx::query_scalar!(
            r#"SELECT "isAgent" FROM "User" WHERE id = $1"#,
            user.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(is_agent.unwrap_or(false))
    }
}
