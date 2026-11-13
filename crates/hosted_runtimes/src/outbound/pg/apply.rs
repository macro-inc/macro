//! Applying lifecycle events under the host and computer locks.

use super::*;

impl PgComputerRepo {
    /// Serialize host transitions before locking computer or timer rows.
    pub(super) async fn lock_host(
        tx: &mut Tx<'_>,
        computer_id: ComputerId,
    ) -> Result<(), PgComputerError> {
        sqlx::query!(
            "SELECT host.id FROM hosted_runtime_host host JOIN hosted_runtime computer ON computer.host_id = host.id WHERE computer.id = $1 FOR UPDATE OF host",
            computer_id.as_uuid(),
        ).fetch_optional(&mut **tx).await?;
        Ok(())
    }

    /// Store a transition's effects (the outbox) and timers.
    pub(super) async fn store_effects(
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

    /// Lock the computer (after its host) in `tx`, run the transition, and
    /// store its state, effects and timers. A rejected request writes nothing.
    pub(super) async fn apply_locked(
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
        let computer = Computer::try_from(row)?;
        Self::apply_to(tx, computer, event, now, policy)
            .await
            .map(Some)
    }

    /// Run the transition for `computer`, whose row and host `tx` already
    /// locked, and store its state, effects and timers. A rejected request
    /// writes nothing.
    #[tracing::instrument(name = "computer.lifecycle.event", skip_all, fields(computer_id = %computer.id, event, phase, team_id, size, billing_kind, rejected, otel.status_code), err)]
    pub(super) async fn apply_to(
        tx: &mut Tx<'_>,
        mut computer: Computer,
        event: &Event,
        now: DateTime<Utc>,
        policy: BillingPolicy,
    ) -> Result<Applied, PgComputerError> {
        let computer_id = computer.id;
        crate::domain::telemetry::resume(computer.state.provision_traceparent.as_deref());
        let span = tracing::Span::current();
        span.record("team_id", tracing::field::debug(computer.team_id()));
        span.record("size", computer.size.as_ref());
        span.record("billing_kind", computer.funding_kind());
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
                return Ok(Applied::Rejected(rejected));
            }
        };
        if state == computer.state && effects.is_empty() {
            return Ok(Applied::Changed(Box::new(computer)));
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
        Ok(Applied::Changed(Box::new(computer)))
    }

    pub(super) fn record_setup(
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
                    team_id: computer
                        .team_id()
                        .map(|team_id| team_id.to_string())
                        .unwrap_or_default(),
                    size: computer.size.as_ref().to_owned(),
                    host_id: Some(computer.host.to_string()),
                    generation: i64::from(computer.enrollment_generation.get()),
                    billing_kind: computer.funding_kind(),
                },
            );
        }
    }

    /// Whether a computer of `resources` fits among the host's other awake
    /// computers. Locks the host row so concurrent starts on one host are serialized.
    pub(super) async fn host_has_room(
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
}
