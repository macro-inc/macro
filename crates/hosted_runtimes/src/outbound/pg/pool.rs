//! The warm pool: taking a pool computer for a purchase, listing a host's
//! pool computers and adding one.

use super::*;

use crate::domain::lifecycle::ClaimBilling;
use crate::domain::models::{Claim, NewPoolComputer, Ownership, PoolMember};
use crate::domain::pool::PoolKind;

impl PgComputerRepo {
    pub(super) async fn claim(
        &self,
        purchase: &NewReservation,
        billing: ClaimBilling,
        now: DateTime<Utc>,
    ) -> Result<Claim, PgComputerError> {
        let mut tx = self.pool.begin().await?;

        // The same host locks `reserve` takes, so a claim and a reservation
        // never both count the last sold units, nor both use one purchase key.
        sqlx::query!("SELECT id FROM hosted_runtime_host ORDER BY id FOR UPDATE")
            .fetch_all(&mut *tx)
            .await?;
        let key = purchase.purchase_key.as_str();
        // A key used before is answered by `reserve`, which knows what it led to.
        if Self::computer_by_purchase_key(&mut tx, key)
            .await?
            .is_some()
            || Self::reservation_by_purchase_key(&mut tx, key)
                .await?
                .is_some()
        {
            return Ok(Claim::Unavailable);
        }
        if matches!(purchase.funding, Funding::Stripe { .. }) {
            let unpaid = sqlx::query_scalar!(
                r#"
                SELECT EXISTS (
                    SELECT 1 FROM hosted_runtime
                    WHERE team_id = $1 AND (state->'billing'->>'billing') = 'charging'
                ) AS "unpaid!"
                "#,
                purchase.team_id,
            )
            .fetch_one(&mut *tx)
            .await?;
            if unpaid {
                return Ok(Claim::Unavailable);
            }
        }

        // A pool computer of the purchase's kind and exact resources, built
        // from the image its host creates that kind from, up and connected,
        // on a host with sold units left for it (pool computers hold none
        // until taken).
        let kind = PoolKind::for_purchase(purchase.agent.is_some());
        let row = sqlx::query_as!(
            ComputerRow,
            r#"
            WITH held AS (
                SELECT host_id, SUM(GREATEST((memory_gib::BIGINT + 7) / 8, (vcpus::BIGINT + 3) / 4)) AS units
                FROM (
                    SELECT host_id, memory_gib, vcpus FROM hosted_runtime
                    WHERE (state->'phase'->>'phase') <> 'destroying' AND team_id IS NOT NULL
                    UNION ALL
                    SELECT host_id, memory_gib, vcpus FROM computer_reservation
                ) holdings
                GROUP BY host_id
            )
            SELECT c.id, c.team_id, c.host_id, c.name, c.size AS "size: ComputerSize", c.vcpus, c.memory_gib, c.disk_gib, c.catalog_entry, c.price_id, c.comp_reason, c.state, c.harness_id, c.created_by,
                   c.created_at, c.enrolled_at, c.enrollment_generation, c.setup_completed_at, c.default_agent_id, c.image
            FROM hosted_runtime c
            JOIN hosted_runtime_host host ON host.id = c.host_id
            LEFT JOIN held ON held.host_id = host.id
            WHERE c.team_id IS NULL AND c.pool_kind = $6
              AND c.size = $1 AND c.vcpus = $2 AND c.memory_gib = $3 AND c.disk_gib = $4
              AND c.image = (CASE WHEN $6 = 'agent'::hosted_runtime_pool_kind THEN host.agent_image ELSE host.image END)
              AND (c.state->'phase'->>'phase') = 'running'
              AND (c.state->>'macrod_connected') = 'true'
              AND host.sold_capacity_units - COALESCE(held.units, 0) >= $5::BIGINT
            ORDER BY c.created_at
            LIMIT 1
            FOR UPDATE OF c SKIP LOCKED
            "#,
            purchase.size as ComputerSize,
            i32::try_from(purchase.resources.vcpus.get())?,
            i32::try_from(purchase.resources.memory_gib.get())?,
            i32::try_from(purchase.resources.disk_gib.get())?,
            i64::from(units(purchase.resources)?),
            kind as PoolKind,
        )
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = row else {
            return Ok(Claim::Unavailable);
        };

        // An undecodable candidate is quarantined (and logged) and left in
        // place; this purchase takes the cold path instead of failing.
        let mut computer = match Self::decode_row(row) {
            ComputerRecord::Healthy(computer) => *computer,
            ComputerRecord::NeedsAttention { .. } => return Ok(Claim::Unavailable),
        };
        computer.owner = Some(Ownership {
            team_id: purchase.team_id,
            created_by: purchase.created_by.clone(),
            funding: purchase.funding.clone(),
        });
        computer.name = purchase.name.clone();
        computer.catalog_entry = purchase.catalog_entry.clone();
        computer.created_at = now;
        let computer = match Self::apply_to(
            &mut tx,
            computer,
            &Event::Claimed { billing },
            now,
            self.policy,
        )
        .await?
        {
            Applied::Changed(computer) => computer,
            // Not up and connected after all; a created computer is next.
            Applied::Rejected(_) => return Ok(Claim::Unavailable),
        };

        let (price_id, comp_reason) = match &purchase.funding {
            Funding::Stripe { price_id } => (Some(price_id.as_str()), None),
            Funding::Comped { reason } => (None, Some(reason.as_str())),
        };
        sqlx::query!(
            r#"
            UPDATE hosted_runtime
            SET team_id = $2, created_by = $3, purchase_key = $4, name = $5, catalog_entry = $6,
                price_id = $7, comp_reason = $8, created_at = $9, agent_user_id = $10
            WHERE id = $1
            "#,
            computer.id.as_uuid(),
            purchase.team_id,
            purchase.created_by.as_ref(),
            key,
            purchase.name.as_str(),
            purchase.catalog_entry.as_str(),
            price_id,
            comp_reason,
            now,
            purchase.agent.as_ref().map(|agent| agent.as_ref()),
        )
        .execute(&mut *tx)
        .await?;

        // The harness becomes the team's in the same transaction, so a
        // purchase gets the whole computer or leaves it in the pool.
        let joined = harnesses::outbound::pg_harness_repo::join_hosted_harness(
            &mut tx,
            computer.id,
            purchase.team_id,
            purchase.name.as_str(),
            &purchase.created_by,
        )
        .await
        .map_err(PgComputerError::Harness)?;
        if !joined {
            tracing::warn!(computer_id = %computer.id, "a connected pool computer has no harness; not taking it");
            return Ok(Claim::Unavailable);
        }
        tx.commit().await?;
        Ok(Claim::Taken(computer))
    }

    pub(super) async fn live_pool_computers(
        &self,
        host: HostId,
    ) -> Result<Vec<PoolMember>, PgComputerError> {
        let kinds: std::collections::HashMap<Uuid, PoolKind> = sqlx::query!(
            r#"
            SELECT id, pool_kind AS "pool_kind!: PoolKind" FROM hosted_runtime
            WHERE host_id = $1 AND team_id IS NULL AND pool_kind IS NOT NULL
              AND (state->'phase'->>'phase') <> 'destroying'
            "#,
            host.into_inner(),
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|row| (row.id, row.pool_kind))
        .collect();
        let rows = sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT id, team_id, host_id, name, size AS "size: ComputerSize", vcpus, memory_gib, disk_gib, catalog_entry, price_id, comp_reason, state, harness_id, created_by,
                   created_at, enrolled_at, enrollment_generation, setup_completed_at, default_agent_id, image
            FROM hosted_runtime
            WHERE host_id = $1 AND team_id IS NULL AND (state->'phase'->>'phase') <> 'destroying'
            ORDER BY created_at
            "#,
            host.into_inner(),
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(self
            .fetch_many(rows)
            .await?
            .into_iter()
            .filter_map(|record| record.into_healthy().ok())
            .filter_map(|computer| {
                let kind = *kinds.get(&computer.id.as_uuid())?;
                Some(PoolMember { kind, computer })
            })
            .collect())
    }

    pub(super) async fn pool_kind_of(
        &self,
        computer_id: ComputerId,
    ) -> Result<Option<PoolKind>, PgComputerError> {
        Ok(sqlx::query_scalar!(
            r#"SELECT pool_kind AS "pool_kind: PoolKind" FROM hosted_runtime WHERE id = $1"#,
            computer_id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await?
        .flatten())
    }

    pub(super) async fn insert_pool_computer(
        &self,
        computer: NewPoolComputer,
        target: u32,
        now: DateTime<Utc>,
    ) -> Result<Option<Computer>, PgComputerError> {
        let mut tx = self.pool.begin().await?;
        // Locks the host first, serializing passes that fill the same pool.
        let host_has_room =
            Self::host_has_room(&mut tx, computer.host, computer.id, computer.resources).await?;
        let pooled = sqlx::query_scalar!(
            r#"
            SELECT count(*) AS "pooled!" FROM hosted_runtime
            WHERE host_id = $1 AND team_id IS NULL AND size = $2 AND pool_kind = $3
              AND (state->'phase'->>'phase') <> 'destroying'
            "#,
            computer.host.into_inner(),
            computer.size as ComputerSize,
            computer.kind as PoolKind,
        )
        .fetch_one(&mut *tx)
        .await?;
        if !host_has_room || pooled >= i64::from(target) {
            return Ok(None);
        }

        let (state, effects) = provision(
            Billing::Pool,
            None,
            None,
            Context {
                host: computer.host,
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
        sqlx::query!(
            r#"
            INSERT INTO hosted_runtime
                (id, name, size, vcpus, memory_gib, disk_gib, catalog_entry, host_id, awake,
                 state, enrollment_generation, created_at, updated_at, pool_kind)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13)
            "#,
            computer.id.as_uuid(),
            computer.name.as_str(),
            computer.size as ComputerSize,
            i32::try_from(computer.resources.vcpus.get())?,
            i32::try_from(computer.resources.memory_gib.get())?,
            i32::try_from(computer.resources.disk_gib.get())?,
            computer.catalog_entry.as_str(),
            computer.host.into_inner(),
            state.is_awake(),
            serde_json::to_value(&state)?,
            i64::from(generation.get()),
            now,
            computer.kind as PoolKind,
        )
        .execute(&mut *tx)
        .await?;
        Self::store_effects(&mut tx, computer.id, effects, now).await?;
        tx.commit().await?;

        Ok(Some(Computer {
            id: computer.id,
            owner: None,
            name: computer.name,
            size: computer.size,
            resources: computer.resources,
            catalog_entry: computer.catalog_entry,
            host: computer.host,
            state,
            harness_id: None,
            enrollment_generation: generation,
            created_at: now,
            enrolled_at: None,
            setup_completed_at: None,
            default_agent_id: None,
            image: None,
        }))
    }
}
