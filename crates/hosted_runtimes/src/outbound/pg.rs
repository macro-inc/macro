//! Postgres adapter for [`ComputerRepo`].

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::enrollment::Persona;
use crate::domain::lifecycle::{
    ComputerState, Context, Effect, EffectWorker, Event, HostId, Phase, TimerKind, transition,
};
use crate::domain::models::{Computer, Host, HostRegistration, NewComputer};
use crate::domain::ports::{ComputerRepo, DueTimer, PendingEffect, ReserveError};
use crate::domain::size::ComputerSize;

#[cfg(test)]
mod test;

/// Errors from the Postgres adapter.
#[derive(Debug, thiserror::Error)]
pub enum PgComputerError {
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error("stored computer data is invalid: {0}")]
    Corrupt(String),
}

impl From<serde_json::Error> for PgComputerError {
    fn from(error: serde_json::Error) -> Self {
        Self::Corrupt(error.to_string())
    }
}

#[derive(Clone)]
pub struct PgComputerRepo {
    pool: PgPool,
    payment_locks: PgPool,
}

impl PgComputerRepo {
    pub fn new(pool: PgPool) -> Self {
        // Payment guards outlive provider calls; keep their waiters off the
        // pool used to persist the outcome while the guard is held.
        let payment_locks = sqlx::postgres::PgPoolOptions::new()
            .max_connections(pool.options().get_max_connections().min(4))
            .idle_timeout(std::time::Duration::from_secs(60))
            .connect_lazy_with(pool.connect_options().as_ref().clone());
        Self {
            pool,
            payment_locks,
        }
    }
}

struct ComputerRow {
    id: Uuid,
    team_id: Uuid,
    name: String,
    size: String,
    state: serde_json::Value,
    harness_id: Option<Uuid>,
    persona: Option<serde_json::Value>,
    created_by: String,
    created_at: DateTime<Utc>,
    enrolled_at: Option<DateTime<Utc>>,
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
            id: row.id,
            team_id: row.team_id,
            name: row.name,
            size,
            state: serde_json::from_value(row.state)?,
            harness_id: row.harness_id,
            persona,
            created_by: row.created_by,
            created_at: row.created_at,
            enrolled_at: row.enrolled_at,
        })
    }
}

fn units(size: ComputerSize) -> i32 {
    i32::try_from(size.units()).unwrap_or(i32::MAX)
}

impl PgComputerRepo {
    /// Run the transition for a computer already locked in `tx`, and store
    /// its state, effects and timers.
    #[tracing::instrument(name = "computer.lifecycle.event", skip_all, fields(%computer_id, event, phase, team_id, size, billing_kind, otel.status_code), err)]
    async fn apply_locked(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        computer_id: Uuid,
        event: &Event,
        now: DateTime<Utc>,
    ) -> Result<Option<Computer>, PgComputerError> {
        let row = sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT id, team_id, name, size, state, harness_id, persona, created_by,
                   created_at, enrolled_at
            FROM hosted_runtime
            WHERE id = $1
            FOR UPDATE
            "#,
            computer_id,
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
        let (state, effects) = transition(&computer.state, event, Context { now, host_has_room });

        for effect in effects {
            match effect {
                Effect::ScheduleTimer { kind, at } => {
                    sqlx::query!(
                        r#"
                        INSERT INTO hosted_runtime_timer (computer_id, kind, fire_at)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (computer_id, kind) DO UPDATE SET fire_at = EXCLUDED.fire_at
                        "#,
                        computer_id,
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
                        computer_id,
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
        let destroyed = state.phase == Phase::Destroyed;
        if destroyed {
            sqlx::query!(
                "DELETE FROM hosted_runtime_timer WHERE computer_id = $1",
                computer_id
            )
            .execute(&mut **tx)
            .await?;
        }
        sqlx::query!(
            r#"
            UPDATE hosted_runtime
            SET state = $2, awake = $3, holds_units = $4, host_id = $5,
                version = version + 1, updated_at = $6
            WHERE id = $1
            "#,
            computer_id,
            serde_json::to_value(&state)?,
            state.is_awake(),
            state.holds_units(),
            state.host(),
            now,
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
            host,
        )
        .fetch_optional(&mut **tx)
        .await?;
        let Some(capacity) = capacity else {
            return Ok(false);
        };
        let others = sqlx::query_scalar!(
            r#"
            SELECT COALESCE(SUM(units), 0)::INTEGER AS "units!"
            FROM hosted_runtime
            WHERE host_id = $1 AND awake AND id <> $2
            "#,
            host,
            computer.id,
        )
        .fetch_one(&mut **tx)
        .await?;

        Ok(others + units(computer.size) <= capacity)
    }

    async fn fetch_many(&self, rows: Vec<ComputerRow>) -> Result<Vec<Computer>, PgComputerError> {
        rows.into_iter().map(Computer::try_from).collect()
    }
}

impl ComputerRepo for PgComputerRepo {
    type Err = PgComputerError;
    type PaymentGuard = sqlx::Transaction<'static, sqlx::Postgres>;

    #[tracing::instrument(skip(self), err)]
    async fn lock_payment(&self, computer_id: Uuid) -> Result<Self::PaymentGuard, PgComputerError> {
        let mut guard = self.payment_locks.begin().await?;
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
        let mut tx = self.pool.begin().await.map_err(storage)?;

        // Lock every host: purchases are rare and hosts few, and this keeps
        // two purchases from both taking the last units.
        let host = sqlx::query_scalar!(
            r#"
            WITH locked AS (
                SELECT id, sold_capacity_units FROM hosted_runtime_host ORDER BY id FOR UPDATE
            )
            SELECT locked.id
            FROM locked
            LEFT JOIN hosted_runtime computer
                ON computer.host_id = locked.id AND computer.holds_units
            GROUP BY locked.id, locked.sold_capacity_units
            HAVING locked.sold_capacity_units - COALESCE(SUM(computer.units), 0) >= $1::BIGINT
            ORDER BY locked.sold_capacity_units - COALESCE(SUM(computer.units), 0) DESC
            LIMIT 1
            "#,
            i64::from(units(computer.size)),
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(storage)?;
        let Some(host) = host else {
            return Err(ReserveError::SoldOut);
        };

        let mut state = ComputerState::reserved(host, now);
        state.provision_traceparent = crate::domain::telemetry::traceparent();
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
                (id, team_id, name, size, units, host_id, awake, holds_units, state,
                 persona, created_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, false, true, $7, $8, $9, $10, $10)
            "#,
            computer.id,
            computer.team_id,
            computer.name,
            computer.size.as_ref(),
            units(computer.size),
            host,
            state_json,
            persona_json,
            computer.created_by,
            now,
        )
        .execute(&mut *tx)
        .await
        .map_err(storage)?;
        let effect_json = serde_json::to_value(Effect::ConfirmPayment {
            extra_items: computer.extra_items,
        })
        .map_err(|error| ReserveError::Storage(PgComputerError::from(error)))?;
        sqlx::query!(
            "INSERT INTO hosted_runtime_effect (computer_id, worker, effect, run_after, created_at) VALUES ($1, 'billing', $2, $3, $4)",
            computer.id,
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
            state,
            harness_id: None,
            persona: computer.persona,
            created_by: computer.created_by,
            created_at: now,
            enrolled_at: None,
        })
    }

    #[tracing::instrument(skip(self, event), err)]
    async fn apply(
        &self,
        computer_id: Uuid,
        event: Event,
        now: DateTime<Utc>,
    ) -> Result<Option<Computer>, PgComputerError> {
        let mut tx = self.pool.begin().await?;
        let computer = Self::apply_locked(&mut tx, computer_id, &event, now).await?;
        tx.commit().await?;
        Ok(computer)
    }

    async fn get(&self, computer_id: Uuid) -> Result<Option<Computer>, PgComputerError> {
        sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT id, team_id, name, size, state, harness_id, persona, created_by,
                   created_at, enrolled_at
            FROM hosted_runtime
            WHERE id = $1
            "#,
            computer_id,
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
            SELECT id, team_id, name, size, state, harness_id, persona, created_by,
                   created_at, enrolled_at
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

    async fn find_by_harness(&self, harness_id: Uuid) -> Result<Option<Computer>, PgComputerError> {
        sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT id, team_id, name, size, state, harness_id, persona, created_by,
                   created_at, enrolled_at
            FROM hosted_runtime
            WHERE harness_id = $1
            "#,
            harness_id,
        )
        .fetch_optional(&self.pool)
        .await?
        .map(Computer::try_from)
        .transpose()
    }

    async fn set_harness(
        &self,
        computer_id: Uuid,
        harness_id: Uuid,
    ) -> Result<(), PgComputerError> {
        sqlx::query!(
            "UPDATE hosted_runtime SET harness_id = $2 WHERE id = $1",
            computer_id,
            harness_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn mark_enrolled(
        &self,
        computer_id: Uuid,
        now: DateTime<Utc>,
    ) -> Result<(), PgComputerError> {
        sqlx::query!(
            "UPDATE hosted_runtime SET enrolled_at = COALESCE(enrolled_at, $2) WHERE id = $1",
            computer_id,
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
            SELECT id, team_id, name, size, state, harness_id, persona, created_by,
                   created_at, enrolled_at
            FROM hosted_runtime
            WHERE awake AND state->'phase'->>'phase' = 'running'
            "#,
        )
        .fetch_all(&self.pool)
        .await?;
        self.fetch_many(rows).await
    }

    async fn coldest_frozen(&self, host: HostId) -> Result<Option<Uuid>, PgComputerError> {
        Ok(sqlx::query_scalar!(
            r#"
            SELECT id FROM hosted_runtime
            WHERE host_id = $1 AND awake AND state->'phase'->>'phase' = 'frozen'
            ORDER BY updated_at
            LIMIT 1
            "#,
            host,
        )
        .fetch_optional(&self.pool)
        .await?)
    }

    async fn instances_expected(&self, host: HostId) -> Result<Vec<Computer>, PgComputerError> {
        let rows = sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT id, team_id, name, size, state, harness_id, persona, created_by,
                   created_at, enrolled_at
            FROM hosted_runtime
            WHERE host_id = $1 AND holds_units AND state->'phase'->>'phase' <> 'pending_payment'
            "#,
            host,
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
                    computer_id: row.computer_id,
                    effect: serde_json::from_value(row.effect)?,
                    attempts: u32::try_from(row.attempts).unwrap_or(0),
                })
            })
            .collect()
    }

    async fn complete_effect(&self, id: i64) -> Result<(), PgComputerError> {
        sqlx::query!("DELETE FROM hosted_runtime_effect WHERE id = $1", id)
            .execute(&self.pool)
            .await?;
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
                    computer_id: row.computer_id,
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
        now: DateTime<Utc>,
    ) -> Result<Option<Computer>, PgComputerError> {
        let mut tx = self.pool.begin().await?;
        let deleted = sqlx::query!(
            r#"
            DELETE FROM hosted_runtime_timer
            WHERE computer_id = $1 AND kind = $2 AND fire_at = $3
            "#,
            timer.computer_id,
            timer.kind.as_ref(),
            timer.fire_at,
        )
        .execute(&mut *tx)
        .await?;
        if deleted.rows_affected() == 0 {
            return Ok(None);
        }
        let computer =
            Self::apply_locked(&mut tx, timer.computer_id, &timer.kind.event(), now).await?;
        tx.commit().await?;
        Ok(computer)
    }

    async fn register_host(&self, registration: HostRegistration) -> Result<Host, PgComputerError> {
        let awake = i32::try_from(registration.awake_capacity_units()).unwrap_or(i32::MAX);
        let sold = i32::try_from(registration.sold_capacity_units()).unwrap_or(i32::MAX);
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
            id: row.id,
            name: row.name,
            awake_capacity_units: u32::try_from(row.awake_capacity_units).unwrap_or(0),
            sold_capacity_units: u32::try_from(row.sold_capacity_units).unwrap_or(0),
        })
    }

    async fn sold_out_sizes(&self) -> Result<Vec<ComputerSize>, PgComputerError> {
        let free = sqlx::query_scalar!(
            r#"
            SELECT COALESCE(MAX(free), 0)::INTEGER AS "free!"
            FROM (
                SELECT host.sold_capacity_units - COALESCE(SUM(computer.units), 0) AS free
                FROM hosted_runtime_host host
                LEFT JOIN hosted_runtime computer
                    ON computer.host_id = host.id AND computer.holds_units
                GROUP BY host.id, host.sold_capacity_units
            ) hosts
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(ComputerSize::ALL
            .into_iter()
            .filter(|size| units(*size) > free)
            .collect())
    }

    async fn request_notify(
        &self,
        team_id: Uuid,
        user_id: String,
        size: ComputerSize,
    ) -> Result<(), PgComputerError> {
        sqlx::query!(
            r#"
            INSERT INTO hosted_runtime_waitlist (team_id, user_id, size)
            VALUES ($1, $2, $3)
            ON CONFLICT DO NOTHING
            "#,
            team_id,
            user_id,
            size.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn notify_requests(
        &self,
        team_id: Uuid,
        user_id: String,
    ) -> Result<Vec<ComputerSize>, PgComputerError> {
        let sizes = sqlx::query_scalar!(
            "SELECT size FROM hosted_runtime_waitlist WHERE team_id = $1 AND user_id = $2",
            team_id,
            user_id,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(sizes
            .iter()
            .filter_map(|size| size.parse::<ComputerSize>().ok())
            .collect())
    }
}
