use anyhow::{Context, Result, bail};
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use entity_registry_db_utils::{
    InsertOutcome, NewEntityRecord, RegisteredEntityType, WriteOutcome, delete_entity,
    insert_entity,
};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::{Uuid, generate_uuid_v7};
use model_owner::Owner;
use serde_json::Value;
use sqlx::PgPool;
use std::str::FromStr;

use crate::domain::event_runs::{ClaimToken, ConfigurationRevision};
use crate::domain::event_trigger::ActionTrigger;
use crate::domain::models::{
    ActionExecutionRecord, ActionKind, ActionPolicyError, AlreadyRunningError, MAX_ACTION_TIME,
    Schedule, ScheduledAction,
};
use crate::domain::ports::ScheduledActionRepo;

#[cfg(test)]
mod test;

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

/// One mapping for every action query, including management and dispatch.
struct ActionRow {
    id: Uuid,
    owner: String,
    name: String,
    schedule: Option<String>,
    kind: String,
    timezone: Option<String>,
    task: Value,
    claimed: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    next_run_at: Option<DateTime<Utc>>,
    enabled: bool,
    trigger_type: String,
    event_filters: Option<Value>,
    configuration_revision: i64,
    event_activated_at: Option<DateTime<Utc>>,
}

impl TryFrom<ActionRow> for ScheduledAction {
    type Error = anyhow::Error;

    fn try_from(row: ActionRow) -> Result<Self> {
        let trigger = match row.trigger_type.as_str() {
            "cron" => ActionTrigger::Cron {
                schedule: Schedule::from_cron(row.schedule.context("cron schedule missing")?)?,
                timezone: parse_timezone(&row.timezone.context("cron timezone missing")?)?,
            },
            "events" => ActionTrigger::Events {
                filters: serde_json::from_value(
                    row.event_filters.context("event filters missing")?,
                )?,
            },
            other => bail!("unknown action trigger: {other}"),
        };
        Ok(Self {
            id: Some(row.id),
            owner: Owner::from_principal_str(&row.owner)?,
            name: row.name,
            trigger,
            kind: parse_kind(&row.kind)?,
            created_at: row.created_at,
            updated_at: row.updated_at,
            task: row.task,
            claimed: row.claimed,
            next_run_at: row.next_run_at,
            enabled: row.enabled,
            configuration_revision: ConfigurationRevision::try_from(row.configuration_revision)?,
            event_activated_at: row.event_activated_at,
        })
    }
}

struct TriggerColumns {
    trigger_type: &'static str,
    schedule: Option<String>,
    timezone: Option<String>,
    event_filters: Option<Value>,
}

impl TryFrom<&ActionTrigger> for TriggerColumns {
    type Error = anyhow::Error;

    fn try_from(trigger: &ActionTrigger) -> Result<Self> {
        match trigger {
            ActionTrigger::Cron { schedule, timezone } => Ok(Self {
                trigger_type: "cron",
                schedule: Some(schedule.as_str().to_owned()),
                timezone: Some(timezone.to_string()),
                event_filters: None,
            }),
            ActionTrigger::Events { filters } => Ok(Self {
                trigger_type: "events",
                schedule: None,
                timezone: None,
                event_filters: Some(serde_json::to_value(filters)?),
            }),
        }
    }
}

impl ScheduledActionRepo for PgScheduledActionRepo {
    async fn create_action(&self, action: ScheduledAction) -> Result<ScheduledAction> {
        let id = generate_uuid_v7();
        let owner = action.owner.principal_id();
        let trigger = TriggerColumns::try_from(&action.trigger)?;
        let kind = kind_to_str(&action.kind);

        let mut tx = self.pool.begin().await?;
        let row = sqlx::query_as!(
            ActionRow,
            r#"
            INSERT INTO scheduled_action
                (id, owner, name, schedule, kind, timezone, task, next_run_at, enabled,
                 trigger_type, event_filters, configuration_revision, event_activated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id, owner, name, schedule, kind, timezone, task, claimed, created_at,
                      updated_at, next_run_at, enabled, trigger_type, event_filters,
                      configuration_revision, event_activated_at
            "#,
            id,
            owner,
            action.name,
            trigger.schedule,
            kind,
            trigger.timezone,
            action.task,
            action.next_run_at,
            action.enabled,
            trigger.trigger_type,
            trigger.event_filters,
            action.configuration_revision.get(),
            action.event_activated_at,
        )
        .fetch_one(&mut *tx)
        .await?;

        let created = ScheduledAction::try_from(row)?;
        match insert_entity(
            &mut tx,
            NewEntityRecord::new(
                id,
                RegisteredEntityType::ScheduledAction,
                created.owner.clone(),
            ),
        )
        .await?
        {
            InsertOutcome::Inserted | InsertOutcome::AlreadyRegistered => {}
        }
        tx.commit().await?;
        Ok(created)
    }

    async fn get_actions(&self, user_id: MacroUserIdStr<'static>) -> Result<Vec<ScheduledAction>> {
        let owner = user_id.to_string();
        let rows = sqlx::query_as!(
            ActionRow,
            r#"
            SELECT id, owner, name, schedule, kind, timezone, task, claimed, created_at,
                   updated_at, next_run_at, enabled, trigger_type, event_filters,
                   configuration_revision, event_activated_at
            FROM scheduled_action
            WHERE owner = $1
            "#,
            owner,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(ScheduledAction::try_from).collect()
    }

    async fn get_action(
        &self,
        id: &Uuid,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Option<ScheduledAction>> {
        let owner = user_id.to_string();
        sqlx::query_as!(
            ActionRow,
            r#"
            SELECT id, owner, name, schedule, kind, timezone, task, claimed, created_at,
                   updated_at, next_run_at, enabled, trigger_type, event_filters,
                   configuration_revision, event_activated_at
            FROM scheduled_action
            WHERE id = $1 AND owner = $2
            "#,
            *id,
            owner,
        )
        .fetch_optional(&self.pool)
        .await?
        .map(ScheduledAction::try_from)
        .transpose()
    }

    async fn get_next_unclaimed_actions(&self, limit: i64) -> Result<Vec<ScheduledAction>> {
        let stale_threshold = Utc::now() - MAX_ACTION_TIME;
        let rows = sqlx::query_as!(
            ActionRow,
            r#"
            SELECT id, owner, name, schedule, kind, timezone, task, claimed, created_at,
                   updated_at, next_run_at, enabled, trigger_type, event_filters,
                   configuration_revision, event_activated_at
            FROM scheduled_action
            WHERE enabled AND trigger_type = 'cron'
              AND (claimed IS NULL OR claimed < $1)
            ORDER BY next_run_at ASC, id ASC
            LIMIT $2
            "#,
            stale_threshold,
            limit,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(ScheduledAction::try_from).collect()
    }

    async fn update_action(&self, action: ScheduledAction) -> Result<ScheduledAction> {
        let Some(id) = action.id else {
            bail!("cannot update action without id");
        };
        let owner = action.owner.principal_id();
        let trigger = TriggerColumns::try_from(&action.trigger)?;
        let kind = kind_to_str(&action.kind);
        let row = sqlx::query_as!(
            ActionRow,
            r#"
            UPDATE scheduled_action
            SET name = $1,
                schedule = $2,
                kind = $3,
                timezone = $4,
                task = $5,
                next_run_at = $6,
                enabled = $7,
                trigger_type = $8,
                event_filters = $9,
                configuration_revision = $10,
                event_activated_at = $11,
                updated_at = now()
            WHERE id = $12 AND owner = $13
              AND configuration_revision = $10::bigint - 1
              AND (
                  claimed IS NULL OR claimed < $14
                  OR (
                      NOT $7 AND name = $1 AND kind = $3 AND task = $5
                      AND trigger_type = $8
                      AND schedule IS NOT DISTINCT FROM $2
                      AND timezone IS NOT DISTINCT FROM $4
                      AND event_filters IS NOT DISTINCT FROM $9
                  )
              )
            RETURNING id, owner, name, schedule, kind, timezone, task, claimed, created_at,
                      updated_at, next_run_at, enabled, trigger_type, event_filters,
                      configuration_revision, event_activated_at
            "#,
            action.name,
            trigger.schedule,
            kind,
            trigger.timezone,
            action.task,
            action.next_run_at,
            action.enabled,
            trigger.trigger_type,
            trigger.event_filters,
            action.configuration_revision.get(),
            action.event_activated_at,
            id,
            owner,
            Utc::now() - MAX_ACTION_TIME,
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or(ActionPolicyError::UpdateConflict)?;
        ScheduledAction::try_from(row)
    }

    async fn delete_action(&self, id: &Uuid, macro_user_id: MacroUserIdStr<'static>) -> Result<()> {
        let owner = macro_user_id.to_string();
        let mut tx = self.pool.begin().await?;
        let deleted = sqlx::query!(
            r#"
            DELETE FROM scheduled_action
            WHERE id = $1 AND owner = $2
            "#,
            *id,
            owner,
        )
        .execute(&mut *tx)
        .await?;

        if deleted.rows_affected() != 0 {
            match delete_entity(&mut tx, *id).await? {
                WriteOutcome::Applied | WriteOutcome::NotFound => {}
            }
        }
        tx.commit().await?;
        Ok(())
    }

    async fn claim_action(&self, id: &Uuid) -> Result<ClaimToken> {
        let token = ClaimToken::generate();
        let now = Utc::now();
        let stale_threshold = now - MAX_ACTION_TIME;

        let result = sqlx::query!(
            r#"
            UPDATE scheduled_action
            SET claimed = $1, claim_token = $4, updated_at = now()
            WHERE id = $2
              AND (claimed IS NULL OR claimed < $3)
            "#,
            now,
            *id,
            stale_threshold,
            token.as_uuid(),
        )
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(anyhow::Error::new(AlreadyRunningError { action_id: *id }));
        }

        Ok(token)
    }

    async fn release_action(&self, id: &Uuid, token: ClaimToken) -> Result<()> {
        sqlx::query!(
            r#"
            UPDATE scheduled_action
            SET claimed = NULL, claim_token = NULL, updated_at = now()
            WHERE id = $1 AND claim_token = $2
            "#,
            *id,
            token.as_uuid(),
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
        // Lock through the update so a concurrent trigger replacement cannot
        // receive a firing time derived from the old schedule.
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query!(
            r#"
            SELECT schedule, timezone, trigger_type
            FROM scheduled_action
            WHERE id = $1
            FOR UPDATE
            "#,
            *id,
        )
        .fetch_one(&mut *tx)
        .await?;

        if row.trigger_type == "cron" {
            let tz = parse_timezone(&row.timezone.context("cron timezone missing")?)?;
            let schedule = Schedule::from_cron(row.schedule.context("cron schedule missing")?)?;
            if let Some(next_run_at) = schedule.next_run_after_now(tz) {
                sqlx::query!(
                    r#"
                    UPDATE scheduled_action
                    SET next_run_at = $1, updated_at = now()
                    WHERE id = $2 AND trigger_type = 'cron'
                    "#,
                    next_run_at,
                    *id,
                )
                .execute(&mut *tx)
                .await?;
            }
        }
        tx.commit().await?;
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
