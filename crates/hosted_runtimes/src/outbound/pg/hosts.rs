//! Host rows: registration (hardware in, units out of the row's own
//! overcommit settings), how the control plane reaches each Firecracker
//! host, and how many of its effects run at once.

use uuid::Uuid;

use super::admission::PolicyColumns;
use super::{PgComputerError, PgComputerRepo, host_name};
use crate::domain::ids::HostId;
use crate::domain::models::{Host, HostConnection, HostRecord, HostRegistration};
use crate::domain::overcommit::{HostCapacity, HostHardware};

const MIB_PER_GIB: u64 = 1024;

impl PgComputerRepo {
    /// Insert or refresh a host's hardware; a new row takes the measured
    /// overcommit defaults. Units come from the row's own settings, so an
    /// edited row keeps its edit and the next registration applies it.
    pub(super) async fn upsert_host(
        &self,
        registration: HostRegistration,
    ) -> Result<Host, PgComputerError> {
        let mut tx = self.pool.begin().await?;
        let memory_mib = u64::from(registration.memory_gb) * MIB_PER_GIB;
        let row = sqlx::query!(
            r#"
            INSERT INTO hosted_runtime_host
                (id, name, awake_capacity_units, sold_capacity_units, total_vcpus, total_memory_mib)
            VALUES ($1, $2, 0, 0, $3, $4)
            ON CONFLICT (name) DO UPDATE
            SET total_vcpus = EXCLUDED.total_vcpus,
                total_memory_mib = EXCLUDED.total_memory_mib,
                updated_at = now()
            RETURNING id, name, cpu_allocation_percent, ram_allocation_percent, reserved_vcpus,
                      reserved_memory_gib, oversell_factor, memory_low_watermark_percent,
                      memory_high_watermark_percent, memory_hard_ceiling_percent,
                      start_resident_memory_mib, minimum_idle_seconds, memory_report_freshness_seconds
            "#,
            Uuid::now_v7(),
            registration.name.as_str(),
            i32::try_from(registration.vcpus)?,
            i64::try_from(memory_mib)?,
        )
        .fetch_one(&mut *tx)
        .await?;
        let name = host_name(&row.name)?;
        let policy = PolicyColumns {
            cpu_allocation_percent: row.cpu_allocation_percent,
            ram_allocation_percent: row.ram_allocation_percent,
            reserved_vcpus: row.reserved_vcpus,
            reserved_memory_gib: row.reserved_memory_gib,
            oversell_factor: row.oversell_factor,
            memory_low_watermark_percent: row.memory_low_watermark_percent,
            memory_high_watermark_percent: row.memory_high_watermark_percent,
            memory_hard_ceiling_percent: row.memory_hard_ceiling_percent,
            start_resident_memory_mib: row.start_resident_memory_mib,
            minimum_idle_seconds: row.minimum_idle_seconds,
            memory_report_freshness_seconds: row.memory_report_freshness_seconds,
        }
        .policy(&name)?;
        let capacity = HostCapacity {
            hardware: HostHardware {
                vcpus: registration.vcpus,
                memory_mib,
            },
            policy,
        };
        let awake = capacity.awake_units();
        let sold = capacity.sold_units();
        sqlx::query!(
            "UPDATE hosted_runtime_host SET awake_capacity_units = $2, sold_capacity_units = $3 WHERE id = $1",
            row.id,
            i32::try_from(awake)?,
            i32::try_from(sold)?,
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(Host {
            id: HostId::new(row.id),
            name,
            awake_capacity_units: awake,
            sold_capacity_units: sold,
        })
    }

    /// Every host row, oldest first.
    pub(super) async fn host_rows(&self) -> Result<Vec<HostRecord>, PgComputerError> {
        let rows = sqlx::query!(
            r#"
            SELECT id, name, endpoint, server_certificate_pem, max_concurrent_starts
            FROM hosted_runtime_host
            ORDER BY id
            "#,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                let name = host_name(&row.name)?;
                // The table keeps both set or both null.
                let connection = match (row.endpoint, row.server_certificate_pem) {
                    (Some(endpoint), Some(server_certificate_pem)) => Some(HostConnection {
                        endpoint: endpoint.parse().map_err(|error| {
                            PgComputerError::InvalidHostEndpoint {
                                name: name.clone(),
                                error,
                            }
                        })?,
                        server_certificate_pem,
                    }),
                    _ => None,
                };
                Ok(HostRecord {
                    id: HostId::new(row.id),
                    name,
                    connection,
                    max_concurrent_starts: u32::try_from(row.max_concurrent_starts)?,
                })
            })
            .collect()
    }
}
