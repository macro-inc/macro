//! Reading computer rows and the healthy owners of pending work.

use super::*;

impl PgComputerRepo {
    pub(super) async fn fetch_many(
        &self,
        rows: Vec<ComputerRow>,
    ) -> Result<Vec<ComputerRecord>, PgComputerError> {
        Ok(rows.into_iter().map(Self::decode_row).collect())
    }

    /// Validate work owners before applying a batch limit, so corrupt owners cannot starve it.
    pub(super) async fn host_records(
        &self,
        host: HostId,
    ) -> Result<Vec<ComputerRecord>, PgComputerError> {
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

    pub(super) async fn healthy_ids(
        &self,
        rows: Vec<ComputerRow>,
    ) -> Result<Vec<Uuid>, PgComputerError> {
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

    pub(super) async fn healthy_effect_owners(
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

    pub(super) async fn healthy_timer_owners(
        &self,
        now: DateTime<Utc>,
    ) -> Result<Vec<Uuid>, PgComputerError> {
        let rows = sqlx::query_as!(ComputerRow,
            r#"SELECT id, team_id, host_id, name, size AS "size: ComputerSize", vcpus, memory_gib, disk_gib, catalog_entry, price_id, comp_reason, state, harness_id, created_by, created_at, enrolled_at, enrollment_generation, setup_completed_at, default_agent_id, image FROM hosted_runtime
             WHERE id IN (SELECT computer_id FROM hosted_runtime_timer WHERE fire_at <= $1)"#,
            now,
        ).fetch_all(&self.pool).await?;
        self.healthy_ids(rows).await
    }
}
