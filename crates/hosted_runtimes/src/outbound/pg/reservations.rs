//! Purchase reservations: lookups by purchase key and their insertion.

use super::*;

impl PgComputerRepo {
    pub(super) fn reservations(
        rows: Vec<ReservationRow>,
    ) -> Result<Vec<Reservation>, PgComputerError> {
        rows.into_iter()
            .map(|row| Reservation::try_from(row).map_err(PgComputerError::from))
            .collect()
    }

    pub(super) async fn computer_by_purchase_key(
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

    pub(super) async fn reservation_by_purchase_key(
        tx: &mut Tx<'_>,
        purchase_key: &str,
    ) -> Result<Option<Reservation>, PgComputerError> {
        sqlx::query_as!(
            ReservationRow,
            r#"
            SELECT id, team_id, host_id, size AS "size: ComputerSize", vcpus, memory_gib, disk_gib, catalog_entry, price_id, comp_reason, name,
                   purchase_key, created_by, extra_items, provision_traceparent, expires_at, created_at, agent_user_id
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

    pub(super) async fn insert_reservation(
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
            WHERE host.awake_capacity_units >= $1::BIGINT
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
                 expires_at, created_at, agent_user_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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
            reservation.agent.as_ref().map(|agent| agent.as_ref()),
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
            agent: reservation.agent,
        }))
    }
}
