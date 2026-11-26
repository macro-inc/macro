//! [`UsageHistory`] over [`FakeRepo`]: readings in memory, one per computer
//! per minute like the Postgres adapter.

use chrono::{DateTime, Utc};

use super::{FakeError, FakeRepo};
use crate::domain::ids::ComputerId;
use crate::domain::ports::UsageHistory;
use crate::domain::usage::{StoredSample, UsageSample, minute_of};

impl UsageHistory for FakeRepo {
    type Err = FakeError;

    async fn record_usage(
        &self,
        sampled_at: DateTime<Utc>,
        samples: &[UsageSample],
    ) -> Result<u64, FakeError> {
        let minute = minute_of(sampled_at);
        let computers = self.computers.lock().unwrap();
        let mut usage = self.usage.lock().unwrap();
        let mut kept = 0;
        for sample in samples {
            if !computers.contains_key(&sample.computer_id) {
                continue;
            }
            let readings = usage.entry(sample.computer_id).or_default();
            let taken = readings
                .iter()
                .any(|reading| minute_of(reading.sampled_at) == minute);
            if !taken {
                readings.push(StoredSample {
                    sampled_at,
                    cpu_usage_microseconds: sample.cpu_usage_microseconds,
                    memory_bytes: sample.memory_bytes,
                });
                kept += 1;
            }
        }
        Ok(kept)
    }

    async fn usage_since(
        &self,
        computers: &[ComputerId],
        since: DateTime<Utc>,
    ) -> Result<Vec<(ComputerId, StoredSample)>, FakeError> {
        let usage = self.usage.lock().unwrap();
        Ok(computers
            .iter()
            .flat_map(|computer_id| {
                let mut readings: Vec<StoredSample> = usage
                    .get(computer_id)
                    .into_iter()
                    .flatten()
                    .filter(|reading| minute_of(reading.sampled_at) >= since)
                    .copied()
                    .collect();
                readings.sort_by_key(|reading| reading.sampled_at);
                readings.into_iter().map(|reading| (*computer_id, reading))
            })
            .collect())
    }

    async fn prune_usage(&self, before: DateTime<Utc>) -> Result<u64, FakeError> {
        let mut usage = self.usage.lock().unwrap();
        let mut deleted = 0;
        for readings in usage.values_mut() {
            let kept = readings.len();
            readings.retain(|reading| minute_of(reading.sampled_at) >= before);
            deleted += (kept - readings.len()) as u64;
        }
        Ok(deleted)
    }
}
