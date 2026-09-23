//! Durable event admission and fenced execution bookkeeping.
//!
//! Every mutation locks the action before its runs. This serializes admission,
//! configuration changes and manual/event claims without locking other actions.

use chrono::{DateTime, Utc};
use macro_uuid::{Uuid, generate_uuid_v7};
use model_owner::Owner;
use rootcause::{Report, bail};
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Transaction};

use crate::domain::event_runs::{
    AdmissionResult, AuthorizedEventRun, CancellationReason, CandidateActionPage, ClaimToken,
    ClaimedEventRun, ConfigurationRevision, EventActionConfiguration, EventRunKey, EventRunOutcome,
    EventRunRepository, FinalizationResult, FinalizeEventRun, PageSize, PendingEventRun,
};
use crate::domain::event_trigger::{ActionTrigger, EventReference};
use crate::domain::models::{MAX_ACTION_TIME, ScheduledAction};

#[cfg(test)]
mod test;

/// PostgreSQL implementation of the durable queue port. Authorization is the
/// caller's responsibility; selectors and queue entries are not access grants.
#[derive(Clone)]
pub struct PgEventRunRepo {
    pool: PgPool,
}

impl PgEventRunRepo {
    /// Construct at the composition root with the shared MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

struct ConfigurationRow {
    action_id: Uuid,
    owner: String,
    enabled: bool,
    configuration_revision: i64,
    event_filters: Value,
    event_activated_at: DateTime<Utc>,
}

/// Deliberately excludes persisted content and underlying parser errors.
#[derive(Debug, thiserror::Error)]
enum InvalidConfiguration {
    #[error("invalid_owner")]
    Owner,
    #[error("invalid_revision")]
    Revision,
    #[error("invalid_filters")]
    Filters,
}

impl TryFrom<ConfigurationRow> for EventActionConfiguration {
    type Error = InvalidConfiguration;

    fn try_from(row: ConfigurationRow) -> Result<Self, Self::Error> {
        Ok(Self {
            action_id: row.action_id,
            owner: Owner::from_principal_str(&row.owner)
                .map_err(|_| InvalidConfiguration::Owner)?,
            enabled: row.enabled,
            revision: row
                .configuration_revision
                .try_into()
                .map_err(|_| InvalidConfiguration::Revision)?,
            filters: serde_json::from_value(row.event_filters)
                .map_err(|_| InvalidConfiguration::Filters)?,
            activated_at: row.event_activated_at,
        })
    }
}

struct PendingRow {
    action_id: Uuid,
    event_id: Uuid,
    configuration_revision: i64,
    event_context: Value,
    admitted_at: DateTime<Utc>,
}

impl TryFrom<PendingRow> for PendingEventRun {
    type Error = Report;

    fn try_from(mut row: PendingRow) -> Result<Self, Report> {
        row.event_context["event_id"] = json!(row.event_id);
        Ok(Self {
            action_id: row.action_id,
            revision: row.configuration_revision.try_into()?,
            event: serde_json::from_value(row.event_context)?,
            admitted_at: row.admitted_at,
        })
    }
}

/// All paths use this lock order, including cancellation and maintenance. Skip
/// locked actions rather than holding a worker behind another routine's work.
async fn lock_action(tx: &mut Transaction<'_, Postgres>, action_id: Uuid) -> Result<bool, Report> {
    Ok(sqlx::query_scalar!(
        "SELECT id FROM scheduled_action WHERE id = $1 FOR UPDATE SKIP LOCKED",
        action_id,
    )
    .fetch_optional(&mut **tx)
    .await?
    .is_some())
}

impl EventRunRepository for PgEventRunRepo {
    async fn candidate_actions(
        &self,
        event: &EventReference,
        after: Option<Uuid>,
        limit: PageSize,
    ) -> Result<CandidateActionPage, Report> {
        let rows = sqlx::query_as!(
            ConfigurationRow,
            r#"
            SELECT id AS action_id, owner, enabled, configuration_revision,
                   event_filters AS "event_filters!", event_activated_at AS "event_activated_at!"
            FROM scheduled_action
            WHERE enabled AND trigger_type = 'events'
              AND ($1::uuid IS NULL OR id > $1)
              AND event_activated_at <= $2
              AND event_filters @> jsonb_build_array(jsonb_build_object('events', jsonb_build_array($3::text)))
              AND jsonb_path_exists(event_filters,
                  '$[*] ? (@.events[*] == $event && (!exists (@.ids) || @.ids == null || @.ids[*] == $id))',
                  jsonb_build_object('event', $3::text, 'id', $4::text))
            ORDER BY id
            LIMIT $5
            "#,
            after,
            event.published_at(),
            event.event_name().as_str(),
            event.entity_id().to_string(),
            i64::from(limit.get()),
        )
        .fetch_all(&self.pool)
        .await?;
        let next_after = rows.last().map(|row| row.action_id);
        let mut configurations = Vec::with_capacity(rows.len());
        for row in rows {
            let action_id = row.action_id;
            match row.try_into() {
                Ok(configuration) => configurations.push(configuration),
                Err(error) => tracing::warn!(
                    %action_id,
                    classification = %error,
                    "invalid event configuration skipped"
                ),
            }
        }
        Ok(CandidateActionPage {
            configurations,
            next_after,
        })
    }

    async fn current_configuration(
        &self,
        action_id: Uuid,
    ) -> Result<Option<EventActionConfiguration>, Report> {
        Ok(sqlx::query_as!(
            ConfigurationRow,
            r#"
            SELECT id AS action_id, owner, enabled, configuration_revision,
                   event_filters AS "event_filters!", event_activated_at AS "event_activated_at!"
            FROM scheduled_action WHERE id = $1 AND trigger_type = 'events'
            "#,
            action_id,
        )
        .fetch_optional(&self.pool)
        .await?
        .map(TryInto::try_into)
        .transpose()?)
    }

    async fn admit(
        &self,
        action_id: Uuid,
        revision: ConfigurationRevision,
        event: &EventReference,
    ) -> Result<AdmissionResult, Report> {
        let mut tx = self.pool.begin().await?;
        // Unlike dispatch, intake must wait: skipping a locked row would permit
        // Kafka acknowledgment without durable admission.
        let eligible = sqlx::query_scalar!(
            r#"
            SELECT id FROM scheduled_action
            WHERE id = $1 AND enabled AND trigger_type = 'events'
              AND configuration_revision = $2 AND event_activated_at <= $3
              AND jsonb_path_exists(event_filters,
                  '$[*] ? (@.events[*] == $event && (!exists (@.ids) || @.ids == null || @.ids[*] == $id))',
                  jsonb_build_object('event', $4::text, 'id', $5::text))
            FOR UPDATE
            "#,
            action_id,
            revision.get(),
            event.published_at(),
            event.event_name().as_str(),
            event.entity_id().to_string(),
        )
        .fetch_optional(&mut *tx)
        .await?;
        if eligible.is_none() {
            return Ok(AdmissionResult::Ineligible);
        }
        let context = json!({
            "event_name": event.event_name(),
            "entity_id": event.entity_id(),
            "message_id": event.message_id(),
        });
        let inserted = sqlx::query!(
            r#"
            INSERT INTO scheduled_action_event_run (action_id, event_id, configuration_revision, event_context)
            VALUES ($1, $2, $3, $4) ON CONFLICT (action_id, event_id) DO NOTHING
            "#,
            action_id,
            event.event_id().as_uuid(),
            revision.get(),
            context,
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        if inserted.rows_affected() == 0 {
            Ok(AdmissionResult::AlreadyPresent)
        } else {
            Ok(AdmissionResult::Admitted)
        }
    }

    async fn pending_runs(&self, limit: PageSize) -> Result<Vec<PendingEventRun>, Report> {
        // Expired manual claims may be replaced, but an event claim must first
        // be reconciled to interrupted, even after its action claim expires.
        let rows = sqlx::query_as!(
            PendingRow,
            r#"
            SELECT r.action_id, r.event_id, r.configuration_revision, r.event_context, r.admitted_at
            FROM scheduled_action a
            CROSS JOIN LATERAL (
                SELECT action_id, event_id, configuration_revision, event_context, admitted_at, admission_order
                FROM scheduled_action_event_run
                WHERE action_id = a.id AND state = 'pending'
                ORDER BY admission_order LIMIT 1
            ) r
            WHERE a.enabled AND a.trigger_type = 'events'
              AND a.configuration_revision = r.configuration_revision
              AND (a.claimed IS NULL OR a.claimed < $1)
              AND NOT EXISTS (SELECT 1 FROM scheduled_action_event_run s WHERE s.action_id = a.id AND s.state = 'started')
            ORDER BY r.admission_order
            LIMIT $2 FOR UPDATE OF a SKIP LOCKED
            "#,
            Utc::now() - MAX_ACTION_TIME,
            i64::from(limit.get()),
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(TryInto::try_into).collect()
    }

    async fn claim(
        &self,
        run: AuthorizedEventRun,
        token: ClaimToken,
        started_at: DateTime<Utc>,
        deadline: DateTime<Utc>,
    ) -> Result<Option<ClaimedEventRun>, Report> {
        if deadline <= started_at
            || deadline <= Utc::now()
            || deadline > started_at + MAX_ACTION_TIME
        {
            bail!(
                "event execution deadline must be in the future and within the action claim lifetime"
            );
        }
        let mut tx = self.pool.begin().await?;
        let key = run.pending.key();
        if !lock_action(&mut tx, key.action_id).await? {
            return Ok(None);
        }
        let action = sqlx::query!(
            r#"
            SELECT id, owner, name, kind, task, created_at, updated_at, enabled,
                   event_filters AS "event_filters!", event_activated_at AS "event_activated_at!"
            FROM scheduled_action
            WHERE id = $1 AND enabled AND trigger_type = 'events' AND configuration_revision = $2
              AND (claimed IS NULL OR claimed < $3)
              AND NOT EXISTS (SELECT 1 FROM scheduled_action_event_run WHERE action_id = $1 AND state = 'started')
            "#,
            key.action_id,
            run.pending.revision.get(),
            Utc::now() - MAX_ACTION_TIME,
        )
        .fetch_optional(&mut *tx)
        .await?;
        let Some(action) = action else {
            // Drop only queues rollback. Release the action lock before returning
            // so an immediate SKIP LOCKED reconciliation can observe this action.
            tx.rollback().await?;
            return Ok(None);
        };
        let pending = sqlx::query_as!(
            PendingRow,
            r#"
            SELECT action_id, event_id, configuration_revision, event_context, admitted_at
            FROM scheduled_action_event_run
            WHERE action_id = $1 AND state = 'pending'
            ORDER BY admission_order LIMIT 1 FOR UPDATE
            "#,
            key.action_id,
        )
        .fetch_optional(&mut *tx)
        .await?;
        let Some(pending) = pending else {
            tx.rollback().await?;
            return Ok(None);
        };
        let pending = PendingEventRun::try_from(pending)?;
        // Bind the authorized snapshot to the actual durable head, not merely
        // to an action ID supplied by a caller.
        if pending.key() != key
            || pending.revision != run.pending.revision
            || pending.event != run.pending.event
        {
            tx.rollback().await?;
            return Ok(None);
        }
        let action = ScheduledAction {
            id: Some(action.id),
            owner: Owner::from_principal_str(&action.owner)?,
            name: action.name,
            trigger: ActionTrigger::Events {
                filters: serde_json::from_value(action.event_filters)?,
            },
            kind: serde_json::from_value(json!(action.kind))?,
            task: action.task,
            created_at: action.created_at,
            updated_at: action.updated_at,
            enabled: action.enabled,
            configuration_revision: pending.revision,
            event_activated_at: Some(action.event_activated_at),
            next_run_at: None,
            claimed: Some(started_at),
        };
        sqlx::query!(
            "UPDATE scheduled_action SET claimed = $2, claim_token = $3, updated_at = now() WHERE id = $1",
            key.action_id,
            started_at,
            token.as_uuid(),
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query!(
            r#"
            UPDATE scheduled_action_event_run
            SET state = 'started', claim_token = $3, started_at = $4, deadline = $5
            WHERE action_id = $1 AND event_id = $2 AND state = 'pending'
            "#,
            key.action_id,
            key.event_id.as_uuid(),
            token.as_uuid(),
            started_at,
            deadline,
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(Some(ClaimedEventRun {
            run: AuthorizedEventRun {
                pending,
                access: run.access,
            },
            action,
            token,
            started_at,
            deadline,
        }))
    }

    async fn finalize(&self, run: FinalizeEventRun) -> Result<FinalizationResult, Report> {
        let mut tx = self.pool.begin().await?;
        // Bookkeeping retries wait for other bookkeeping, rather than reporting
        // a spurious stale token just because its action is locked.
        let action = sqlx::query!(
            "SELECT claim_token FROM scheduled_action WHERE id = $1 FOR UPDATE",
            run.key.action_id,
        )
        .fetch_optional(&mut *tx)
        .await?;
        let Some(action) = action else {
            return Ok(FinalizationResult::StaleClaim);
        };
        let stored = sqlx::query!(
            r#"
            SELECT state, claim_token FROM scheduled_action_event_run
            WHERE action_id = $1 AND event_id = $2 FOR UPDATE
            "#,
            run.key.action_id,
            run.key.event_id.as_uuid(),
        )
        .fetch_optional(&mut *tx)
        .await?;
        let Some(stored) = stored else {
            return Ok(FinalizationResult::StaleClaim);
        };
        if stored.claim_token != Some(run.token.as_uuid()) {
            return Ok(FinalizationResult::StaleClaim);
        }
        if stored.state == "finished" {
            return Ok(FinalizationResult::AlreadyFinalized);
        }
        // Delayed bookkeeping may still finish its own claim. Reconciliation
        // uses the same lock: whichever terminal transition commits first wins.
        if stored.state != "started" || action.claim_token != stored.claim_token {
            return Ok(FinalizationResult::StaleClaim);
        }
        let mut execution_record_id = None;
        if let Some(record) = run.execution.record {
            if record.action_id != run.key.action_id {
                bail!("execution record belongs to another action");
            }
            let id = generate_uuid_v7();
            execution_record_id = Some(sqlx::query_scalar!(
                r#"
                INSERT INTO action_execution_record
                    (id, action_id, resource_id, start_time, end_time, is_success, result, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (id) DO NOTHING RETURNING id
                "#,
                id,
                run.key.action_id,
                record.resource_id,
                record.start_time,
                record.end_time,
                matches!(run.execution.outcome, EventRunOutcome::Succeeded),
                record.result,
                record.created_at,
            )
            .fetch_one(&mut *tx)
            .await?);
        }
        sqlx::query!(
            r#"
            UPDATE scheduled_action_event_run
            SET state = 'finished', finished_at = $3, outcome = $4, execution_record_id = $5
            WHERE action_id = $1 AND event_id = $2
            "#,
            run.key.action_id,
            run.key.event_id.as_uuid(),
            run.finished_at,
            serde_json::to_value(run.execution.outcome)?,
            execution_record_id,
        )
        .execute(&mut *tx)
        .await?;
        release_claim(&mut tx, run.key.action_id, run.token.as_uuid()).await?;
        tx.commit().await?;
        Ok(FinalizationResult::Finalized)
    }

    async fn cancel_pending(
        &self,
        key: EventRunKey,
        revision: ConfigurationRevision,
        reason: CancellationReason,
    ) -> Result<(), Report> {
        let mut tx = self.pool.begin().await?;
        sqlx::query_scalar!(
            "SELECT id FROM scheduled_action WHERE id = $1 FOR UPDATE",
            key.action_id,
        )
        .fetch_optional(&mut *tx)
        .await?;
        sqlx::query!(
            r#"
            UPDATE scheduled_action_event_run SET state = 'finished', finished_at = now(), outcome = $4
            WHERE action_id = $1 AND event_id = $2 AND configuration_revision = $3 AND state = 'pending'
            "#,
            key.action_id,
            key.event_id.as_uuid(),
            revision.get(),
            serde_json::to_value(EventRunOutcome::Cancelled { reason })?,
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    async fn reconcile(&self, now: DateTime<Utc>, limit: PageSize) -> Result<u16, Report> {
        let candidates = sqlx::query!(
            r#"
            SELECT r.action_id, r.event_id FROM scheduled_action_event_run r
            JOIN scheduled_action a ON a.id = r.action_id
            WHERE (r.state = 'started' AND r.deadline <= $1)
               OR (r.state = 'pending' AND (NOT a.enabled OR a.trigger_type <> 'events'
                   OR a.configuration_revision <> r.configuration_revision))
            ORDER BY r.admission_order LIMIT $2 FOR UPDATE OF a SKIP LOCKED
            "#,
            now,
            i64::from(limit.get()),
        )
        .fetch_all(&self.pool)
        .await?;
        let mut affected = 0;
        for candidate in candidates {
            let mut tx = self.pool.begin().await?;
            if !lock_action(&mut tx, candidate.action_id).await? {
                continue;
            }
            // Recheck under the action lock. A cancellation cannot race past
            // start, and reconciliation never overwrites a completed outcome.
            let updated = sqlx::query!(
                r#"
                UPDATE scheduled_action_event_run r
                SET state = 'finished', finished_at = $3,
                    outcome = CASE WHEN r.state = 'started' THEN $4::jsonb
                        WHEN NOT a.enabled THEN $5::jsonb ELSE $6::jsonb END
                FROM scheduled_action a
                WHERE r.action_id = $1 AND r.event_id = $2 AND a.id = r.action_id
                  AND ((r.state = 'started' AND r.deadline <= $3)
                    OR (r.state = 'pending' AND (NOT a.enabled OR a.trigger_type <> 'events'
                        OR a.configuration_revision <> r.configuration_revision)))
                RETURNING r.claim_token
                "#,
                candidate.action_id,
                candidate.event_id,
                now,
                serde_json::to_value(EventRunOutcome::Interrupted)?,
                serde_json::to_value(EventRunOutcome::Cancelled {
                    reason: CancellationReason::Disabled
                })?,
                serde_json::to_value(EventRunOutcome::Cancelled {
                    reason: CancellationReason::Superseded
                })?,
            )
            .fetch_optional(&mut *tx)
            .await?;
            if let Some(updated) = updated {
                if let Some(token) = updated.claim_token {
                    release_claim(&mut tx, candidate.action_id, token).await?;
                }
                affected += 1;
            }
            tx.commit().await?;
        }
        Ok(affected)
    }
}

async fn release_claim(
    tx: &mut Transaction<'_, Postgres>,
    action_id: Uuid,
    token: Uuid,
) -> Result<(), Report> {
    sqlx::query!(
        r#"
        UPDATE scheduled_action SET claimed = NULL, claim_token = NULL, updated_at = now()
        WHERE id = $1 AND claim_token = $2
        "#,
        action_id,
        token,
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}
