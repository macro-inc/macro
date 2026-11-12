//! Routine drafts in progress, in `scheduled_action_draft`: the checks a
//! draft's session hands back, and a background draft's state, progress and
//! result. A row whose `state` is NULL is a draft its request waits for.

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use sqlx::PgPool;

use crate::domain::drafts::Draft;
use crate::domain::drafts::jobs::{
    CancelledJob, DraftJob, DraftJobPhase, Finished, InterruptedJob, NewDraftJob,
};
use crate::domain::drafts::progress::DraftJobProgress;
use crate::domain::models::{CreatedItem, RoutineCheck};
use crate::domain::ports::{DraftHandBacks, DraftJobStore, HandedBack, StaleDraft};

#[cfg(test)]
mod test;

pub struct PgDraftHandBacks {
    pool: PgPool,
}

impl PgDraftHandBacks {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait::async_trait]
impl DraftHandBacks for PgDraftHandBacks {
    async fn begin(
        &self,
        session: Uuid,
        owner: &MacroUserIdStr<'static>,
        agent: bot_id::BotId,
    ) -> Result<()> {
        sqlx::query!(
            "INSERT INTO scheduled_action_draft (session_id, owner_id, bot_id) VALUES ($1, $2, $3)",
            session,
            owner.as_ref(),
            agent.as_uuid(),
        )
        .execute(&self.pool)
        .await
        .context("start a routine draft")?;
        Ok(())
    }

    async fn record(
        &self,
        session: Uuid,
        owner: &MacroUserIdStr<'static>,
        check: &RoutineCheck,
        created: &[CreatedItem],
    ) -> Result<bool> {
        let checked = serde_json::to_value(check).context("encode a draft's check")?;
        let created = serde_json::to_value(created).context("encode what a draft created")?;
        // What it created adds up across checks, each item once.
        let updated = sqlx::query!(
            r#"
            UPDATE scheduled_action_draft SET
                checked = $3,
                passed = CASE WHEN $5 THEN $3 ELSE passed END,
                checks = checks + 1,
                created = (
                    SELECT COALESCE(jsonb_agg(DISTINCT item), '[]')
                    FROM jsonb_array_elements(created || $4::jsonb) AS item
                )
            WHERE session_id = $1 AND owner_id = $2
            "#,
            session,
            owner.as_ref(),
            checked,
            created,
            check.ok,
        )
        .execute(&self.pool)
        .await
        .context("keep a draft's check")?;
        Ok(updated.rows_affected() > 0)
    }

    async fn handed_back(&self, session: Uuid) -> Result<HandedBack> {
        let row = sqlx::query!(
            r#"
            SELECT checked, passed, checks, created, state IS NOT DISTINCT FROM 'cancelled' AS "cancelled!"
            FROM scheduled_action_draft WHERE session_id = $1
            "#,
            session,
        )
        .fetch_optional(&self.pool)
        .await
        .context("read a draft's check")?;
        let Some(row) = row else {
            return Ok(HandedBack::default());
        };
        Ok(HandedBack {
            // A check this build can't read is no answer.
            check: row
                .checked
                .and_then(|checked| serde_json::from_value(checked).ok()),
            passed: row
                .passed
                .and_then(|passed| serde_json::from_value(passed).ok()),
            checks: u32::try_from(row.checks).unwrap_or_default(),
            created: serde_json::from_value(row.created).unwrap_or_default(),
            cancelled: row.cancelled,
        })
    }

    async fn finish(&self, session: Uuid) -> Result<()> {
        sqlx::query!(
            "DELETE FROM scheduled_action_draft WHERE session_id = $1",
            session
        )
        .execute(&self.pool)
        .await
        .context("finish a routine draft")?;
        Ok(())
    }

    async fn stale(&self, before: DateTime<Utc>, limit: u16) -> Result<Vec<StaleDraft>> {
        let rows = sqlx::query!(
            r#"
            SELECT session_id, owner_id, bot_id FROM scheduled_action_draft
            WHERE created_at < $1 AND state IS NULL ORDER BY created_at LIMIT $2
            "#,
            before,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await
        .context("list stale routine drafts")?;
        Ok(rows
            .into_iter()
            .filter_map(|row| stale_draft(row.session_id, row.owner_id, row.bot_id))
            .collect())
    }
}

fn stale_draft(session: Uuid, owner: String, agent: Uuid) -> Option<StaleDraft> {
    Some(StaleDraft {
        session,
        owner: MacroUserIdStr::try_from(owner).ok()?,
        agent: bot_id::BotId::new_from_uuid(agent),
    })
}

/// A job as its row keeps it; parts this build can't read read as empty.
#[expect(clippy::too_many_arguments, reason = "one argument per column read")]
fn stored_job(
    session: Uuid,
    request: Option<serde_json::Value>,
    progress: Option<serde_json::Value>,
    created_at: DateTime<Utc>,
    state: Option<String>,
    result: Option<serde_json::Value>,
    finished_at: Option<DateTime<Utc>>,
) -> Option<DraftJob> {
    let phase = state?.parse::<DraftJobPhase>().ok()?;
    Some(DraftJob::stored(
        session,
        request
            .and_then(|request| serde_json::from_value(request).ok())
            .unwrap_or_default(),
        read_progress(progress),
        created_at,
        phase,
        result.and_then(|result| serde_json::from_value(result).ok()),
        finished_at,
    ))
}

fn read_progress(progress: Option<serde_json::Value>) -> DraftJobProgress {
    progress
        .and_then(|progress| serde_json::from_value(progress).ok())
        .unwrap_or_default()
}

#[async_trait::async_trait]
impl DraftJobStore for PgDraftHandBacks {
    async fn begin_job(&self, job: &NewDraftJob) -> Result<bool> {
        let request = serde_json::to_value(&job.request).context("encode a draft's request")?;
        let progress = serde_json::to_value(&job.progress).context("encode a draft's progress")?;
        let began = sqlx::query!(
            r#"
            INSERT INTO scheduled_action_draft
                (session_id, owner_id, bot_id, state, request, progress, created_at,
                 traceparent, client_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (owner_id, client_id) WHERE state IN ('drafting', 'ready', 'failed')
                DO NOTHING
            "#,
            job.session,
            job.owner.as_ref(),
            job.agent.as_uuid(),
            DraftJobPhase::Drafting.as_ref(),
            request,
            progress,
            job.created_at,
            job.traceparent.as_deref(),
            job.client_id,
        )
        .execute(&self.pool)
        .await
        .context("start a background routine draft")?;
        Ok(began.rows_affected() > 0)
    }

    async fn started(
        &self,
        owner: &MacroUserIdStr<'static>,
        client_id: Uuid,
    ) -> Result<Option<DraftJob>> {
        let row = sqlx::query!(
            r#"
            SELECT session_id, request, progress, created_at, state, result, finished_at
            FROM scheduled_action_draft
            WHERE owner_id = $1 AND client_id = $2 AND state IN ('drafting', 'ready', 'failed')
            "#,
            owner.as_ref(),
            client_id,
        )
        .fetch_optional(&self.pool)
        .await
        .context("find a started routine draft")?;
        Ok(row.and_then(|row| {
            stored_job(
                row.session_id,
                row.request,
                row.progress,
                row.created_at,
                row.state,
                row.result,
                row.finished_at,
            )
        }))
    }

    async fn drafting(&self, owner: &MacroUserIdStr<'static>) -> Result<u32> {
        let drafting = sqlx::query_scalar!(
            r#"
            SELECT count(*) AS "drafting!" FROM scheduled_action_draft
            WHERE owner_id = $1 AND state = 'drafting'
            "#,
            owner.as_ref(),
        )
        .fetch_one(&self.pool)
        .await
        .context("count a person's routine drafts")?;
        Ok(u32::try_from(drafting).unwrap_or(u32::MAX))
    }

    async fn progress(&self, session: Uuid, progress: &DraftJobProgress) -> Result<bool> {
        let progress = serde_json::to_value(progress).context("encode a draft's progress")?;
        let updated = sqlx::query!(
            r#"
            UPDATE scheduled_action_draft SET progress = $2
            WHERE session_id = $1 AND state = 'drafting'
            "#,
            session,
            progress,
        )
        .execute(&self.pool)
        .await
        .context("keep a draft's progress")?;
        Ok(updated.rows_affected() > 0)
    }

    async fn finish_job(&self, session: Uuid, draft: &Draft) -> Result<Finished> {
        let result = serde_json::to_value(draft).context("encode a draft")?;
        let phase = DraftJobPhase::finished(draft);
        let finished = sqlx::query!(
            r#"
            UPDATE scheduled_action_draft SET state = $2, result = $3, finished_at = now()
            WHERE session_id = $1 AND state = 'drafting'
            "#,
            session,
            phase.as_ref(),
            result,
        )
        .execute(&self.pool)
        .await
        .context("finish a background routine draft")?;
        if finished.rows_affected() > 0 {
            return Ok(Finished::Written);
        }
        let state = sqlx::query_scalar!(
            "SELECT state FROM scheduled_action_draft WHERE session_id = $1",
            session,
        )
        .fetch_optional(&self.pool)
        .await
        .context("read a background routine draft's state")?
        .flatten();
        Ok(match state.as_deref() {
            Some("cancelled") => Finished::Cancelled,
            _ => Finished::Gone,
        })
    }

    async fn jobs(&self, owner: &MacroUserIdStr<'static>, limit: u16) -> Result<Vec<DraftJob>> {
        let rows = sqlx::query!(
            r#"
            SELECT session_id, request, progress, created_at, state, result, finished_at
            FROM scheduled_action_draft
            WHERE owner_id = $1 AND state IN ('drafting', 'ready', 'failed')
            ORDER BY created_at DESC
            LIMIT $2
            "#,
            owner.as_ref(),
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await
        .context("list a person's routine drafts")?;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                stored_job(
                    row.session_id,
                    row.request,
                    row.progress,
                    row.created_at,
                    row.state,
                    row.result,
                    row.finished_at,
                )
            })
            .collect())
    }

    async fn job(
        &self,
        owner: &MacroUserIdStr<'static>,
        session: Uuid,
    ) -> Result<Option<DraftJob>> {
        let row = sqlx::query!(
            r#"
            SELECT session_id, request, progress, created_at, state, result, finished_at
            FROM scheduled_action_draft
            WHERE session_id = $1 AND owner_id = $2 AND state IN ('drafting', 'ready', 'failed')
            "#,
            session,
            owner.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await
        .context("read a routine draft")?;
        Ok(row.and_then(|row| {
            stored_job(
                row.session_id,
                row.request,
                row.progress,
                row.created_at,
                row.state,
                row.result,
                row.finished_at,
            )
        }))
    }

    async fn cancel_job(
        &self,
        owner: &MacroUserIdStr<'static>,
        session: Uuid,
    ) -> Result<Option<CancelledJob>> {
        // A finished job keeps its finish time, which says so.
        let row = sqlx::query!(
            r#"
            UPDATE scheduled_action_draft SET state = 'cancelled'
            WHERE session_id = $1 AND owner_id = $2 AND state IN ('drafting', 'ready', 'failed')
            RETURNING finished_at IS NOT NULL AS "finished!", bot_id, progress, traceparent
            "#,
            session,
            owner.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await
        .context("cancel a routine draft")?;
        Ok(row.map(|row| CancelledJob {
            finished: row.finished,
            agent: bot_id::BotId::new_from_uuid(row.bot_id),
            progress: read_progress(row.progress),
            traceparent: row.traceparent,
        }))
    }

    async fn interrupt(
        &self,
        before: DateTime<Utc>,
        draft: &Draft,
        limit: u16,
    ) -> Result<Vec<InterruptedJob>> {
        let result = serde_json::to_value(draft).context("encode a draft")?;
        let phase = DraftJobPhase::finished(draft);
        // Locked rows are another replica's to fail.
        let rows = sqlx::query!(
            r#"
            UPDATE scheduled_action_draft SET state = $2, result = $3, finished_at = now()
            WHERE session_id IN (
                SELECT session_id FROM scheduled_action_draft
                WHERE state = 'drafting' AND created_at < $1
                ORDER BY created_at
                LIMIT $4
                FOR UPDATE SKIP LOCKED
            )
            RETURNING session_id, owner_id, bot_id, progress, traceparent
            "#,
            before,
            phase.as_ref(),
            result,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await
        .context("interrupt routine drafts whose drafter is gone")?;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                Some(InterruptedJob {
                    draft: stale_draft(row.session_id, row.owner_id, row.bot_id)?,
                    progress: read_progress(row.progress),
                    traceparent: row.traceparent,
                })
            })
            .collect())
    }

    async fn abandoned(&self, before: DateTime<Utc>, limit: u16) -> Result<Vec<StaleDraft>> {
        let rows = sqlx::query!(
            r#"
            SELECT session_id, owner_id, bot_id FROM scheduled_action_draft
            WHERE state = 'cancelled' AND created_at < $1 ORDER BY created_at LIMIT $2
            "#,
            before,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await
        .context("list abandoned routine drafts")?;
        Ok(rows
            .into_iter()
            .filter_map(|row| stale_draft(row.session_id, row.owner_id, row.bot_id))
            .collect())
    }

    async fn expired(&self, before: DateTime<Utc>, limit: u16) -> Result<Vec<StaleDraft>> {
        let rows = sqlx::query!(
            r#"
            SELECT session_id, owner_id, bot_id FROM scheduled_action_draft
            WHERE state IN ('ready', 'failed') AND finished_at < $1
            ORDER BY finished_at LIMIT $2
            "#,
            before,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await
        .context("list expired routine drafts")?;
        Ok(rows
            .into_iter()
            .filter_map(|row| stale_draft(row.session_id, row.owner_id, row.bot_id))
            .collect())
    }
}
