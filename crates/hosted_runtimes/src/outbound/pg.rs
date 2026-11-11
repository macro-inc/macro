//! Postgres adapter for [`ComputerRepo`].

use bot_id::BotId;
use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

use crate::domain::ids::ComputerId;
use crate::domain::image::GuestImage;
use crate::domain::lifecycle::{
    ComputerState, Context, Effect, EffectWorker, Event, HostId, Phase, TimerKind, transition,
};
use crate::domain::models::{
    Computer, ComputerRecord, Host, HostRegistration, NewComputer, SanitizedReason,
};
use crate::domain::ports::{ComputerRepo, DueTimer, PendingEffect, ReserveError};
use crate::domain::size::{ComputerResources, ComputerSize};

mod agents;
mod row;
use row::ComputerRow;

#[cfg(test)]
mod test;

/// Long-lived guards may not occupy every connection needed to persist outcomes.
const COMPUTER_GUARD_CONNECTIONS: u32 = 4;
/// Release unused guard connections between passes.
const COMPUTER_GUARD_IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// Errors from the Postgres adapter.
#[derive(Debug, thiserror::Error)]
pub enum PgComputerError {
    /// A database operation failed.
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    /// Stored computer data violates a domain contract.
    #[error("stored computer data is invalid: {0}")]
    Corrupt(String),
    /// A row violates a field rule; this diagnostic cannot contain stored values.
    #[error("{0}")]
    InvalidRow(#[from] SanitizedReason),
}

impl From<std::num::TryFromIntError> for PgComputerError {
    fn from(error: std::num::TryFromIntError) -> Self {
        Self::Corrupt(error.to_string())
    }
}

impl From<serde_json::Error> for PgComputerError {
    fn from(error: serde_json::Error) -> Self {
        Self::Corrupt(error.to_string())
    }
}

/// Postgres storage for computers, capacity and lifecycle work.
#[derive(Clone)]
pub struct PgComputerRepo {
    pool: PgPool,
    guards: PgPool,
}

impl PgComputerRepo {
    /// Build a repository with a separate pool for long-lived guards.
    pub fn new(pool: PgPool) -> Self {
        // Guards outlive provider calls; keep their waiters off the
        // pool used to persist the outcome while the guard is held.
        let guards = sqlx::postgres::PgPoolOptions::new()
            .max_connections(
                pool.options()
                    .get_max_connections()
                    .min(COMPUTER_GUARD_CONNECTIONS),
            )
            .idle_timeout(COMPUTER_GUARD_IDLE_TIMEOUT)
            .connect_lazy_with(pool.connect_options().as_ref().clone());
        Self { pool, guards }
    }
}

impl crate::domain::ports::FleetAttachmentSource for PgComputerRepo {
    type Err = PgComputerError;

    #[tracing::instrument(skip(self), err)]
    async fn attachment(
        &self,
        now: DateTime<Utc>,
    ) -> Result<crate::domain::models::FleetAttachment, Self::Err> {
        let cutoff = now - crate::domain::models::HOST_HEARTBEAT_FRESHNESS;
        let present = sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM hosted_runtime_host WHERE updated_at > $1) AS "present!""#,
            cutoff,
        ).fetch_one(&self.pool).await?;
        Ok(crate::domain::models::FleetAttachment::from_operator_present(present))
    }
}

fn units(resources: ComputerResources) -> Result<i32, PgComputerError> {
    Ok(i32::try_from(resources.units())?)
}

impl PgComputerRepo {
    /// Serialize host transitions before locking computer or timer rows.
    async fn lock_host(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        computer_id: ComputerId,
    ) -> Result<(), PgComputerError> {
        sqlx::query!(
            "SELECT host.id FROM hosted_runtime_host host JOIN hosted_runtime computer ON computer.host_id = host.id WHERE computer.id = $1 FOR UPDATE OF host",
            computer_id.as_uuid(),
        ).fetch_optional(&mut **tx).await?;
        Ok(())
    }

    /// Run the transition for a computer already locked in `tx`, and store
    /// its state, effects and timers.
    #[tracing::instrument(name = "computer.lifecycle.event", skip_all, fields(%computer_id, event, phase, team_id, size, billing_kind, otel.status_code), err)]
    async fn apply_locked(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        computer_id: ComputerId,
        event: &Event,
        now: DateTime<Utc>,
    ) -> Result<Option<Computer>, PgComputerError> {
        Self::lock_host(tx, computer_id).await?;
        let row = sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT id, team_id, host_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry, price_id, state, harness_id, created_by,
                   created_at, enrolled_at, enrollment_generation, setup_completed_at, default_agent_id, image, previous_image
            FROM hosted_runtime
            WHERE id = $1
            FOR UPDATE
            "#,
            computer_id.as_uuid(),
        )
        .fetch_optional(&mut **tx)
        .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let mut computer = Computer::try_from(row)?;
        crate::domain::telemetry::resume(computer.state.provision_traceparent.as_deref());
        let span = tracing::Span::current();
        span.record("team_id", tracing::field::display(computer.team_id));
        span.record("size", computer.size.as_ref());
        span.record(
            "billing_kind",
            if computer.state.comp_reason.is_some() {
                "comped"
            } else {
                "stripe"
            },
        );
        // Read only the enum tag; reasons and other event payloads are private.
        if let Some(tag) = serde_json::to_value(event)?
            .get("event")
            .and_then(serde_json::Value::as_str)
        {
            span.record("event", tag);
        }

        let host_has_room = match computer.state.host() {
            Some(host) => Self::host_has_room(tx, host, &computer).await?,
            None => false,
        };
        let (mut state, effects) = transition(
            &computer.state,
            event,
            Context {
                now,
                host_has_room,
                enrollment_generation: computer.enrollment_generation,
            },
        );

        for effect in effects {
            if let Effect::Create { generation, .. } = &effect {
                computer.enrollment_generation = *generation;
            }
            match effect {
                Effect::ScheduleTimer { kind, at } => {
                    sqlx::query!(
                        r#"
                        INSERT INTO hosted_runtime_timer (computer_id, kind, fire_at)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (computer_id, kind) DO UPDATE SET fire_at = EXCLUDED.fire_at
                        "#,
                        computer_id.as_uuid(),
                        kind.as_ref(),
                        at,
                    )
                    .execute(&mut **tx)
                    .await?;
                }
                effect => {
                    let worker = effect.worker();
                    sqlx::query!(
                        r#"
                        INSERT INTO hosted_runtime_effect (computer_id, worker, effect, run_after, created_at)
                        VALUES ($1, $2, $3, $4, $4)
                        "#,
                        computer_id.as_uuid(),
                        worker.as_ref(),
                        serde_json::to_value(&effect)?,
                        now,
                    )
                    .execute(&mut **tx)
                    .await?;
                }
            }
        }

        if let Some(tag) = serde_json::to_value(&state.phase)?
            .get("phase")
            .and_then(serde_json::Value::as_str)
        {
            span.record("phase", tag);
        }
        if !matches!(state.phase, Phase::PendingPayment { .. }) {
            sqlx::query!(
                "DELETE FROM hosted_runtime_effect WHERE computer_id = $1 AND worker = 'billing' AND effect->>'effect' = 'confirm_payment'",
                computer_id.as_uuid(),
            )
            .execute(&mut **tx)
            .await?;
        }

        let waiting_for_capacity = state.waiting_for_capacity();
        let (phase, connected) = (state.phase.clone(), state.macrod_connected);
        let finished_setup = state
            .setup
            .as_mut()
            .map(|setup| setup.advance(&phase, connected, waiting_for_capacity, now))
            .unwrap_or_default();

        let destroyed = state.phase == Phase::Destroyed;
        if destroyed {
            sqlx::query!(
                "DELETE FROM hosted_runtime_timer WHERE computer_id = $1",
                computer_id.as_uuid()
            )
            .execute(&mut **tx)
            .await?;
        }
        sqlx::query!(
            r#"
            UPDATE hosted_runtime
            SET state = $2, awake = $3, holds_units = $4, host_id = $5,
                version = version + 1, updated_at = $6, enrollment_generation = $7
            WHERE id = $1
            "#,
            computer_id.as_uuid(),
            serde_json::to_value(&state)?,
            state.is_awake(),
            state.holds_units(),
            state.host().map(HostId::into_inner),
            now,
            i64::from(computer.enrollment_generation.get()),
        )
        .execute(&mut **tx)
        .await?;

        if computer.state.is_awake()
            && !state.is_awake()
            && let Some(host) = computer.state.host()
        {
            // A timer avoids locking another computer while applying this one.
            sqlx::query!(
                    r#"
                    INSERT INTO hosted_runtime_timer (computer_id, kind, fire_at)
                    SELECT id, 'capacity_changed', $2 FROM hosted_runtime
                    WHERE host_id = $1 AND id <> $3
                        AND state->>'power' = 'on' AND state->>'power_on_requested' = 'true'
                        AND state->'phase'->>'phase' IN ('stopped', 'provisioning')
                    ON CONFLICT (computer_id, kind) DO UPDATE SET fire_at = LEAST(hosted_runtime_timer.fire_at, EXCLUDED.fire_at)
                    "#,
                    host.into_inner(), now, computer_id.as_uuid(),
                ).execute(&mut **tx).await?;
        }
        if state.capacity_wait.as_ref().map(|wait| wait.retry_at)
            != computer
                .state
                .capacity_wait
                .as_ref()
                .map(|wait| wait.retry_at)
            && let Some(wait) = &state.capacity_wait
            && wait.retry_at > now
        {
            tracing::info!(computer_id = %computer_id, host_id = ?state.host(),
                backoff_step = wait.backoff_step, retry_at = %wait.retry_at,
                "computer waiting for host capacity");
        }
        if let Some(setup) = &state.setup {
            crate::domain::telemetry::record_setup_waits(
                state.provision_traceparent.as_deref(),
                setup,
                &finished_setup,
                &crate::domain::telemetry::SetupAttributes {
                    computer_id: computer_id.to_string(),
                    team_id: computer.team_id.to_string(),
                    size: computer.size.as_ref().to_owned(),
                    host_id: state.host().map(|host| host.to_string()),
                    generation: i64::from(computer.enrollment_generation.get()),
                    billing_kind: if state.comp_reason.is_some() {
                        "comped"
                    } else {
                        "stripe"
                    },
                },
            );
        }
        computer.state = state;
        Ok(Some(computer))
    }

    /// Whether `computer` fits among the host's other awake computers. Locks
    /// the host row so concurrent starts on one host are serialized.
    async fn host_has_room(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        host: HostId,
        computer: &Computer,
    ) -> Result<bool, PgComputerError> {
        let capacity = sqlx::query_scalar!(
            "SELECT awake_capacity_units FROM hosted_runtime_host WHERE id = $1 FOR UPDATE",
            host.into_inner(),
        )
        .fetch_optional(&mut **tx)
        .await?;
        let Some(capacity) = capacity else {
            return Ok(false);
        };
        let others = sqlx::query_scalar!(
            r#"
            SELECT COALESCE(SUM(GREATEST((memory_gib::BIGINT + 7) / 8, (vcpus::BIGINT + 3) / 4)), 0)::INTEGER AS "units!"
            FROM hosted_runtime
            WHERE host_id = $1 AND awake AND id <> $2
            "#,
            host.into_inner(),
            computer.id.as_uuid(),
        )
        .fetch_one(&mut **tx)
        .await?;

        Ok(others + units(computer.resources)? <= capacity)
    }

    async fn fetch_many(
        &self,
        rows: Vec<ComputerRow>,
    ) -> Result<Vec<ComputerRecord>, PgComputerError> {
        Ok(rows.into_iter().map(Self::decode_row).collect())
    }

    /// Validate work owners before applying a batch limit, so corrupt owners cannot starve it.
    async fn host_records(&self, host: HostId) -> Result<Vec<ComputerRecord>, PgComputerError> {
        let rows = sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT id, team_id, host_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry, price_id, state, harness_id, created_by,
                   created_at, enrolled_at, enrollment_generation, setup_completed_at, default_agent_id, image, previous_image
            FROM hosted_runtime
            WHERE host_id = $1
            "#,
            host.into_inner(),
        )
        .fetch_all(&self.pool)
        .await?;
        self.fetch_many(rows).await
    }

    async fn healthy_work_ids(
        &self,
        worker: Option<EffectWorker>,
        now: DateTime<Utc>,
    ) -> Result<Vec<Uuid>, PgComputerError> {
        let worker = worker.map(|worker| worker.as_ref().to_owned());
        let rows = sqlx::query_as!(ComputerRow,
            "SELECT id, team_id, host_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry, price_id, state, harness_id, created_by, created_at, enrolled_at, enrollment_generation, setup_completed_at, default_agent_id, image, previous_image FROM hosted_runtime
             WHERE id IN (
                 SELECT computer_id FROM hosted_runtime_effect WHERE worker = $1 AND run_after <= $2
                 UNION
                 SELECT computer_id FROM hosted_runtime_timer WHERE $1::text IS NULL AND fire_at <= $2
             )",
            worker, now,
        ).fetch_all(&self.pool).await?;
        Ok(self
            .fetch_many(rows)
            .await?
            .into_iter()
            .filter_map(|record| match record {
                ComputerRecord::Healthy(computer) => Some(computer.id.as_uuid()),
                ComputerRecord::NeedsAttention { .. } => None,
            })
            .collect())
    }
}

impl ComputerRepo for PgComputerRepo {
    type Err = PgComputerError;
    type PaymentGuard = sqlx::Transaction<'static, sqlx::Postgres>;
    type EnrollmentGuard = sqlx::Transaction<'static, sqlx::Postgres>;

    #[tracing::instrument(skip(self), err)]
    async fn lock_enrollment(
        &self,
        computer_id: ComputerId,
    ) -> Result<Self::EnrollmentGuard, PgComputerError> {
        let mut guard = self.guards.begin().await?;
        let key = format!("hosted-enrollment:{computer_id}");
        sqlx::query!("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key)
            .execute(&mut *guard)
            .await?;
        Ok(guard)
    }

    #[tracing::instrument(skip(self), err)]
    async fn lock_payment(
        &self,
        computer_id: ComputerId,
    ) -> Result<Self::PaymentGuard, PgComputerError> {
        let mut guard = self.guards.begin().await?;
        let key = format!("computer-payment:{computer_id}");
        sqlx::query!("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key)
            .execute(&mut *guard)
            .await?;
        Ok(guard)
    }

    #[tracing::instrument(skip(self, computer), fields(computer_id = %computer.id), err)]
    async fn reserve(
        &self,
        computer: NewComputer,
        now: DateTime<Utc>,
    ) -> Result<Computer, ReserveError<PgComputerError>> {
        let storage = |error: sqlx::Error| ReserveError::Storage(PgComputerError::from(error));
        let computer_units = units(computer.resources).map_err(ReserveError::Storage)?;
        let mut tx = self.pool.begin().await.map_err(storage)?;

        // Lock every host: purchases are rare and hosts few, and this keeps
        // two purchases from both taking the last units.
        sqlx::query!("SELECT id FROM hosted_runtime_host ORDER BY id FOR UPDATE")
            .fetch_all(&mut *tx)
            .await
            .map_err(storage)?;
        // Read reservations in a new statement after any host-lock wait.
        let host = sqlx::query_scalar!(
            r#"
            WITH locked AS (
                SELECT id, sold_capacity_units FROM hosted_runtime_host
            )
            SELECT locked.id
            FROM locked
            LEFT JOIN hosted_runtime computer
                ON computer.host_id = locked.id AND computer.holds_units
            GROUP BY locked.id, locked.sold_capacity_units
            HAVING locked.sold_capacity_units - COALESCE(SUM(GREATEST((computer.memory_gib::BIGINT + 7) / 8, (computer.vcpus::BIGINT + 3) / 4)), 0) >= $1::BIGINT
            ORDER BY locked.sold_capacity_units - COALESCE(SUM(GREATEST((computer.memory_gib::BIGINT + 7) / 8, (computer.vcpus::BIGINT + 3) / 4)), 0) DESC
            LIMIT 1
            "#,
            i64::from(computer_units),
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(storage)?;
        let Some(host) = host else {
            return Err(ReserveError::SoldOut);
        };

        let mut state = ComputerState::reserved(HostId::new(host), now);
        state.provision_traceparent = crate::domain::telemetry::traceparent();
        if let crate::domain::models::PurchaseBilling::Comped { reason } = &computer.billing {
            state.comp_reason = Some(reason.clone());
        }
        let state_json = serde_json::to_value(&state)
            .map_err(|error| ReserveError::Storage(PgComputerError::from(error)))?;
        sqlx::query!(
            r#"
            INSERT INTO hosted_runtime
                (id, team_id, name, size, host_id, awake, holds_units, state,
                 created_by, created_at, updated_at, vcpus, memory_gib, disk_gib, catalog_entry, price_id,
                 agent_user_id)
            VALUES ($1, $2, $3, $4, $5, false, true, $6, $7, $8, $8, $9, $10, $11, $12, $13, $14)
            "#,
            computer.id.as_uuid(),
            computer.team_id,
            computer.name.as_str(),
            computer.size.as_ref(),
            host,
            state_json,
            computer.created_by.as_ref(),
            now,
            i32::try_from(computer.resources.vcpus.get()).map_err(|error| ReserveError::Storage(PgComputerError::from(error)))?,
            i32::try_from(computer.resources.memory_gib.get()).map_err(|error| ReserveError::Storage(PgComputerError::from(error)))?,
            i32::try_from(computer.resources.disk_gib.get()).map_err(|error| ReserveError::Storage(PgComputerError::from(error)))?,
            computer.catalog_entry.as_str(),
            computer.price_id.as_ref().map(|id| id.as_str()),
            computer.agent.as_ref().map(|agent| agent.as_ref()),
        )
        .execute(&mut *tx)
        .await
        .map_err(storage)?;
        if let crate::domain::models::PurchaseBilling::Comped { reason } = &computer.billing {
            let comped = Self::apply_locked(
                &mut tx,
                computer.id,
                &Event::Comped {
                    reason: reason.clone(),
                },
                now,
            )
            .await
            .map_err(ReserveError::Storage)?
            .ok_or_else(|| {
                ReserveError::Storage(PgComputerError::Corrupt(
                    "reserved computer disappeared".to_owned(),
                ))
            })?;
            tx.commit().await.map_err(storage)?;
            return Ok(comped);
        }
        let effect_json = serde_json::to_value(Effect::ConfirmPayment {
            extra_items: computer.extra_items,
        })
        .map_err(|error| ReserveError::Storage(PgComputerError::from(error)))?;
        sqlx::query!(
            "INSERT INTO hosted_runtime_effect (computer_id, worker, effect, run_after, created_at) VALUES ($1, 'billing', $2, $3, $4)",
            computer.id.as_uuid(),
            effect_json,
            now + crate::domain::lifecycle::PAYMENT_CONFIRM_DELAY,
            now,
        )
        .execute(&mut *tx)
        .await
        .map_err(storage)?;
        tx.commit().await.map_err(storage)?;

        Ok(Computer {
            id: computer.id,
            team_id: computer.team_id,
            name: computer.name,
            size: computer.size,
            resources: computer.resources,
            catalog_entry: computer.catalog_entry,
            price_id: computer.price_id,
            state,
            harness_id: None,
            created_by: computer.created_by,
            created_at: now,
            enrolled_at: None,
            setup_completed_at: None,
            default_agent_id: None,
            image: None,
            previous_image: None,
            enrollment_generation: Default::default(),
        })
    }

    #[tracing::instrument(skip(self, event), err)]
    async fn apply(
        &self,
        computer_id: ComputerId,
        event: Event,
        now: DateTime<Utc>,
    ) -> Result<Option<Computer>, PgComputerError> {
        let mut tx = self.pool.begin().await?;
        let computer = Self::apply_locked(&mut tx, computer_id, &event, now).await?;
        tx.commit().await?;
        Ok(computer)
    }

    async fn get(
        &self,
        computer_id: ComputerId,
    ) -> Result<Option<ComputerRecord>, PgComputerError> {
        Ok(sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT id, team_id, host_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry, price_id, state, harness_id, created_by,
                   created_at, enrolled_at, enrollment_generation, setup_completed_at, default_agent_id, image, previous_image
            FROM hosted_runtime
            WHERE id = $1
            "#,
            computer_id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await?
        .map(Self::decode_row)
        )
    }

    async fn list_for_team(&self, team_id: Uuid) -> Result<Vec<ComputerRecord>, PgComputerError> {
        let rows = sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT id, team_id, host_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry, price_id, state, harness_id, created_by,
                   created_at, enrolled_at, enrollment_generation, setup_completed_at, default_agent_id, image, previous_image
            FROM hosted_runtime
            WHERE team_id = $1
            ORDER BY created_at
            "#,
            team_id,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(self
            .fetch_many(rows)
            .await?
            .into_iter()
            .filter(|record| {
                record
                    .healthy()
                    .is_none_or(|computer| computer.state.phase != Phase::Destroyed)
            })
            .collect())
    }

    async fn find_by_harness(
        &self,
        harness_id: HarnessId,
    ) -> Result<Option<Computer>, PgComputerError> {
        sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT id, team_id, host_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry, price_id, state, harness_id, created_by,
                   created_at, enrolled_at, enrollment_generation, setup_completed_at, default_agent_id, image, previous_image
            FROM hosted_runtime
            WHERE harness_id = $1
            "#,
            harness_id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await?
        .map(Computer::try_from)
        .transpose()
        .map_err(PgComputerError::from)
    }

    async fn set_harness(
        &self,
        computer_id: ComputerId,
        harness_id: HarnessId,
    ) -> Result<(), PgComputerError> {
        sqlx::query!(
            "UPDATE hosted_runtime SET harness_id = $2 WHERE id = $1",
            computer_id.as_uuid(),
            harness_id.as_uuid(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn mark_enrolled(
        &self,
        computer_id: ComputerId,
        now: DateTime<Utc>,
    ) -> Result<(), PgComputerError> {
        sqlx::query!(
            "UPDATE hosted_runtime SET enrolled_at = COALESCE(enrolled_at, $2) WHERE id = $1",
            computer_id.as_uuid(),
            now,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn agent_counts(
        &self,
        computer_ids: &[ComputerId],
    ) -> Result<HashMap<ComputerId, u32>, PgComputerError> {
        let ids: Vec<Uuid> = computer_ids.iter().map(|id| id.as_uuid()).collect();
        let rows = sqlx::query!(
            r#"
            SELECT h.computer_id AS "computer_id!", count(*) AS "agents!"
            FROM harnesses h
            JOIN agent_configs a ON a.harness_id = h.id
            JOIN bots b ON b.id = a.bot_id
            WHERE h.computer_id = ANY($1)
              AND h.deleted_at IS NULL
              AND b.deleted_at IS NULL
            GROUP BY h.computer_id
            "#,
            &ids,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok((
                    ComputerId::new_from_uuid(row.computer_id),
                    u32::try_from(row.agents)?,
                ))
            })
            .collect()
    }

    async fn record_image(
        &self,
        computer_id: ComputerId,
        image: &GuestImage,
    ) -> Result<(), PgComputerError> {
        sqlx::query!(
            r#"
            UPDATE hosted_runtime
            SET previous_image = CASE WHEN image IS DISTINCT FROM $2 THEN image ELSE previous_image END,
                image = $2
            WHERE id = $1
            "#,
            computer_id.as_uuid(),
            image.as_str(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn set_default_agent(
        &self,
        computer_id: ComputerId,
        agent_id: BotId,
    ) -> Result<(), PgComputerError> {
        sqlx::query!(
            "UPDATE hosted_runtime SET default_agent_id = $2 WHERE id = $1",
            computer_id.as_uuid(),
            agent_id.as_uuid(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn complete_setup(
        &self,
        computer_id: ComputerId,
        now: DateTime<Utc>,
    ) -> Result<Option<ComputerRecord>, PgComputerError> {
        let row = sqlx::query_as!(
            ComputerRow,
            r#"
            UPDATE hosted_runtime
            SET setup_completed_at = COALESCE(setup_completed_at, $2)
            WHERE id = $1
            RETURNING id, team_id, host_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry, price_id, state, harness_id, created_by,
                      created_at, enrolled_at, enrollment_generation, setup_completed_at, default_agent_id, image, previous_image
            "#,
            computer_id.as_uuid(),
            now,
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(Self::decode_row))
    }

    async fn instances_expected(
        &self,
        host: HostId,
    ) -> Result<Vec<ComputerRecord>, PgComputerError> {
        Ok(self
            .host_records(host)
            .await?
            .into_iter()
            .filter(|record| {
                record.healthy().is_none_or(|computer| {
                    computer.state.holds_units()
                        && !matches!(computer.state.phase, Phase::PendingPayment { .. })
                })
            })
            .collect())
    }

    async fn lease_effects(
        &self,
        worker: EffectWorker,
        limit: u32,
        now: DateTime<Utc>,
        lease_until: DateTime<Utc>,
    ) -> Result<Vec<PendingEffect>, PgComputerError> {
        let healthy_ids = self.healthy_work_ids(Some(worker), now).await?;
        // Only each computer's oldest pending effect is due: a computer's
        // effects run in the order its transitions produced them.
        let rows = sqlx::query!(
            r#"
            UPDATE hosted_runtime_effect
            SET run_after = $4
            WHERE id IN (
                SELECT effect.id
                FROM hosted_runtime_effect effect
                WHERE effect.worker = $1 AND effect.computer_id = ANY($5)
                  AND effect.run_after <= $3
                  AND effect.id = (
                      SELECT MIN(earlier.id) FROM hosted_runtime_effect earlier
                      WHERE earlier.computer_id = effect.computer_id
                        AND earlier.worker = effect.worker
                  )
                ORDER BY effect.id
                LIMIT $2
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, computer_id, effect, attempts
            "#,
            worker.as_ref(),
            i64::from(limit),
            now,
            lease_until,
            &healthy_ids,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(PendingEffect {
                    id: row.id,
                    computer_id: ComputerId::new_from_uuid(row.computer_id),
                    effect: serde_json::from_value(row.effect)?,
                    attempts: u32::try_from(row.attempts)?,
                })
            })
            .collect()
    }

    #[tracing::instrument(skip(self, ids), fields(count = ids.len() as i64), err)]
    async fn release_effects(
        &self,
        ids: &[i64],
        lease_until: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> Result<(), PgComputerError> {
        sqlx::query!(
            "UPDATE hosted_runtime_effect SET run_after = $3 WHERE id = ANY($1) AND worker = 'fleet' AND run_after = $2",
            ids,
            lease_until,
            now,
        ).execute(&self.pool).await?;
        Ok(())
    }

    async fn complete_effect(&self, id: i64) -> Result<(), PgComputerError> {
        sqlx::query!("DELETE FROM hosted_runtime_effect WHERE id = $1", id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn finish_effect(
        &self,
        id: i64,
        completion: Option<Event>,
        now: DateTime<Utc>,
    ) -> Result<(), PgComputerError> {
        let mut tx = self.pool.begin().await?;
        let deleted = sqlx::query!(
            "DELETE FROM hosted_runtime_effect WHERE id = $1 AND worker = 'fleet' RETURNING computer_id",
            id,
        ).fetch_optional(&mut *tx).await?;
        if let Some(deleted) = deleted
            && let Some(event) = completion
        {
            Self::apply_locked(
                &mut tx,
                ComputerId::new_from_uuid(deleted.computer_id),
                &event,
                now,
            )
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    async fn retry_effect(
        &self,
        id: i64,
        error: String,
        retry_at: DateTime<Utc>,
    ) -> Result<(), PgComputerError> {
        sqlx::query!(
            r#"
            UPDATE hosted_runtime_effect
            SET attempts = attempts + 1, last_error = $2, run_after = $3
            WHERE id = $1
            "#,
            id,
            error,
            retry_at,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn due_timers(
        &self,
        now: DateTime<Utc>,
        limit: u32,
    ) -> Result<Vec<DueTimer>, PgComputerError> {
        let healthy_ids = self.healthy_work_ids(None, now).await?;
        let rows = sqlx::query!(
            r#"
            SELECT computer_id, kind, fire_at FROM hosted_runtime_timer
            WHERE fire_at <= $1 AND computer_id = ANY($3)
            ORDER BY fire_at
            LIMIT $2
            "#,
            now,
            i64::from(limit),
            &healthy_ids,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                let kind = row.kind.parse::<TimerKind>().map_err(|_| {
                    PgComputerError::Corrupt(format!("unknown timer {:?}", row.kind))
                })?;
                Ok(DueTimer {
                    computer_id: ComputerId::new_from_uuid(row.computer_id),
                    kind,
                    fire_at: row.fire_at,
                })
            })
            .collect()
    }

    #[tracing::instrument(skip(self), err)]
    async fn fire_timer(
        &self,
        timer: DueTimer,
        instance_status: Option<crate::domain::ports::InstanceStatus>,
        now: DateTime<Utc>,
    ) -> Result<Option<Computer>, PgComputerError> {
        let mut tx = self.pool.begin().await?;
        Self::lock_host(&mut tx, timer.computer_id).await?;
        let deleted = sqlx::query!(
            r#"
            DELETE FROM hosted_runtime_timer
            WHERE computer_id = $1 AND kind = $2 AND fire_at = $3
            "#,
            timer.computer_id.as_uuid(),
            timer.kind.as_ref(),
            timer.fire_at,
        )
        .execute(&mut *tx)
        .await?;
        if deleted.rows_affected() == 0 {
            return Ok(None);
        }
        let computer = Self::apply_locked(
            &mut tx,
            timer.computer_id,
            &timer.kind.event(instance_status),
            now,
        )
        .await?;
        tx.commit().await?;
        Ok(computer)
    }

    #[tracing::instrument(skip(self), err)]
    async fn postpone_macrod_timers(
        &self,
        host: HostId,
        deadline: DateTime<Utc>,
    ) -> Result<(), PgComputerError> {
        let healthy_ids: Vec<Uuid> = self
            .host_records(host)
            .await?
            .into_iter()
            .filter_map(|record| record.healthy().map(|computer| computer.id.as_uuid()))
            .collect();
        sqlx::query!(
            "UPDATE hosted_runtime_timer t SET fire_at = $2 FROM hosted_runtime c WHERE t.computer_id = c.id AND c.host_id = $1 AND t.kind = 'macrod_missing' AND t.computer_id = ANY($3)",
            host.into_inner(),
            deadline,
            &healthy_ids,
        ).execute(&self.pool).await?;
        Ok(())
    }

    async fn register_host(&self, registration: HostRegistration) -> Result<Host, PgComputerError> {
        let awake = i32::try_from(registration.awake_capacity_units())?;
        let sold = i32::try_from(registration.sold_capacity_units())?;
        let row = sqlx::query!(
            r#"
            INSERT INTO hosted_runtime_host (id, name, awake_capacity_units, sold_capacity_units)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (name) DO UPDATE
            SET awake_capacity_units = EXCLUDED.awake_capacity_units,
                sold_capacity_units = EXCLUDED.sold_capacity_units,
                updated_at = now()
            RETURNING id, name, awake_capacity_units, sold_capacity_units
            "#,
            Uuid::now_v7(),
            registration.name,
            awake,
            sold,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(Host {
            id: HostId::new(row.id),
            name: row.name,
            awake_capacity_units: u32::try_from(row.awake_capacity_units)?,
            sold_capacity_units: u32::try_from(row.sold_capacity_units)?,
        })
    }

    #[tracing::instrument(skip(self), err)]
    async fn heartbeat_host(
        &self,
        host: HostId,
        now: DateTime<Utc>,
    ) -> Result<(), PgComputerError> {
        sqlx::query!(
            "UPDATE hosted_runtime_host SET updated_at = $2 WHERE id = $1",
            host.into_inner(),
            now,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn sold_out_sizes(
        &self,
        catalog: &[crate::domain::size::CatalogEntry],
    ) -> Result<Vec<ComputerSize>, PgComputerError> {
        let free = sqlx::query_scalar!(
            r#"
            SELECT COALESCE(MAX(free), 0)::INTEGER AS "free!"
            FROM (
                SELECT host.sold_capacity_units - COALESCE(SUM(GREATEST((computer.memory_gib::BIGINT + 7) / 8, (computer.vcpus::BIGINT + 3) / 4)), 0) AS free
                FROM hosted_runtime_host host
                LEFT JOIN hosted_runtime computer
                    ON computer.host_id = host.id AND computer.holds_units
                GROUP BY host.id, host.sold_capacity_units
            ) hosts
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(catalog
            .iter()
            .filter(|entry| i64::from(entry.resources.units()) > i64::from(free))
            .map(|entry| entry.size)
            .collect())
    }

    async fn request_notify(
        &self,
        team_id: Uuid,
        user_id: MacroUserIdStr<'static>,
        size: ComputerSize,
    ) -> Result<(), PgComputerError> {
        sqlx::query!(
            r#"
            INSERT INTO hosted_runtime_waitlist (team_id, user_id, size)
            VALUES ($1, $2, $3)
            ON CONFLICT DO NOTHING
            "#,
            team_id,
            user_id.as_ref(),
            size.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn notify_requests(
        &self,
        team_id: Uuid,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<ComputerSize>, PgComputerError> {
        let sizes = sqlx::query_scalar!(
            "SELECT size FROM hosted_runtime_waitlist WHERE team_id = $1 AND user_id = $2",
            team_id,
            user_id.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?;
        sizes
            .iter()
            .map(|size| {
                size.parse::<ComputerSize>().map_err(|_| {
                    PgComputerError::Corrupt(format!("invalid computer size {size:?}"))
                })
            })
            .collect()
    }
}
