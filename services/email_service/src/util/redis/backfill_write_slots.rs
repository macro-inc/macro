//! A fleet-wide cap on concurrent backfill writes.
//!
//! Every backfill worker of every email-service task writes threads straight
//! to the primary, and nothing else bounds how many run at once (25 workers
//! per task, 5 to 10 tasks). Message bodies land in one TOAST table, so a large
//! backfill queues its writers on that table's relation-extension lock and
//! slows every other query on the database. A slot is a Redis lease; at most
//! [`CAPACITY`] backfill writes hold one at a time, however many tasks run.

use crate::util::redis::RedisClient;
use rand::Rng;
use std::sync::LazyLock;
use std::time::Duration;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Concurrent backfill writes across the fleet. A healthy single-message write
/// (the contacts upsert plus its transaction) averages about 100 ms, so twenty
/// slots admit at least roughly 200 messages a second while the database is
/// healthy, above normal busy hours, more when a thread's messages share one
/// transaction, and fewer as the database slows down. Unbounded, 125 to 250
/// backfill workers could write at once.
const CAPACITY: u32 = 20;
/// Frees the slot of a crashed worker. A held slot renews it every
/// [`RENEW_EVERY`], so a write that outlasts it keeps its slot.
const LEASE: Duration = Duration::from_secs(120);
const RENEW_EVERY: Duration = Duration::from_secs(30);
/// How long a write waits for a slot before its operation is deferred. With the
/// Gmail gate's wait before it, the handler stays inside the backfill queue's
/// 60-second visibility timeout.
const WAIT: Duration = Duration::from_secs(10);
/// First and longest pause between admission checks. Waiters back off so a
/// saturated fleet doesn't poll Redis in lockstep.
const FIRST_POLL: Duration = Duration::from_millis(25);
const MAX_POLL: Duration = Duration::from_millis(400);
const KEY: &str = "email:backfill:write_slots";

/// Admits the caller when fewer than `capacity` unexpired leases are held.
/// Returns the slots in use counting this one, or 0 when every slot is taken.
static ACQUIRE: LazyLock<redis::Script> = LazyLock::new(|| {
    redis::Script::new(
        r#"
        local clock = redis.call('TIME')
        local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
        redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
        local in_flight = redis.call('ZCARD', KEYS[1])
        if in_flight >= tonumber(ARGV[2]) then return 0 end
        redis.call('ZADD', KEYS[1], now + tonumber(ARGV[3]), ARGV[1])
        redis.call('PEXPIRE', KEYS[1], ARGV[3])
        return in_flight + 1
        "#,
    )
});

/// Pushes a held lease forward. Returns 1, or 0 when the lease already expired
/// and was dropped; it is never re-added, so an expired slot can't overfill.
static RENEW: LazyLock<redis::Script> = LazyLock::new(|| {
    redis::Script::new(
        r#"
        local clock = redis.call('TIME')
        local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
        local renewed = redis.call('ZADD', KEYS[1], 'XX', 'CH', now + tonumber(ARGV[2]), ARGV[1])
        if renewed == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
        return renewed
        "#,
    )
});

/// One set of write slots. Production uses [`SLOTS`]; tests use their own keys.
struct SlotSet<'a> {
    key: &'a str,
    capacity: u32,
    lease: Duration,
    wait: Duration,
}

const SLOTS: SlotSet<'static> = SlotSet {
    key: KEY,
    capacity: CAPACITY,
    lease: LEASE,
    wait: WAIT,
};

/// A held backfill write slot.
///
/// Run the write with [`BackfillWriteSlot::hold`], which keeps the lease alive
/// and releases the slot afterwards. A dropped slot is released by a spawned
/// task, and the lease frees it if the process dies first.
pub struct BackfillWriteSlot {
    /// `None` after an explicit release, so `Drop` does nothing.
    inner: Option<SlotLease>,
}

struct SlotLease {
    client: redis::Client,
    key: String,
    id: String,
    lease: Duration,
}

impl SlotLease {
    /// Pushes the lease forward; `false` means it had already expired.
    async fn renew(&self) -> redis::RedisResult<bool> {
        let mut connection = self.client.get_multiplexed_async_connection().await?;
        let renewed: u32 = RENEW
            .key(&self.key)
            .arg(&self.id)
            .arg(self.lease.as_millis().to_string())
            .invoke_async(&mut connection)
            .await?;
        Ok(renewed == 1)
    }

    async fn release(&self) {
        let result: redis::RedisResult<i32> = async {
            let mut connection = self.client.get_multiplexed_async_connection().await?;
            redis::cmd("ZREM")
                .arg(&self.key)
                .arg(&self.id)
                .query_async(&mut connection)
                .await
        }
        .await;
        if let Err(error) = result {
            tracing::warn!(error = %error, "failed to release a backfill write slot; its lease will expire");
        }
    }
}

impl BackfillWriteSlot {
    /// Runs `work` while holding the slot, renewing its lease until the work
    /// finishes, then returns the slot to the fleet.
    pub async fn hold<F: Future>(self, work: F) -> F::Output {
        let mut work = std::pin::pin!(work);
        let mut renewals =
            tokio::time::interval_at(tokio::time::Instant::now() + RENEW_EVERY, RENEW_EVERY);
        let output = loop {
            tokio::select! {
                output = &mut work => break output,
                _ = renewals.tick() => {
                    if let Some(lease) = &self.inner {
                        match lease.renew().await {
                            Ok(true) => {}
                            Ok(false) => tracing::warn!("a backfill write outlived its slot's lease"),
                            Err(error) => tracing::warn!(error = %error, "failed to renew a backfill write slot"),
                        }
                    }
                }
            }
        };
        self.release().await;
        output
    }

    /// Returns the slot to the fleet.
    pub async fn release(mut self) {
        if let Some(lease) = self.inner.take() {
            lease.release().await;
        }
    }
}

impl Drop for BackfillWriteSlot {
    fn drop(&mut self) {
        if let Some(lease) = self.inner.take() {
            // Drop cannot wait. Without a runtime, the lease frees the slot.
            if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                runtime.spawn(async move { lease.release().await });
            }
        }
    }
}

impl RedisClient {
    /// Waits for one of the fleet's backfill write slots. Returns `None` when
    /// none frees up in time; the caller defers its operation.
    pub async fn acquire_backfill_write_slot(
        &self,
    ) -> redis::RedisResult<Option<BackfillWriteSlot>> {
        self.acquire_write_slot(&SLOTS).await
    }

    #[tracing::instrument(
        name = "email.backfill.write_slot",
        skip(self, slots),
        fields(admitted, in_flight, waited_ms),
        err
    )]
    async fn acquire_write_slot(
        &self,
        slots: &SlotSet<'_>,
    ) -> redis::RedisResult<Option<BackfillWriteSlot>> {
        let id = Uuid::now_v7().to_string();
        let started = tokio::time::Instant::now();
        let deadline = started + slots.wait;
        let mut poll = FIRST_POLL;
        let mut connection = self.inner.get_multiplexed_async_connection().await?;
        let span = tracing::Span::current();
        loop {
            let in_flight: u32 = ACQUIRE
                .key(slots.key)
                .arg(&id)
                .arg(slots.capacity)
                .arg(slots.lease.as_millis().to_string())
                .invoke_async(&mut connection)
                .await?;
            let now = tokio::time::Instant::now();
            if in_flight > 0 || now >= deadline {
                span.record("admitted", in_flight > 0);
                let waited_ms = u64::try_from(now.duration_since(started).as_millis());
                span.record("waited_ms", waited_ms.unwrap_or(u64::MAX));
                if in_flight == 0 {
                    return Ok(None);
                }
                span.record("in_flight", in_flight);
                return Ok(Some(BackfillWriteSlot {
                    inner: Some(SlotLease {
                        client: self.inner.clone(),
                        key: slots.key.to_string(),
                        id,
                        lease: slots.lease,
                    }),
                }));
            }
            let pause = rand::rng()
                .random_range(poll / 2..=poll)
                .min(deadline - now);
            tokio::time::sleep(pause).await;
            poll = (poll * 2).min(MAX_POLL);
        }
    }
}
