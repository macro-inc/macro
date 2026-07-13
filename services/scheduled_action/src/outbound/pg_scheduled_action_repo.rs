use anyhow::{Result, bail};
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use sqlx::PgPool;
use std::str::FromStr;

use crate::domain::models::{
    ActionExecutionRecord, ActionKind, AlreadyRunningError, MAX_ACTION_TIME, Schedule,
    ScheduledAction,
};
use crate::domain::ports::ScheduledActionRepo;

pub struct PgScheduledActionRepo {
    pool: PgPool,
}

impl PgScheduledActionRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn parse_timezone(s: &str) -> Result<Tz> {
    Tz::from_str(s).map_err(|e| anyhow::anyhow!("invalid timezone: {e}"))
}

fn parse_kind(s: &str) -> Result<ActionKind> {
    match s {
        "Agent" => Ok(ActionKind::Agent),
        other => bail!("unknown action kind: {other}"),
    }
}

fn kind_to_str(kind: &ActionKind) -> &'static str {
    match kind {
        ActionKind::Agent => "Agent",
    }
}

impl ScheduledActionRepo for PgScheduledActionRepo {
    async fn create_action(&self, action: ScheduledAction) -> Result<ScheduledAction> {
        let owner = action.owner.to_string();
        let timezone = action.timezone.to_string();
        let kind = kind_to_str(&action.kind);

        let row = sqlx::query!(
            r#"
            INSERT INTO scheduled_action (owner, name, schedule, kind, timezone, task, next_run_at, enabled)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id, owner, name, schedule, kind, timezone, task, claimed, created_at, updated_at, next_run_at, enabled
            "#,
            owner,
            action.name,
            action.schedule.as_str(),
            kind,
            timezone,
            action.task,
            action.next_run_at,
            action.enabled,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(ScheduledAction {
            id: Some(row.id),
            owner: MacroUserIdStr::parse_from_str(&row.owner)?.into_owned(),
            name: row.name,
            schedule: Schedule::from_cron(row.schedule)?,
            kind: parse_kind(&row.kind)?,
            created_at: row.created_at,
            updated_at: row.updated_at,
            timezone: parse_timezone(&row.timezone)?,
            task: row.task,
            claimed: row.claimed,
            next_run_at: row.next_run_at,
            enabled: row.enabled,
        })
    }

    async fn get_actions(&self, user_id: MacroUserIdStr<'static>) -> Result<Vec<ScheduledAction>> {
        let owner = user_id.to_string();

        let rows = sqlx::query!(
            r#"
            SELECT id, owner, name, schedule, kind, timezone, task, claimed, created_at, updated_at, next_run_at, enabled
            FROM scheduled_action
            WHERE owner = $1
            "#,
            owner,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(ScheduledAction {
                    id: Some(row.id),
                    owner: MacroUserIdStr::parse_from_str(&row.owner)?.into_owned(),
                    name: row.name,
                    schedule: Schedule::from_cron(row.schedule)?,
                    kind: parse_kind(&row.kind)?,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    timezone: parse_timezone(&row.timezone)?,
                    task: row.task,
                    claimed: row.claimed,
                    next_run_at: row.next_run_at,
                    enabled: row.enabled,
                })
            })
            .collect()
    }

    async fn get_next_unclaimed_actions(&self, limit: i64) -> Result<Vec<ScheduledAction>> {
        let stale_threshold = Utc::now() - MAX_ACTION_TIME;

        let rows = sqlx::query!(
            r#"
            SELECT id, owner, name, schedule, kind, timezone, task, claimed, created_at, updated_at, next_run_at, enabled
            FROM scheduled_action
            WHERE enabled
              AND (claimed IS NULL OR claimed < $1)
            ORDER BY next_run_at ASC
            LIMIT $2
            "#,
            stale_threshold,
            limit,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(ScheduledAction {
                    id: Some(row.id),
                    owner: MacroUserIdStr::parse_from_str(&row.owner)?.into_owned(),
                    name: row.name,
                    schedule: Schedule::from_cron(row.schedule)?,
                    kind: parse_kind(&row.kind)?,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    timezone: parse_timezone(&row.timezone)?,
                    task: row.task,
                    claimed: row.claimed,
                    next_run_at: row.next_run_at,
                    enabled: row.enabled,
                })
            })
            .collect()
    }

    async fn update_action(&self, action: ScheduledAction) -> Result<ScheduledAction> {
        let Some(id) = action.id else {
            bail!("cannot update action without id");
        };
        let timezone = action.timezone.to_string();
        let kind = kind_to_str(&action.kind);

        let row = sqlx::query!(
            r#"
            UPDATE scheduled_action
            SET name = $1,
                schedule = $2,
                kind = $3,
                timezone = $4,
                task = $5,
                next_run_at = $6,
                enabled = $7,
                updated_at = now()
            WHERE id = $8
            RETURNING id, owner, name, schedule, kind, timezone, task, claimed, created_at, updated_at, next_run_at, enabled
            "#,
            action.name,
            action.schedule.as_str(),
            kind,
            timezone,
            action.task,
            action.next_run_at,
            action.enabled,
            id,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(ScheduledAction {
            id: Some(row.id),
            owner: MacroUserIdStr::parse_from_str(&row.owner)?.into_owned(),
            name: row.name,
            schedule: Schedule::from_cron(row.schedule)?,
            kind: parse_kind(&row.kind)?,
            created_at: row.created_at,
            updated_at: row.updated_at,
            timezone: parse_timezone(&row.timezone)?,
            task: row.task,
            claimed: row.claimed,
            next_run_at: row.next_run_at,
            enabled: row.enabled,
        })
    }

    async fn delete_action(
        &self,
        id: &Uuid,
        _macro_user_id: MacroUserIdStr<'static>,
    ) -> Result<()> {
        sqlx::query!(
            r#"
            DELETE FROM scheduled_action
            WHERE id = $1
            "#,
            *id
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn claim_action(&self, id: &Uuid) -> Result<()> {
        let now = Utc::now();
        let stale_threshold = now - MAX_ACTION_TIME;

        let result = sqlx::query!(
            r#"
            UPDATE scheduled_action
            SET claimed = $1, updated_at = now()
            WHERE id = $2
              AND (claimed IS NULL OR claimed < $3)
            "#,
            now,
            *id,
            stale_threshold,
        )
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(anyhow::Error::new(AlreadyRunningError { action_id: *id }));
        }

        Ok(())
    }

    async fn release_action(&self, id: &Uuid) -> Result<()> {
        sqlx::query!(
            r#"
            UPDATE scheduled_action
            SET claimed = NULL, updated_at = now()
            WHERE id = $1
            "#,
            *id,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn create_execution_record(&self, record: ActionExecutionRecord) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO action_execution_record (action_id, resource_id, start_time, end_time, is_success, result)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
            record.action_id,
            record.resource_id,
            record.start_time,
            record.end_time,
            record.is_success,
            record.result,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn get_execution_records(&self, action_id: &Uuid) -> Result<Vec<ActionExecutionRecord>> {
        let rows = sqlx::query!(
            r#"
            SELECT id, action_id, resource_id, start_time, end_time, is_success, result, created_at
            FROM action_execution_record
            WHERE action_id = $1
            ORDER BY start_time DESC
            "#,
            *action_id,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| ActionExecutionRecord {
                id: Some(row.id),
                action_id: row.action_id,
                resource_id: row.resource_id,
                start_time: row.start_time,
                end_time: row.end_time,
                is_success: row.is_success,
                result: row.result,
                created_at: row.created_at,
            })
            .collect())
    }

    async fn update_next_run_at(&self, id: &Uuid) -> Result<()> {
        // Fetch the schedule + timezone so we can recompute `next_run_at`
        // without the caller having to hold the action in memory.
        let row = sqlx::query!(
            r#"
            SELECT schedule, timezone
            FROM scheduled_action
            WHERE id = $1
            "#,
            *id,
        )
        .fetch_one(&self.pool)
        .await?;

        let tz = parse_timezone(&row.timezone)?;
        let schedule = Schedule::from_cron(row.schedule)?;
        let Some(next_run_at) = schedule.next_run_after_now(tz) else {
            // No future fire time — leave next_run_at untouched.
            return Ok(());
        };

        sqlx::query!(
            r#"
            UPDATE scheduled_action
            SET next_run_at = $1, updated_at = now()
            WHERE id = $2
            "#,
            next_run_at,
            *id,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn update_last_executed(&self, id: &Uuid, executed_at: DateTime<Utc>) -> Result<()> {
        sqlx::query!(
            r#"
            UPDATE scheduled_action
            SET updated_at = $1
            WHERE id = $2
            "#,
            executed_at,
            *id,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
