//! [`UsageHistory`] in `hosted_runtime_usage_sample`: one row per running
//! computer per minute, written with one statement per host reading.

use chrono::{DateTime, Utc};

use super::{PgComputerError, PgComputerRepo};
use crate::domain::ids::ComputerId;
use crate::domain::ports::UsageHistory;
use crate::domain::usage::{StoredSample, UsageSample, minute_of};

impl UsageHistory for PgComputerRepo {
    type Err = PgComputerError;

    #[tracing::instrument(name = "computer.usage.record", skip_all, fields(samples = samples.len(), kept = tracing::field::Empty), err)]
    async fn record_usage(
        &self,
        sampled_at: DateTime<Utc>,
        samples: &[UsageSample],
    ) -> Result<u64, PgComputerError> {
        let minute = minute_of(sampled_at);
        let computer_ids: Vec<uuid::Uuid> = samples
            .iter()
            .map(|sample| sample.computer_id.as_uuid())
            .collect();
        let cpu_usage = samples
            .iter()
            .map(|sample| i64::try_from(sample.cpu_usage_microseconds))
            .collect::<Result<Vec<i64>, _>>()?;
        let memory = samples
            .iter()
            .map(|sample| i64::try_from(sample.memory_bytes))
            .collect::<Result<Vec<i64>, _>>()?;
        // The join skips guests this database has no computer for.
        let kept = sqlx::query!(
            r#"
            INSERT INTO hosted_runtime_usage_sample
                (computer_id, minute, sampled_at, cpu_usage_microseconds, memory_bytes)
            SELECT sample.computer_id, $1, $2, sample.cpu_usage_microseconds, sample.memory_bytes
            FROM UNNEST($3::uuid[], $4::bigint[], $5::bigint[])
                AS sample(computer_id, cpu_usage_microseconds, memory_bytes)
            JOIN hosted_runtime ON hosted_runtime.id = sample.computer_id
            ON CONFLICT (computer_id, minute) DO NOTHING
            "#,
            minute,
            sampled_at,
            &computer_ids,
            &cpu_usage,
            &memory,
        )
        .execute(&self.pool)
        .await?
        .rows_affected();
        tracing::Span::current().record("kept", kept);
        Ok(kept)
    }

    #[tracing::instrument(name = "computer.usage.read", skip_all, fields(computers = computers.len(), samples = tracing::field::Empty), err)]
    async fn usage_since(
        &self,
        computers: &[ComputerId],
        since: DateTime<Utc>,
    ) -> Result<Vec<(ComputerId, StoredSample)>, PgComputerError> {
        let computer_ids: Vec<uuid::Uuid> = computers
            .iter()
            .map(|computer_id| computer_id.as_uuid())
            .collect();
        let rows = sqlx::query!(
            r#"
            SELECT computer_id, sampled_at, cpu_usage_microseconds, memory_bytes
            FROM hosted_runtime_usage_sample
            WHERE computer_id = ANY($1) AND minute >= $2
            ORDER BY computer_id, minute
            "#,
            &computer_ids,
            since,
        )
        .fetch_all(&self.pool)
        .await?;
        tracing::Span::current().record("samples", rows.len());
        rows.into_iter()
            .map(|row| {
                Ok((
                    ComputerId::new_from_uuid(row.computer_id),
                    StoredSample {
                        sampled_at: row.sampled_at,
                        cpu_usage_microseconds: u64::try_from(row.cpu_usage_microseconds)?,
                        memory_bytes: u64::try_from(row.memory_bytes)?,
                    },
                ))
            })
            .collect()
    }

    #[tracing::instrument(name = "computer.usage.prune", skip_all, fields(deleted = tracing::field::Empty), err)]
    async fn prune_usage(&self, before: DateTime<Utc>) -> Result<u64, PgComputerError> {
        let deleted = sqlx::query!(
            "DELETE FROM hosted_runtime_usage_sample WHERE minute < $1",
            before,
        )
        .execute(&self.pool)
        .await?
        .rows_affected();
        tracing::Span::current().record("deleted", deleted);
        Ok(deleted)
    }
}
