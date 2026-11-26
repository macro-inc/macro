//! Admission against a host's overcommit settings and live memory, the
//! memory reports it is judged on, and the computers relief hibernated.

use super::*;
use crate::domain::models::HostName;
use crate::domain::overcommit::{
    self, AwakeAllocation, HostCapacity, HostHardware, HostOvercommit, LiveMemoryLimits,
    MemoryReport, OvercommitPolicy, Percent, Refusal, WakeAdmission, Watermarks,
};

/// The overcommit columns of a host row.
pub(super) struct PolicyColumns {
    pub(super) cpu_allocation_percent: i32,
    pub(super) ram_allocation_percent: i32,
    pub(super) reserved_vcpus: i32,
    pub(super) reserved_memory_gib: i32,
    pub(super) oversell_factor: i32,
    pub(super) memory_low_watermark_percent: i32,
    pub(super) memory_high_watermark_percent: i32,
    pub(super) memory_hard_ceiling_percent: i32,
    pub(super) start_resident_memory_mib: i64,
    pub(super) minimum_idle_seconds: i32,
    pub(super) memory_report_freshness_seconds: i32,
}

impl PolicyColumns {
    /// The row's policy; a row whose settings are incoherent is refused.
    pub(super) fn policy(self, name: &HostName) -> Result<OvercommitPolicy, PgComputerError> {
        let percent = |value: i32| u32::try_from(value).map(Percent::new);
        let invalid = |error| PgComputerError::InvalidHostPolicy {
            name: name.clone(),
            error,
        };
        let live_memory = LiveMemoryLimits::new(
            Watermarks {
                low: percent(self.memory_low_watermark_percent)?,
                high: percent(self.memory_high_watermark_percent)?,
                hard_ceiling: percent(self.memory_hard_ceiling_percent)?,
            },
            u64::try_from(self.start_resident_memory_mib)?,
            chrono::Duration::seconds(i64::from(self.minimum_idle_seconds)),
            chrono::Duration::seconds(i64::from(self.memory_report_freshness_seconds)),
        )
        .map_err(invalid)?;
        OvercommitPolicy {
            cpu_allocation_ratio: percent(self.cpu_allocation_percent)?,
            ram_allocation_ratio: percent(self.ram_allocation_percent)?,
            reserved_vcpus: u32::try_from(self.reserved_vcpus)?,
            reserved_memory_gib: u32::try_from(self.reserved_memory_gib)?,
            oversell_factor: u32::try_from(self.oversell_factor)?,
            live_memory,
        }
        .validate()
        .map_err(invalid)
    }
}
use crate::domain::ports::OvercommitRepo;

/// A host row's overcommit columns, hardware and report.
struct HostOvercommitRow {
    id: Uuid,
    name: String,
    cpu_allocation_percent: i32,
    ram_allocation_percent: i32,
    reserved_vcpus: i32,
    reserved_memory_gib: i32,
    oversell_factor: i32,
    memory_low_watermark_percent: i32,
    memory_high_watermark_percent: i32,
    memory_hard_ceiling_percent: i32,
    start_resident_memory_mib: i64,
    minimum_idle_seconds: i32,
    memory_report_freshness_seconds: i32,
    total_vcpus: Option<i32>,
    total_memory_mib: Option<i64>,
    resident_memory_mib: Option<i64>,
    memory_reported_at: Option<DateTime<Utc>>,
    admitted_since_report: i32,
}

impl HostOvercommitRow {
    fn into_domain(self) -> Result<HostOvercommit, PgComputerError> {
        let name = super::host_name(&self.name)?;
        let policy = PolicyColumns {
            cpu_allocation_percent: self.cpu_allocation_percent,
            ram_allocation_percent: self.ram_allocation_percent,
            reserved_vcpus: self.reserved_vcpus,
            reserved_memory_gib: self.reserved_memory_gib,
            oversell_factor: self.oversell_factor,
            memory_low_watermark_percent: self.memory_low_watermark_percent,
            memory_high_watermark_percent: self.memory_high_watermark_percent,
            memory_hard_ceiling_percent: self.memory_hard_ceiling_percent,
            start_resident_memory_mib: self.start_resident_memory_mib,
            minimum_idle_seconds: self.minimum_idle_seconds,
            memory_report_freshness_seconds: self.memory_report_freshness_seconds,
        }
        .policy(&name)?;
        let capacity = match (self.total_vcpus, self.total_memory_mib) {
            (Some(vcpus), Some(memory_mib)) => Some(HostCapacity {
                hardware: HostHardware {
                    vcpus: u32::try_from(vcpus)?,
                    memory_mib: u64::try_from(memory_mib)?,
                },
                policy,
            }),
            _ => None,
        };
        let report = match (self.resident_memory_mib, self.memory_reported_at) {
            (Some(resident), Some(reported_at)) => Some(MemoryReport {
                resident_memory_mib: u64::try_from(resident)?,
                reported_at,
            }),
            _ => None,
        };
        Ok(HostOvercommit {
            host_id: HostId::new(self.id),
            name,
            capacity,
            report,
            pending_starts: u32::try_from(self.admitted_since_report)?,
        })
    }
}

impl PgComputerRepo {
    /// The host's settings, hardware and report, its row locked so starts
    /// and wakes on one host are judged one at a time.
    async fn lock_host_overcommit(
        tx: &mut Tx<'_>,
        host: HostId,
    ) -> Result<Option<HostOvercommit>, PgComputerError> {
        sqlx::query_as!(
            HostOvercommitRow,
            r#"
            SELECT id, name, cpu_allocation_percent, ram_allocation_percent, reserved_vcpus,
                   reserved_memory_gib, oversell_factor, memory_low_watermark_percent,
                   memory_high_watermark_percent, memory_hard_ceiling_percent,
                   start_resident_memory_mib, minimum_idle_seconds, memory_report_freshness_seconds,
                   total_vcpus, total_memory_mib, resident_memory_mib, memory_reported_at,
                   admitted_since_report
            FROM hosted_runtime_host
            WHERE id = $1
            FOR UPDATE
            "#,
            host.into_inner(),
        )
        .fetch_optional(&mut **tx)
        .await?
        .map(HostOvercommitRow::into_domain)
        .transpose()
    }

    /// The vCPUs and memory the host's awake, unhibernated computers other
    /// than `computer_id` hold.
    async fn awake_allocation(
        tx: &mut Tx<'_>,
        host: HostId,
        computer_id: ComputerId,
    ) -> Result<AwakeAllocation, PgComputerError> {
        let row = sqlx::query!(
            r#"
            SELECT COALESCE(SUM(vcpus), 0)::BIGINT AS "vcpus!",
                   COALESCE(SUM(memory_gib), 0)::BIGINT AS "memory_gib!"
            FROM hosted_runtime
            WHERE host_id = $1 AND awake AND hibernated_at IS NULL AND id <> $2
            "#,
            host.into_inner(),
            computer_id.as_uuid(),
        )
        .fetch_one(&mut **tx)
        .await?;
        Ok(AwakeAllocation {
            vcpus: u64::try_from(row.vcpus)?,
            memory_gib: u64::try_from(row.memory_gib)?,
        })
    }

    /// Whether a computer of `resources` may start on `host` now: its
    /// allocation fits beside the host's other awake computers, and the
    /// host's fresh memory report, with the starts admitted since, has
    /// room. Locks the host row so concurrent starts on one host are
    /// serialized. A refusal is logged and counted.
    pub(super) async fn host_has_room(
        tx: &mut Tx<'_>,
        host: HostId,
        computer_id: ComputerId,
        resources: ComputerResources,
        now: DateTime<Utc>,
    ) -> Result<bool, PgComputerError> {
        let refusal = Self::admission(tx, host, computer_id, resources, now).await?;
        if let Some(refusal) = refusal {
            let reason: &'static str = refusal.into();
            tracing::info!(computer_id = %computer_id, host_id = %host, refusal = reason, "host refused a start");
            overcommit::telemetry::refused(host, refusal);
        }
        Ok(refusal.is_none())
    }

    /// Why a computer may not start on `host` now; `None` when it may. An
    /// unknown host refuses as having no hardware.
    async fn admission(
        tx: &mut Tx<'_>,
        host: HostId,
        computer_id: ComputerId,
        resources: ComputerResources,
        now: DateTime<Utc>,
    ) -> Result<Option<Refusal>, PgComputerError> {
        let Some(host_overcommit) = Self::lock_host_overcommit(tx, host).await? else {
            return Ok(Some(Refusal::UnknownHardware));
        };
        let Some(capacity) = host_overcommit.capacity else {
            return Ok(Some(Refusal::UnknownHardware));
        };
        let awake = Self::awake_allocation(tx, host, computer_id).await?;
        let report = host_overcommit.report.map(|report| {
            report.with_pending_starts(host_overcommit.pending_starts, &capacity.policy.live_memory)
        });
        Ok(overcommit::admit(&capacity, awake, resources, report, now).err())
    }

    /// Count a start or wake the host admitted until its next memory report
    /// measures it. Under the host lock its admission took.
    pub(super) async fn count_admitted_start(
        tx: &mut Tx<'_>,
        host: HostId,
        now: DateTime<Utc>,
    ) -> Result<(), PgComputerError> {
        sqlx::query!(
            r#"
            UPDATE hosted_runtime_host
            SET admitted_since_report = admitted_since_report + 1,
                last_admitted_at = GREATEST(last_admitted_at, $2)
            WHERE id = $1
            "#,
            host.into_inner(),
            now,
        )
        .execute(&mut **tx)
        .await?;
        Ok(())
    }
}

impl PgComputerRepo {
    /// Ask for a wake of the computer if it is hibernated, inside `tx`;
    /// returns whether it is. A team powering on a hibernated computer asks
    /// for one this way.
    pub(super) async fn request_wake_in(
        tx: &mut Tx<'_>,
        computer_id: ComputerId,
        now: DateTime<Utc>,
    ) -> Result<bool, PgComputerError> {
        let requested = sqlx::query!(
            r#"
            UPDATE hosted_runtime SET wake_requested_at = COALESCE(wake_requested_at, $2)
            WHERE id = $1 AND hibernated_at IS NOT NULL
            "#,
            computer_id.as_uuid(),
            now,
        )
        .execute(&mut **tx)
        .await?;
        Ok(requested.rows_affected() == 1)
    }
}

impl OvercommitRepo for PgComputerRepo {
    type Err = PgComputerError;

    #[tracing::instrument(name = "computer.overcommit.host_settings", skip_all, fields(host_id = %host), err)]
    async fn host_overcommit(
        &self,
        host: HostId,
    ) -> Result<Option<HostOvercommit>, PgComputerError> {
        sqlx::query_as!(
            HostOvercommitRow,
            r#"
            SELECT id, name, cpu_allocation_percent, ram_allocation_percent, reserved_vcpus,
                   reserved_memory_gib, oversell_factor, memory_low_watermark_percent,
                   memory_high_watermark_percent, memory_hard_ceiling_percent,
                   start_resident_memory_mib, minimum_idle_seconds, memory_report_freshness_seconds,
                   total_vcpus, total_memory_mib, resident_memory_mib, memory_reported_at,
                   admitted_since_report
            FROM hosted_runtime_host
            WHERE id = $1
            "#,
            host.into_inner(),
        )
        .fetch_optional(&self.pool)
        .await?
        .map(HostOvercommitRow::into_domain)
        .transpose()
    }

    #[tracing::instrument(name = "computer.overcommit.record_report", skip_all, fields(host_id = %host, resident_memory_mib = report.resident_memory_mib), err)]
    async fn record_memory_report(
        &self,
        host: HostId,
        report: MemoryReport,
    ) -> Result<(), PgComputerError> {
        // Waits briefly behind a start holding the row's lock. Pending starts
        // clear only when the report was measured after the last of them; a
        // report measured before a start keeps counting it.
        sqlx::query!(
            r#"
            UPDATE hosted_runtime_host
            SET resident_memory_mib = $2, memory_reported_at = $3,
                admitted_since_report = CASE
                    WHEN last_admitted_at IS NULL OR last_admitted_at <= $3 THEN 0
                    ELSE admitted_since_report
                END
            WHERE id = $1 AND (memory_reported_at IS NULL OR memory_reported_at <= $3)
            "#,
            host.into_inner(),
            i64::try_from(report.resident_memory_mib)?,
            report.reported_at,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(name = "computer.overcommit.sync_hibernated", skip_all, fields(host_id = %host, hibernated = hibernated.len()), err)]
    async fn sync_hibernated(
        &self,
        host: HostId,
        hibernated: &[ComputerId],
        at: DateTime<Utc>,
    ) -> Result<(), PgComputerError> {
        let ids: Vec<Uuid> = hibernated.iter().map(|id| id.as_uuid()).collect();
        sqlx::query!(
            r#"
            UPDATE hosted_runtime
            SET hibernated_at = CASE WHEN id = ANY($2) THEN COALESCE(hibernated_at, $3) END,
                wake_requested_at = CASE WHEN id = ANY($2) THEN wake_requested_at END
            WHERE host_id = $1
              AND (hibernated_at IS NOT NULL OR id = ANY($2))
              AND (hibernated_at IS NULL) = (id = ANY($2))
            "#,
            host.into_inner(),
            &ids,
            at,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(name = "computer.overcommit.mark_hibernated", skip_all, fields(computer_id = %computer_id), err)]
    async fn mark_hibernated(
        &self,
        computer_id: ComputerId,
        at: DateTime<Utc>,
    ) -> Result<(), PgComputerError> {
        sqlx::query!(
            "UPDATE hosted_runtime SET hibernated_at = $2 WHERE id = $1 AND hibernated_at IS NULL",
            computer_id.as_uuid(),
            at,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(name = "computer.overcommit.request_wake", skip_all, fields(computer_id = %computer_id), err)]
    async fn request_wake(
        &self,
        computer_id: ComputerId,
        now: DateTime<Utc>,
    ) -> Result<bool, PgComputerError> {
        let mut tx = self.pool.begin().await?;
        let hibernated = Self::request_wake_in(&mut tx, computer_id, now).await?;
        tx.commit().await?;
        Ok(hibernated)
    }

    #[tracing::instrument(name = "computer.overcommit.wakes_requested", skip_all, fields(host_id = %host), err)]
    async fn wakes_requested(&self, host: HostId) -> Result<Vec<ComputerId>, PgComputerError> {
        let ids = sqlx::query_scalar!(
            r#"
            SELECT id FROM hosted_runtime
            WHERE host_id = $1 AND hibernated_at IS NOT NULL AND wake_requested_at IS NOT NULL
            ORDER BY wake_requested_at
            "#,
            host.into_inner(),
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(ids.into_iter().map(ComputerId::new_from_uuid).collect())
    }

    #[tracing::instrument(name = "computer.overcommit.admit_wake", skip_all, fields(computer_id = %computer_id, host_id = tracing::field::Empty, refusal = tracing::field::Empty), err)]
    async fn admit_wake(
        &self,
        computer_id: ComputerId,
        now: DateTime<Utc>,
    ) -> Result<WakeAdmission, PgComputerError> {
        let mut tx = self.pool.begin().await?;
        let computer = sqlx::query!(
            r#"
            SELECT host_id, vcpus, memory_gib, disk_gib, hibernated_at
            FROM hosted_runtime WHERE id = $1
            "#,
            computer_id.as_uuid(),
        )
        .fetch_optional(&mut *tx)
        .await?;
        let Some(computer) = computer else {
            return Ok(WakeAdmission::NotHibernated);
        };
        if computer.hibernated_at.is_none() {
            return Ok(WakeAdmission::NotHibernated);
        }
        let host = HostId::new(computer.host_id);
        tracing::Span::current().record("host_id", tracing::field::display(host));
        let resources =
            super::row::resources(computer.vcpus, computer.memory_gib, computer.disk_gib)?;
        if let Some(refusal) = Self::admission(&mut tx, host, computer_id, resources, now).await? {
            let reason: &'static str = refusal.into();
            tracing::Span::current().record("refusal", reason);
            overcommit::telemetry::refused(host, refusal);
            return Ok(WakeAdmission::Refused(refusal));
        }
        // Under the host lock, so the next admission counts this computer.
        Self::count_admitted_start(&mut tx, host, now).await?;
        let cleared = sqlx::query!(
            "UPDATE hosted_runtime SET hibernated_at = NULL, wake_requested_at = NULL WHERE id = $1 AND hibernated_at IS NOT NULL",
            computer_id.as_uuid(),
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(if cleared.rows_affected() == 1 {
            WakeAdmission::Admitted
        } else {
            WakeAdmission::NotHibernated
        })
    }
}
