//! Postgres adapter for [`ComputerRepo`].

use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::enrollment::Persona;
use crate::domain::ids::ComputerId;
use crate::domain::lifecycle::{
    ComputerState, Context, Effect, EffectWorker, Event, HostId, Phase, TimerKind, transition,
};
use crate::domain::models::StripePriceId;
use crate::domain::models::{Computer, ComputerName, Host, HostRegistration, NewComputer};
use crate::domain::ports::{ComputerRepo, DueTimer, PendingEffect, ReserveError};
use crate::domain::size::{
    CatalogEntryId, ComputerResources, ComputerSize, DiskGib, MemoryGib, Vcpus,
};

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

struct ComputerRow {
    id: Uuid,
    team_id: Uuid,
    name: String,
    size: String,
    vcpus: i32,
    memory_gib: i32,
    disk_gib: i32,
    catalog_entry: String,
    price_id: Option<String>,
    state: serde_json::Value,
    harness_id: Option<Uuid>,
    persona: Option<serde_json::Value>,
    created_by: String,
    created_at: DateTime<Utc>,
    enrolled_at: Option<DateTime<Utc>>,
    enrollment_generation: i64,
}

impl TryFrom<ComputerRow> for Computer {
    type Error = PgComputerError;

    fn try_from(row: ComputerRow) -> Result<Self, Self::Error> {
        let size = row
            .size
            .parse::<ComputerSize>()
            .map_err(|_| PgComputerError::Corrupt(format!("unknown size {:?}", row.size)))?;
        let persona = row
            .persona
            .map(serde_json::from_value::<Persona>)
            .transpose()?;

        Ok(Computer {
            id: ComputerId::new_from_uuid(row.id),
            team_id: row.team_id,
            name: ComputerName::try_new(&row.name)
                .map_err(|error| PgComputerError::Corrupt(error.to_string()))?,
            size,
            resources: ComputerResources {
                vcpus: Vcpus::new(u32::try_from(row.vcpus)?),
                memory_gib: MemoryGib::new(u32::try_from(row.memory_gib)?),
                disk_gib: DiskGib::new(u32::try_from(row.disk_gib)?),
            },
            catalog_entry: CatalogEntryId::try_new(row.catalog_entry)
                .map_err(|error| PgComputerError::Corrupt(error.to_string()))?,
            price_id: row
                .price_id
                .map(|id| {
                    StripePriceId::parse(&id)
                        .map_err(|error| PgComputerError::Corrupt(error.to_string()))
                })
                .transpose()?,
            state: serde_json::from_value(row.state)?,
            harness_id: row.harness_id.map(HarnessId::new_from_uuid),
            persona,
            created_by: MacroUserIdStr::try_from(row.created_by)
                .map_err(|error| PgComputerError::Corrupt(error.to_string()))?,
            created_at: row.created_at,
            enrolled_at: row.enrolled_at,
            enrollment_generation: crate::domain::persona_credentials::EnrollmentGeneration::new(
                u32::try_from(row.enrollment_generation)?,
            ),
        })
    }
}

fn units(resources: ComputerResources) -> Result<i32, PgComputerError> {
    Ok(i32::try_from(resources.units())?)
}

impl PgComputerRepo {
    /// Run the transition for a computer already locked in `tx`, and store
    /// its state, effects and timers.
    async fn apply_locked(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        computer_id: ComputerId,
        event: &Event,
        now: DateTime<Utc>,
    ) -> Result<Option<Computer>, PgComputerError> {
        let row = sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT id, team_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry, price_id, state, harness_id, persona, created_by,
                   created_at, enrolled_at, enrollment_generation
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

        let host_has_room = match computer.state.host() {
            Some(host) => Self::host_has_room(tx, host, &computer).await?,
            None => false,
        };
        let (state, effects) = transition(
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

        if !matches!(state.phase, Phase::PendingPayment { .. }) {
            sqlx::query!(
                "DELETE FROM hosted_runtime_effect WHERE computer_id = $1 AND worker = 'billing' AND effect->>'effect' = 'confirm_payment'",
                computer_id.as_uuid(),
            )
            .execute(&mut **tx)
            .await?;
        }

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

        computer.state = state;
        Ok(Some(computer))
    }

    /// Whether `computer` fits among the host's other awake computers. Locks
    /// the host row so concurrent wakes on one host are serialized.
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

    async fn fetch_many(&self, rows: Vec<ComputerRow>) -> Result<Vec<Computer>, PgComputerError> {
        rows.into_iter().map(Computer::try_from).collect()
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
                SELECT id, sold_capacity_units, awake_capacity_units FROM hosted_runtime_host
            )
            SELECT locked.id
            FROM locked
            LEFT JOIN hosted_runtime computer
                ON computer.host_id = locked.id AND computer.holds_units
            GROUP BY locked.id, locked.sold_capacity_units, locked.awake_capacity_units
            HAVING locked.sold_capacity_units - COALESCE(SUM(GREATEST((computer.memory_gib::BIGINT + 7) / 8, (computer.vcpus::BIGINT + 3) / 4)), 0) >= $1::BIGINT
               AND (NOT $2::BOOLEAN OR locked.awake_capacity_units - COALESCE(SUM(GREATEST((computer.memory_gib::BIGINT + 7) / 8, (computer.vcpus::BIGINT + 3) / 4)) FILTER (WHERE computer.persona IS NOT NULL), 0) >= $1::BIGINT)
            ORDER BY locked.sold_capacity_units - COALESCE(SUM(GREATEST((computer.memory_gib::BIGINT + 7) / 8, (computer.vcpus::BIGINT + 3) / 4)), 0) DESC
            LIMIT 1
            "#,
            i64::from(computer_units),
            computer.persona.is_some(),
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(storage)?;
        let Some(host) = host else {
            return Err(ReserveError::SoldOut);
        };

        let mut state = ComputerState::reserved(HostId::new(host), now);
        if let crate::domain::models::PurchaseBilling::Comped { reason } = &computer.billing {
            state.comp_reason = Some(reason.clone());
        }
        let state_json = serde_json::to_value(&state)
            .map_err(|error| ReserveError::Storage(PgComputerError::from(error)))?;
        let persona_json = computer
            .persona
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(|error| ReserveError::Storage(PgComputerError::from(error)))?;
        sqlx::query!(
            r#"
            INSERT INTO hosted_runtime
                (id, team_id, name, size, host_id, awake, holds_units, state,
                 persona, created_by, created_at, updated_at, vcpus, memory_gib, disk_gib, catalog_entry, price_id)
            VALUES ($1, $2, $3, $4, $5, false, true, $6, $7, $8, $9, $9, $10, $11, $12, $13, $14)
            "#,
            computer.id.as_uuid(),
            computer.team_id,
            computer.name.as_str(),
            computer.size.as_ref(),
            host,
            state_json,
            persona_json,
            computer.created_by.as_ref(),
            now,
            i32::try_from(computer.resources.vcpus.get()).map_err(|error| ReserveError::Storage(PgComputerError::from(error)))?,
            i32::try_from(computer.resources.memory_gib.get()).map_err(|error| ReserveError::Storage(PgComputerError::from(error)))?,
            i32::try_from(computer.resources.disk_gib.get()).map_err(|error| ReserveError::Storage(PgComputerError::from(error)))?,
            computer.catalog_entry.as_str(),
            computer.price_id.as_ref().map(|id| id.as_str()),
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
            persona: computer.persona,
            created_by: computer.created_by,
            created_at: now,
            enrolled_at: None,
            enrollment_generation: Default::default(),
        })
    }

    #[tracing::instrument(skip(self), err)]
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

    async fn get(&self, computer_id: ComputerId) -> Result<Option<Computer>, PgComputerError> {
        sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT id, team_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry, price_id, state, harness_id, persona, created_by,
                   created_at, enrolled_at, enrollment_generation
            FROM hosted_runtime
            WHERE id = $1
            "#,
            computer_id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await?
        .map(Computer::try_from)
        .transpose()
    }

    async fn list_for_team(&self, team_id: Uuid) -> Result<Vec<Computer>, PgComputerError> {
        let rows = sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT id, team_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry, price_id, state, harness_id, persona, created_by,
                   created_at, enrolled_at, enrollment_generation
            FROM hosted_runtime
            WHERE team_id = $1 AND state->'phase'->>'phase' <> 'destroyed'
            ORDER BY created_at
            "#,
            team_id,
        )
        .fetch_all(&self.pool)
        .await?;
        self.fetch_many(rows).await
    }

    async fn find_by_harness(
        &self,
        harness_id: HarnessId,
    ) -> Result<Option<Computer>, PgComputerError> {
        sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT id, team_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry, price_id, state, harness_id, persona, created_by,
                   created_at, enrolled_at, enrollment_generation
            FROM hosted_runtime
            WHERE harness_id = $1
            "#,
            harness_id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await?
        .map(Computer::try_from)
        .transpose()
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

    async fn running(&self) -> Result<Vec<Computer>, PgComputerError> {
        let rows = sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT id, team_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry, price_id, state, harness_id, persona, created_by,
                   created_at, enrolled_at, enrollment_generation
            FROM hosted_runtime
            WHERE awake AND state->'phase'->>'phase' = 'running'
            "#,
        )
        .fetch_all(&self.pool)
        .await?;
        self.fetch_many(rows).await
    }

    async fn coldest_frozen(&self, host: HostId) -> Result<Option<ComputerId>, PgComputerError> {
        Ok(sqlx::query_scalar!(
            r#"
            SELECT id FROM hosted_runtime
            WHERE host_id = $1 AND awake AND state->'phase'->>'phase' = 'frozen'
            ORDER BY updated_at
            LIMIT 1
            "#,
            host.into_inner(),
        )
        .fetch_optional(&self.pool)
        .await?
        .map(ComputerId::new_from_uuid))
    }

    async fn instances_expected(&self, host: HostId) -> Result<Vec<Computer>, PgComputerError> {
        let rows = sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT id, team_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry, price_id, state, harness_id, persona, created_by,
                   created_at, enrolled_at, enrollment_generation
            FROM hosted_runtime
            WHERE host_id = $1 AND holds_units AND state->'phase'->>'phase' <> 'pending_payment'
            "#,
            host.into_inner(),
        )
        .fetch_all(&self.pool)
        .await?;
        self.fetch_many(rows).await
    }

    async fn lease_effects(
        &self,
        worker: EffectWorker,
        limit: u32,
        now: DateTime<Utc>,
        lease_until: DateTime<Utc>,
    ) -> Result<Vec<PendingEffect>, PgComputerError> {
        // Only each computer's oldest pending effect is due: a computer's
        // effects run in the order its transitions produced them.
        let rows = sqlx::query!(
            r#"
            UPDATE hosted_runtime_effect
            SET run_after = $4
            WHERE id IN (
                SELECT effect.id
                FROM hosted_runtime_effect effect
                WHERE effect.worker = $1
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
        let rows = sqlx::query!(
            r#"
            SELECT computer_id, kind, fire_at FROM hosted_runtime_timer
            WHERE fire_at <= $1
            ORDER BY fire_at
            LIMIT $2
            "#,
            now,
            i64::from(limit),
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
        sqlx::query!(
            "UPDATE hosted_runtime_timer t SET fire_at = $2 FROM hosted_runtime c WHERE t.computer_id = c.id AND c.host_id = $1 AND t.kind = 'macrod_missing'",
            host.into_inner(),
            deadline,
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

    async fn sold_out_sizes(
        &self,
        catalog: &[crate::domain::size::CatalogEntry],
        always_on: bool,
    ) -> Result<Vec<ComputerSize>, PgComputerError> {
        let free = sqlx::query_scalar!(
            r#"
            SELECT COALESCE(MAX(free), 0)::INTEGER AS "free!"
            FROM (
                SELECT LEAST(
                    host.sold_capacity_units - COALESCE(SUM(GREATEST((computer.memory_gib::BIGINT + 7) / 8, (computer.vcpus::BIGINT + 3) / 4)), 0),
                    CASE WHEN $1::BOOLEAN THEN host.awake_capacity_units - COALESCE(SUM(GREATEST((computer.memory_gib::BIGINT + 7) / 8, (computer.vcpus::BIGINT + 3) / 4)) FILTER (WHERE computer.persona IS NOT NULL), 0) ELSE host.sold_capacity_units END
                ) AS free
                FROM hosted_runtime_host host
                LEFT JOIN hosted_runtime computer
                    ON computer.host_id = host.id AND computer.holds_units
                GROUP BY host.id, host.sold_capacity_units, host.awake_capacity_units
            ) hosts
            "#,
            always_on,
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
