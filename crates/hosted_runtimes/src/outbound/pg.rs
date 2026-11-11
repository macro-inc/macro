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
    Billing, BillingPolicy, ComputerState, Context, Effect, EffectWorker, Event, HostId, TimerKind,
    provision, transition,
};
use crate::domain::models::{
    Computer, ComputerRecord, Funding, Host, HostRegistration, NewReservation, Reservation,
    Reserved, SanitizedReason,
};
use crate::domain::ports::{Applied, ComputerRepo, DueTimer, PendingEffect, ReserveError};
use crate::domain::size::{ComputerResources, ComputerSize};

mod row;
use row::{ComputerRow, ReservationRow};

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
    /// Only fleet and billing effects are stored in the outbox.
    #[error("{0:?} effects are not stored in the outbox")]
    NotAnOutboxWorker(EffectWorker),
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

/// The outbox's `computer_effect_worker`: the workers that lease effects.
#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type)]
#[sqlx(type_name = "computer_effect_worker", rename_all = "snake_case")]
enum OutboxWorker {
    Fleet,
    Billing,
}

impl TryFrom<EffectWorker> for OutboxWorker {
    type Error = PgComputerError;
    fn try_from(worker: EffectWorker) -> Result<Self, Self::Error> {
        match worker {
            EffectWorker::Fleet => Ok(Self::Fleet),
            EffectWorker::Billing => Ok(Self::Billing),
            EffectWorker::Timers => Err(PgComputerError::NotAnOutboxWorker(worker)),
        }
    }
}

/// Postgres storage for computers, capacity and lifecycle work.
#[derive(Clone)]
pub struct PgComputerRepo {
    pool: PgPool,
    guards: PgPool,
    policy: BillingPolicy,
}

impl PgComputerRepo {
    /// Build a repository with a separate pool for long-lived guards, applying
    /// transitions under the deployment's billing `policy`.
    pub fn new(pool: PgPool, policy: BillingPolicy) -> Self {
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
        Self {
            pool,
            guards,
            policy,
        }
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

type Tx<'a> = sqlx::Transaction<'a, sqlx::Postgres>;

impl PgComputerRepo {
    /// Serialize host transitions before locking computer or timer rows.
    async fn lock_host(tx: &mut Tx<'_>, computer_id: ComputerId) -> Result<(), PgComputerError> {
        sqlx::query!(
            "SELECT host.id FROM hosted_runtime_host host JOIN hosted_runtime computer ON computer.host_id = host.id WHERE computer.id = $1 FOR UPDATE OF host",
            computer_id.as_uuid(),
        ).fetch_optional(&mut **tx).await?;
        Ok(())
    }

    /// Store a transition's effects (the outbox) and timers.
    async fn store_effects(
        tx: &mut Tx<'_>,
        computer_id: ComputerId,
        effects: Vec<Effect>,
        now: DateTime<Utc>,
    ) -> Result<(), PgComputerError> {
        for effect in effects {
            match effect {
                Effect::ScheduleTimer { kind, at } => {
                    sqlx::query!(
                        r#"
                        INSERT INTO hosted_runtime_timer (computer_id, kind, fire_at)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (computer_id, kind) DO UPDATE SET fire_at = EXCLUDED.fire_at
                        "#,
                        computer_id.as_uuid(),
                        kind as TimerKind,
                        at,
                    )
                    .execute(&mut **tx)
                    .await?;
                }
                effect => {
                    let worker = OutboxWorker::try_from(effect.worker())?;
                    sqlx::query!(
                        r#"
                        INSERT INTO hosted_runtime_effect (computer_id, worker, effect, run_after, created_at)
                        VALUES ($1, $2, $3, $4, $4)
                        "#,
                        computer_id.as_uuid(),
                        worker as OutboxWorker,
                        serde_json::to_value(&effect)?,
                        now,
                    )
                    .execute(&mut **tx)
                    .await?;
                }
            }
        }
        Ok(())
    }

    /// Run the transition for a computer already locked in `tx`, and store
    /// its state, effects and timers. A rejected request writes nothing.
    #[tracing::instrument(name = "computer.lifecycle.event", skip_all, fields(%computer_id, event, phase, team_id, size, billing_kind, rejected, otel.status_code), err)]
    async fn apply_locked(
        tx: &mut Tx<'_>,
        computer_id: ComputerId,
        event: &Event,
        now: DateTime<Utc>,
        policy: BillingPolicy,
    ) -> Result<Option<Applied>, PgComputerError> {
        Self::lock_host(tx, computer_id).await?;
        let row = sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT id, team_id, host_id, name, size AS "size: ComputerSize", vcpus, memory_gib, disk_gib, catalog_entry, price_id, comp_reason, state, harness_id, created_by,
                   created_at, enrolled_at, enrollment_generation, setup_completed_at, default_agent_id, image
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
        span.record("billing_kind", computer.funding.kind());
        // Read only the enum tag; reasons and other event payloads are private.
        if let Some(tag) = serde_json::to_value(event)?
            .get("event")
            .and_then(serde_json::Value::as_str)
        {
            span.record("event", tag);
        }

        let host = computer.host;
        let host_has_room = Self::host_has_room(tx, host, computer.id, computer.resources).await?;
        let transitioned = transition(
            &computer.state,
            event,
            Context {
                host,
                now,
                host_has_room,
                enrollment_generation: computer.enrollment_generation,
                policy,
            },
        );
        let (mut state, effects) = match transitioned {
            Ok(next) => next,
            Err(rejected) => {
                span.record("rejected", tracing::field::debug(rejected));
                return Ok(Some(Applied::Rejected(rejected)));
            }
        };
        if state == computer.state && effects.is_empty() {
            return Ok(Some(Applied::Changed(Box::new(computer))));
        }
        for effect in &effects {
            if let Effect::Create { generation, .. } = effect {
                computer.enrollment_generation = *generation;
            }
        }
        Self::store_effects(tx, computer_id, effects, now).await?;

        if let Some(tag) = serde_json::to_value(&state.phase)?
            .get("phase")
            .and_then(serde_json::Value::as_str)
        {
            span.record("phase", tag);
        }

        let waiting_for_capacity = state.waiting_for_capacity();
        let (phase, connected) = (state.phase.clone(), state.macrod_connected);
        let finished_setup = state
            .setup
            .as_mut()
            .map(|setup| setup.advance(&phase, connected, waiting_for_capacity, now))
            .unwrap_or_default();

        if !state.is_live() {
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
            SET state = $2, awake = $3, version = version + 1, updated_at = $4,
                enrollment_generation = $5
            WHERE id = $1
            "#,
            computer_id.as_uuid(),
            serde_json::to_value(&state)?,
            state.is_awake(),
            now,
            i64::from(computer.enrollment_generation.get()),
        )
        .execute(&mut **tx)
        .await?;

        if computer.state.is_awake() && !state.is_awake() {
            // A timer avoids locking another computer while applying this one.
            sqlx::query!(
                r#"
                INSERT INTO hosted_runtime_timer (computer_id, kind, fire_at)
                SELECT id, 'capacity_changed'::computer_timer_kind, $2 FROM hosted_runtime
                WHERE host_id = $1 AND id <> $3
                    AND state->>'power' = 'on' AND state->>'power_on_requested' = 'true'
                    AND state->'phase'->>'phase' IN ('stopped', 'provisioning')
                ON CONFLICT (computer_id, kind) DO UPDATE SET fire_at = LEAST(hosted_runtime_timer.fire_at, EXCLUDED.fire_at)
                "#,
                host.into_inner(),
                now,
                computer_id.as_uuid(),
            )
            .execute(&mut **tx)
            .await?;
        }
        if state.capacity_wait.map(|wait| wait.next_at)
            != computer.state.capacity_wait.map(|wait| wait.next_at)
            && let Some(wait) = &state.capacity_wait
            && wait.next_at > now
        {
            tracing::info!(computer_id = %computer_id, host_id = %host,
                attempt = wait.attempt, retry_at = %wait.next_at,
                "computer waiting for host capacity");
        }
        Self::record_setup(&computer, &state, &finished_setup);
        computer.state = state;
        Ok(Some(Applied::Changed(Box::new(computer))))
    }

    fn record_setup(
        computer: &Computer,
        state: &ComputerState,
        finished: &[crate::domain::setup::PhaseTiming],
    ) {
        if let Some(setup) = &state.setup {
            crate::domain::telemetry::record_setup_waits(
                state.provision_traceparent.as_deref(),
                setup,
                finished,
                &crate::domain::telemetry::SetupAttributes {
                    computer_id: computer.id.to_string(),
                    team_id: computer.team_id.to_string(),
                    size: computer.size.as_ref().to_owned(),
                    host_id: Some(computer.host.to_string()),
                    generation: i64::from(computer.enrollment_generation.get()),
                    billing_kind: computer.funding.kind(),
                },
            );
        }
    }

    /// Whether a computer of `resources` fits among the host's other awake
    /// computers. Locks the host row so concurrent starts on one host are serialized.
    async fn host_has_room(
        tx: &mut Tx<'_>,
        host: HostId,
        computer_id: ComputerId,
        resources: ComputerResources,
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
            computer_id.as_uuid(),
        )
        .fetch_one(&mut **tx)
        .await?;

        Ok(others + units(resources)? <= capacity)
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
            SELECT id, team_id, host_id, name, size AS "size: ComputerSize", vcpus, memory_gib, disk_gib, catalog_entry, price_id, comp_reason, state, harness_id, created_by,
                   created_at, enrolled_at, enrollment_generation, setup_completed_at, default_agent_id, image
            FROM hosted_runtime
            WHERE host_id = $1
            "#,
            host.into_inner(),
        )
        .fetch_all(&self.pool)
        .await?;
        self.fetch_many(rows).await
    }

    async fn healthy_ids(&self, rows: Vec<ComputerRow>) -> Result<Vec<Uuid>, PgComputerError> {
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

    async fn healthy_effect_owners(
        &self,
        worker: OutboxWorker,
        now: DateTime<Utc>,
    ) -> Result<Vec<Uuid>, PgComputerError> {
        let rows = sqlx::query_as!(ComputerRow,
            r#"SELECT id, team_id, host_id, name, size AS "size: ComputerSize", vcpus, memory_gib, disk_gib, catalog_entry, price_id, comp_reason, state, harness_id, created_by, created_at, enrolled_at, enrollment_generation, setup_completed_at, default_agent_id, image FROM hosted_runtime
             WHERE id IN (SELECT computer_id FROM hosted_runtime_effect WHERE worker = $1 AND run_after <= $2)"#,
            worker as OutboxWorker, now,
        ).fetch_all(&self.pool).await?;
        self.healthy_ids(rows).await
    }

    async fn healthy_timer_owners(&self, now: DateTime<Utc>) -> Result<Vec<Uuid>, PgComputerError> {
        let rows = sqlx::query_as!(ComputerRow,
            r#"SELECT id, team_id, host_id, name, size AS "size: ComputerSize", vcpus, memory_gib, disk_gib, catalog_entry, price_id, comp_reason, state, harness_id, created_by, created_at, enrolled_at, enrollment_generation, setup_completed_at, default_agent_id, image FROM hosted_runtime
             WHERE id IN (SELECT computer_id FROM hosted_runtime_timer WHERE fire_at <= $1)"#,
            now,
        ).fetch_all(&self.pool).await?;
        self.healthy_ids(rows).await
    }

    fn reservations(rows: Vec<ReservationRow>) -> Result<Vec<Reservation>, PgComputerError> {
        rows.into_iter()
            .map(|row| Reservation::try_from(row).map_err(PgComputerError::from))
            .collect()
    }

    async fn computer_by_purchase_key(
        tx: &mut Tx<'_>,
        purchase_key: &str,
    ) -> Result<Option<ComputerRecord>, PgComputerError> {
        Ok(sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT id, team_id, host_id, name, size AS "size: ComputerSize", vcpus, memory_gib, disk_gib, catalog_entry, price_id, comp_reason, state, harness_id, created_by,
                   created_at, enrolled_at, enrollment_generation, setup_completed_at, default_agent_id, image
            FROM hosted_runtime
            WHERE purchase_key = $1
            "#,
            purchase_key,
        )
        .fetch_optional(&mut **tx)
        .await?
        .map(Self::decode_row))
    }

    async fn reservation_by_purchase_key(
        tx: &mut Tx<'_>,
        purchase_key: &str,
    ) -> Result<Option<Reservation>, PgComputerError> {
        sqlx::query_as!(
            ReservationRow,
            r#"
            SELECT id, team_id, host_id, size AS "size: ComputerSize", vcpus, memory_gib, disk_gib, catalog_entry, price_id, comp_reason, name,
                   purchase_key, created_by, extra_items, provision_traceparent, expires_at, created_at
            FROM computer_reservation
            WHERE purchase_key = $1
            "#,
            purchase_key,
        )
        .fetch_optional(&mut **tx)
        .await?
        .map(|row| Reservation::try_from(row).map_err(PgComputerError::from))
        .transpose()
    }

    async fn insert_reservation(
        &self,
        reservation: NewReservation,
        now: DateTime<Utc>,
        expires_at: DateTime<Utc>,
    ) -> Result<Reserved, ReserveError<PgComputerError>> {
        let storage = |error: PgComputerError| ReserveError::Storage(error);
        let computer_units = units(reservation.resources).map_err(storage)?;
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|error| storage(error.into()))?;

        // Lock every host: purchases are rare and hosts few, and this keeps
        // two purchases from both taking the last units (or both using one key).
        sqlx::query!("SELECT id FROM hosted_runtime_host ORDER BY id FOR UPDATE")
            .fetch_all(&mut *tx)
            .await
            .map_err(|error| storage(error.into()))?;
        let key = reservation.purchase_key.as_str();
        if let Some(record) = Self::computer_by_purchase_key(&mut tx, key)
            .await
            .map_err(storage)?
        {
            return Ok(Reserved::Purchased(Box::new(record)));
        }
        if let Some(pending) = Self::reservation_by_purchase_key(&mut tx, key)
            .await
            .map_err(storage)?
        {
            return Ok(Reserved::Pending(pending));
        }
        // Read holdings in a new statement after any host-lock wait.
        let host = sqlx::query_scalar!(
            r#"
            WITH held AS (
                SELECT host_id, GREATEST((memory_gib::BIGINT + 7) / 8, (vcpus::BIGINT + 3) / 4) AS units
                FROM hosted_runtime WHERE (state->'phase'->>'phase') <> 'destroying'
                UNION ALL
                SELECT host_id, GREATEST((memory_gib::BIGINT + 7) / 8, (vcpus::BIGINT + 3) / 4)
                FROM computer_reservation
            )
            SELECT host.id
            FROM hosted_runtime_host host
            LEFT JOIN held ON held.host_id = host.id
            GROUP BY host.id, host.sold_capacity_units
            HAVING host.sold_capacity_units - COALESCE(SUM(held.units), 0) >= $1::BIGINT
            ORDER BY host.sold_capacity_units - COALESCE(SUM(held.units), 0) DESC
            LIMIT 1
            "#,
            i64::from(computer_units),
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| storage(error.into()))?;
        let Some(host) = host else {
            return Err(ReserveError::SoldOut);
        };

        let (price_id, comp_reason) = match &reservation.funding {
            Funding::Stripe { price_id } => (Some(price_id.as_str()), None),
            Funding::Comped { reason } => (None, Some(reason.as_str())),
        };
        let int = |value: u32| i32::try_from(value).map_err(|error| storage(error.into()));
        sqlx::query!(
            r#"
            INSERT INTO computer_reservation
                (id, team_id, host_id, size, vcpus, memory_gib, disk_gib, catalog_entry, price_id,
                 comp_reason, name, purchase_key, created_by, extra_items, provision_traceparent,
                 expires_at, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            "#,
            reservation.id.as_uuid(),
            reservation.team_id,
            host,
            reservation.size as ComputerSize,
            int(reservation.resources.vcpus.get())?,
            int(reservation.resources.memory_gib.get())?,
            int(reservation.resources.disk_gib.get())?,
            reservation.catalog_entry.as_str(),
            price_id,
            comp_reason,
            reservation.name.as_str(),
            key,
            reservation.created_by.as_ref(),
            serde_json::to_value(&reservation.extra_items)
                .map_err(|error| storage(error.into()))?,
            reservation.provision_traceparent.as_deref(),
            expires_at,
            now,
        )
        .execute(&mut *tx)
        .await
        .map_err(|error| storage(error.into()))?;
        tx.commit().await.map_err(|error| storage(error.into()))?;

        Ok(Reserved::New(Reservation {
            id: reservation.id,
            team_id: reservation.team_id,
            host: HostId::new(host),
            purchase_key: reservation.purchase_key,
            name: reservation.name,
            size: reservation.size,
            resources: reservation.resources,
            catalog_entry: reservation.catalog_entry,
            funding: reservation.funding,
            created_by: reservation.created_by,
            extra_items: reservation.extra_items,
            provision_traceparent: reservation.provision_traceparent,
            expires_at,
            created_at: now,
        }))
    }
}

impl ComputerRepo for PgComputerRepo {
    type Err = PgComputerError;
    type EnrollmentGuard = sqlx::Transaction<'static, sqlx::Postgres>;
    type BillingGuard = sqlx::Transaction<'static, sqlx::Postgres>;

    fn policy(&self) -> BillingPolicy {
        self.policy
    }

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
    async fn lock_billing(
        &self,
        computer_id: ComputerId,
    ) -> Result<Self::BillingGuard, PgComputerError> {
        let mut guard = self.guards.begin().await?;
        let key = format!("hosted-billing:{computer_id}");
        sqlx::query!("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key)
            .execute(&mut *guard)
            .await?;
        Ok(guard)
    }

    #[tracing::instrument(skip(self, reservation), fields(computer_id = %reservation.id), err)]
    async fn reserve(
        &self,
        reservation: NewReservation,
        now: DateTime<Utc>,
        expires_at: DateTime<Utc>,
    ) -> Result<Reserved, ReserveError<PgComputerError>> {
        self.insert_reservation(reservation, now, expires_at).await
    }

    #[tracing::instrument(skip(self, billing), err)]
    async fn convert_reservation(
        &self,
        reservation_id: ComputerId,
        billing: Billing,
        now: DateTime<Utc>,
    ) -> Result<Option<Computer>, PgComputerError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query!(
            "SELECT host.id FROM hosted_runtime_host host JOIN computer_reservation reservation ON reservation.host_id = host.id WHERE reservation.id = $1 FOR UPDATE OF host",
            reservation_id.as_uuid(),
        )
        .fetch_optional(&mut *tx)
        .await?;
        let row = sqlx::query_as!(
            ReservationRow,
            r#"
            DELETE FROM computer_reservation WHERE id = $1
            RETURNING id, team_id, host_id, size AS "size: ComputerSize", vcpus, memory_gib, disk_gib, catalog_entry, price_id, comp_reason, name,
                      purchase_key, created_by, extra_items, provision_traceparent, expires_at, created_at
            "#,
            reservation_id.as_uuid(),
        )
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = row else {
            tx.commit().await?;
            return Ok(None);
        };
        let reservation = Reservation::try_from(row)?;
        let host_has_room = Self::host_has_room(
            &mut tx,
            reservation.host,
            reservation.id,
            reservation.resources,
        )
        .await?;
        let (mut state, effects) = provision(
            billing,
            crate::domain::setup::SetupTimeline::started(reservation.created_at),
            reservation.provision_traceparent.clone(),
            Context {
                host: reservation.host,
                enrollment_generation: Default::default(),
                now,
                host_has_room,
                policy: self.policy,
            },
        );
        let generation = effects
            .iter()
            .find_map(|effect| match effect {
                Effect::Create { generation, .. } => Some(*generation),
                _ => None,
            })
            .unwrap_or_default();
        let waiting_for_capacity = state.waiting_for_capacity();
        let phase = state.phase.clone();
        let finished_setup = state
            .setup
            .as_mut()
            .map(|setup| setup.advance(&phase, false, waiting_for_capacity, now))
            .unwrap_or_default();
        let (price_id, comp_reason) = match &reservation.funding {
            Funding::Stripe { price_id } => (Some(price_id.as_str()), None),
            Funding::Comped { reason } => (None, Some(reason.as_str())),
        };
        sqlx::query!(
            r#"
            INSERT INTO hosted_runtime
                (id, team_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry, price_id,
                 comp_reason, purchase_key, host_id, awake, state, enrollment_generation,
                 created_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            "#,
            reservation.id.as_uuid(),
            reservation.team_id,
            reservation.name.as_str(),
            reservation.size as ComputerSize,
            i32::try_from(reservation.resources.vcpus.get())?,
            i32::try_from(reservation.resources.memory_gib.get())?,
            i32::try_from(reservation.resources.disk_gib.get())?,
            reservation.catalog_entry.as_str(),
            price_id,
            comp_reason,
            reservation.purchase_key.as_str(),
            reservation.host.into_inner(),
            state.is_awake(),
            serde_json::to_value(&state)?,
            i64::from(generation.get()),
            reservation.created_by.as_ref(),
            reservation.created_at,
            now,
        )
        .execute(&mut *tx)
        .await?;
        Self::store_effects(&mut tx, reservation.id, effects, now).await?;
        let computer = Computer {
            id: reservation.id,
            team_id: reservation.team_id,
            name: reservation.name,
            size: reservation.size,
            resources: reservation.resources,
            catalog_entry: reservation.catalog_entry,
            funding: reservation.funding,
            host: reservation.host,
            state,
            harness_id: None,
            enrollment_generation: generation,
            created_by: reservation.created_by,
            created_at: reservation.created_at,
            enrolled_at: None,
            setup_completed_at: None,
            default_agent_id: None,
            image: None,
        };
        tx.commit().await?;
        Self::record_setup(&computer, &computer.state, &finished_setup);
        Ok(Some(computer))
    }

    async fn delete_reservation(
        &self,
        reservation_id: ComputerId,
    ) -> Result<bool, PgComputerError> {
        let deleted = sqlx::query!(
            "DELETE FROM computer_reservation WHERE id = $1",
            reservation_id.as_uuid()
        )
        .execute(&self.pool)
        .await?;
        Ok(deleted.rows_affected() > 0)
    }

    async fn reservation(
        &self,
        reservation_id: ComputerId,
    ) -> Result<Option<Reservation>, PgComputerError> {
        sqlx::query_as!(
            ReservationRow,
            r#"
            SELECT id, team_id, host_id, size AS "size: ComputerSize", vcpus, memory_gib, disk_gib, catalog_entry, price_id, comp_reason, name,
                   purchase_key, created_by, extra_items, provision_traceparent, expires_at, created_at
            FROM computer_reservation WHERE id = $1
            "#,
            reservation_id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await?
        .map(|row| Reservation::try_from(row).map_err(PgComputerError::from))
        .transpose()
    }

    async fn team_reservations(&self, team_id: Uuid) -> Result<Vec<Reservation>, PgComputerError> {
        let rows = sqlx::query_as!(
            ReservationRow,
            r#"
            SELECT id, team_id, host_id, size AS "size: ComputerSize", vcpus, memory_gib, disk_gib, catalog_entry, price_id, comp_reason, name,
                   purchase_key, created_by, extra_items, provision_traceparent, expires_at, created_at
            FROM computer_reservation WHERE team_id = $1 ORDER BY created_at
            "#,
            team_id,
        )
        .fetch_all(&self.pool)
        .await?;
        Self::reservations(rows)
    }

    async fn reservations_created_before(
        &self,
        created_before: DateTime<Utc>,
        limit: u32,
    ) -> Result<Vec<Reservation>, PgComputerError> {
        let rows = sqlx::query_as!(
            ReservationRow,
            r#"
            SELECT id, team_id, host_id, size AS "size: ComputerSize", vcpus, memory_gib, disk_gib, catalog_entry, price_id, comp_reason, name,
                   purchase_key, created_by, extra_items, provision_traceparent, expires_at, created_at
            FROM computer_reservation WHERE created_at <= $1 ORDER BY created_at LIMIT $2
            "#,
            created_before,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await?;
        Self::reservations(rows)
    }

    #[tracing::instrument(skip(self, event), err)]
    async fn apply(
        &self,
        computer_id: ComputerId,
        event: Event,
        now: DateTime<Utc>,
    ) -> Result<Option<Applied>, PgComputerError> {
        let mut tx = self.pool.begin().await?;
        let applied = Self::apply_locked(&mut tx, computer_id, &event, now, self.policy).await?;
        tx.commit().await?;
        Ok(applied)
    }

    async fn get(
        &self,
        computer_id: ComputerId,
    ) -> Result<Option<ComputerRecord>, PgComputerError> {
        Ok(sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT id, team_id, host_id, name, size AS "size: ComputerSize", vcpus, memory_gib, disk_gib, catalog_entry, price_id, comp_reason, state, harness_id, created_by,
                   created_at, enrolled_at, enrollment_generation, setup_completed_at, default_agent_id, image
            FROM hosted_runtime
            WHERE id = $1
            "#,
            computer_id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await?
        .map(Self::decode_row))
    }

    async fn list_for_team(&self, team_id: Uuid) -> Result<Vec<ComputerRecord>, PgComputerError> {
        let rows = sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT id, team_id, host_id, name, size AS "size: ComputerSize", vcpus, memory_gib, disk_gib, catalog_entry, price_id, comp_reason, state, harness_id, created_by,
                   created_at, enrolled_at, enrollment_generation, setup_completed_at, default_agent_id, image
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
                    .is_none_or(|computer| computer.state.is_live())
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
            SELECT id, team_id, host_id, name, size AS "size: ComputerSize", vcpus, memory_gib, disk_gib, catalog_entry, price_id, comp_reason, state, harness_id, created_by,
                   created_at, enrolled_at, enrollment_generation, setup_completed_at, default_agent_id, image
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
            "UPDATE hosted_runtime SET image = $2 WHERE id = $1",
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
            RETURNING id, team_id, host_id, name, size AS "size: ComputerSize", vcpus, memory_gib, disk_gib, catalog_entry, price_id, comp_reason, state, harness_id, created_by,
                      created_at, enrolled_at, enrollment_generation, setup_completed_at, default_agent_id, image
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
                record
                    .healthy()
                    .is_none_or(|computer| computer.state.is_live())
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
        let worker = OutboxWorker::try_from(worker)?;
        let healthy_ids = self.healthy_effect_owners(worker, now).await?;
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
            worker as OutboxWorker,
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
                self.policy,
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
        let healthy_ids = self.healthy_timer_owners(now).await?;
        let rows = sqlx::query!(
            r#"
            SELECT computer_id, kind AS "kind: TimerKind", fire_at FROM hosted_runtime_timer
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

        Ok(rows
            .into_iter()
            .map(|row| DueTimer {
                computer_id: ComputerId::new_from_uuid(row.computer_id),
                kind: row.kind,
                fire_at: row.fire_at,
            })
            .collect())
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
            timer.kind as TimerKind,
            timer.fire_at,
        )
        .execute(&mut *tx)
        .await?;
        if deleted.rows_affected() == 0 {
            return Ok(None);
        }
        let applied = Self::apply_locked(
            &mut tx,
            timer.computer_id,
            &timer.kind.event(instance_status),
            now,
            self.policy,
        )
        .await?;
        tx.commit().await?;
        Ok(match applied {
            Some(Applied::Changed(computer)) => Some(*computer),
            // Timers deliver observations, which the lifecycle never rejects.
            Some(Applied::Rejected(_)) | None => None,
        })
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
        _now: DateTime<Utc>,
    ) -> Result<Vec<ComputerSize>, PgComputerError> {
        let free = sqlx::query_scalar!(
            r#"
            WITH held AS (
                SELECT host_id, GREATEST((memory_gib::BIGINT + 7) / 8, (vcpus::BIGINT + 3) / 4) AS units
                FROM hosted_runtime WHERE (state->'phase'->>'phase') <> 'destroying'
                UNION ALL
                SELECT host_id, GREATEST((memory_gib::BIGINT + 7) / 8, (vcpus::BIGINT + 3) / 4)
                FROM computer_reservation
            )
            SELECT COALESCE(MAX(free), 0)::INTEGER AS "free!"
            FROM (
                SELECT host.sold_capacity_units - COALESCE(SUM(held.units), 0) AS free
                FROM hosted_runtime_host host
                LEFT JOIN held ON held.host_id = host.id
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
            size as ComputerSize,
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
        Ok(sqlx::query_scalar!(
            r#"SELECT size AS "size: ComputerSize" FROM hosted_runtime_waitlist WHERE team_id = $1 AND user_id = $2"#,
            team_id,
            user_id.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?)
    }
}
