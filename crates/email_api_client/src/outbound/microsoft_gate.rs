//! Shared admission for every Graph request, including nested pagination.

use crate::domain::{
    models::{EmailApiError, GateLimit, MailboxAccess, RateLimitOrigin},
    ports::MailboxRequestGate,
};
use redis::aio::MultiplexedConnection;
use std::{future::Future, pin::Pin, time::Duration};
use uuid::Uuid;

#[cfg(test)]
mod test;

// Graph permits 10,000 requests/10 minutes and four concurrent requests per
// app/mailbox. Leave headroom for consent-time discovery and provider accounting.
// https://learn.microsoft.com/en-us/graph/throttling-limits#outlook-service-limits
const REQUESTS_PER_WINDOW: u32 = 9_000;
const CONCURRENT_REQUESTS: u32 = 3;
// Import work leaves one of those slots, and 1,500 requests of each window, to
// everything else the mailbox does: new mail, calendar sync and its user's
// own actions. An import that waits for room fills the rest.
const IMPORT_CONCURRENT_REQUESTS: u32 = 2;
const IMPORT_REQUESTS_PER_WINDOW: u32 = 7_500;
const WINDOW_MS: u32 = 600_000;
// Greater than the Graph transport's 60-second total request timeout.
const PERMIT_MS: u32 = 90_000;
// A slot frees when a request in flight finishes, about 100 ms for most
// Graph calls; the permit's lease only frees the slots of a crashed process.
// So a request refused for concurrency tries again a second later, as
// Gmail's gate does, not when the oldest lease would expire.
const BUSY_RETRY_MS: u32 = 1_000;
// A refused import request parks its message or folder stream, and a parked
// folder stream stops feeding messages to the mailbox's import. Two refused
// import requests per mailbox, one per import slot, wait for room instead, so
// a freed slot is taken at once. The rest still defer, which keeps one
// mailbox from holding the sync workers other mailboxes need.
const IMPORT_WAITERS: u32 = 2;
const IMPORT_WAIT: Duration = Duration::from_secs(20);
// How often a waiting request checks for a free slot: about once per Graph
// request. Checking every 50 ms did not speed an import up and doubled the
// waiters' Redis calls.
const WAIT_POLL_MS: u32 = 100;
// A waiter's place outlives its sleep by this much, so a crashed waiter frees it.
const WAITER_LEASE_MARGIN_MS: u32 = 1_000;
// Admitted requests are counted per sync generation for import statistics.
// Long enough to outlast any import.
const REQUEST_COUNT_MS: u64 = 30 * 24 * 3_600_000;

// Returns `{limit, delay_ms, waiting}`: limit 0 admits the request, otherwise
// it names the refusing limit (1 cooldown, 2 concurrency, 3 window), and
// waiting 1 keeps the request's place among the mailbox's waiters while it
// checks again after `delay_ms`.
const ACQUIRE: &str = r#"
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local waiters = tonumber(ARGV[9])
local function refuse(limit, delay, busy)
    local wait = delay
    if busy then wait = tonumber(ARGV[10]) end
    if waiters > 0 then
        redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', now)
        if wait <= tonumber(ARGV[11]) and
            (redis.call('ZSCORE', KEYS[5], ARGV[1]) or redis.call('ZCARD', KEYS[5]) < waiters) then
            local lease = wait + tonumber(ARGV[12])
            redis.call('ZADD', KEYS[5], now + lease, ARGV[1])
            if redis.call('PTTL', KEYS[5]) < lease then redis.call('PEXPIRE', KEYS[5], lease) end
            return {limit, wait, 1}
        end
        redis.call('ZREM', KEYS[5], ARGV[1])
    end
    return {limit, delay, 0}
end
local cooldown = redis.call('PTTL', KEYS[3])
if cooldown > 0 then return refuse(1, cooldown, false) end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - tonumber(ARGV[4]))
-- The window comes first: while it is full, a free slot would not admit the
-- request, so a retry in a second would only be refused again.
local sent = redis.call('ZCARD', KEYS[2])
local allowed = tonumber(ARGV[3])
if sent >= allowed then
    -- The request fits once every request but the newest allowed - 1 has
    -- left the window.
    local last = redis.call('ZRANGE', KEYS[2], sent - allowed, sent - allowed, 'WITHSCORES')
    return refuse(3, math.max(1, tonumber(last[2]) + tonumber(ARGV[4]) - now), false)
end
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then
    return refuse(2, tonumber(ARGV[8]), true)
end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[5]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
redis.call('ZADD', KEYS[2], now, ARGV[1])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
redis.call('HINCRBY', KEYS[4], ARGV[6], 1)
redis.call('PEXPIRE', KEYS[4], ARGV[7])
if waiters > 0 then redis.call('ZREM', KEYS[5], ARGV[1]) end
return {0, 0, 0}
"#;

const FINISH: &str = r#"
redis.call('ZREM', KEYS[1], ARGV[1])
local delay = tonumber(ARGV[2])
if delay > 0 and redis.call('PTTL', KEYS[2]) < delay then
    redis.call('SET', KEYS[2], '1', 'PX', delay)
end
return 1
"#;

/// Which share of a mailbox's Graph allowance a gate admits requests to.
///
/// Both budgets count against one Redis state per mailbox: every request
/// occupies the same in-flight set and request window, and the budget only
/// sets the limits a request is compared against and whether a refused one
/// waits. Separate keys per budget would let the two together exceed
/// Microsoft's per-mailbox limits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestBudget {
    /// Calendar sync, user actions and incremental mail sync. They may use
    /// the mailbox's whole allowance, and a refused request is refused at
    /// once, so its caller parks its own work.
    Live,
    /// A mail import's folder walk and message reads. They stay below the
    /// whole allowance, and a refused request waits briefly for room.
    Import,
}

impl RequestBudget {
    /// The requests in flight and requests per window this budget admits up to.
    fn limits(self) -> (u32, u32) {
        match self {
            Self::Live => (CONCURRENT_REQUESTS, REQUESTS_PER_WINDOW),
            Self::Import => (IMPORT_CONCURRENT_REQUESTS, IMPORT_REQUESTS_PER_WINDOW),
        }
    }

    fn wait(self) -> Duration {
        match self {
            Self::Live => Duration::ZERO,
            Self::Import => IMPORT_WAIT,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Admission {
    Admitted,
    Wait(GateLimit, Duration),
    Refused(GateLimit, Duration),
}

/// Redis admission shared by all Microsoft mail and calendar callers.
#[derive(Clone)]
pub struct RedisMicrosoftRequestGate {
    connection: MultiplexedConnection,
    budget: RequestBudget,
    wait: Duration,
}

impl RedisMicrosoftRequestGate {
    /// Creates a gate that admits requests within the selected budget.
    pub fn new(connection: MultiplexedConnection, budget: RequestBudget) -> Self {
        Self {
            connection,
            budget,
            wait: budget.wait(),
        }
    }
}

fn keys(mailbox: MailboxAccess) -> [String; 5] {
    // Hash tags colocate the Lua keys in Redis Cluster. Generations share the
    // quota: refreshing or reconnecting must not reset Microsoft's allowance.
    let scope = format!("outlook:{{{}}}", mailbox.link_id);
    [
        format!("{scope}:inflight"),
        format!("{scope}:window"),
        format!("{scope}:cooldown"),
        format!("{scope}:requests"),
        format!("{scope}:waiting"),
    ]
}

impl MailboxRequestGate for RedisMicrosoftRequestGate {
    fn acquire(
        &self,
        mailbox: MailboxAccess,
    ) -> Pin<Box<dyn Future<Output = Result<Uuid, EmailApiError>> + Send + '_>> {
        Box::pin(async move {
            let permit = Uuid::now_v7();
            let admission = match self.admit(mailbox, permit, self.wait).await {
                Ok(Admission::Wait(_, delay)) => self.wait_for_room(mailbox, permit, delay).await,
                admission => admission,
            };
            let (limit, delay) = match admission {
                Ok(Admission::Admitted) => return Ok(permit),
                Ok(Admission::Wait(limit, delay) | Admission::Refused(limit, delay)) => {
                    (limit, delay)
                }
                Err(_) => {
                    return Err(EmailApiError::Transient {
                        message: "Microsoft request admission is unavailable".into(),
                    });
                }
            };
            Err(EmailApiError::RateLimited {
                retry_after: Some(delay),
                origin: RateLimitOrigin::Gate(limit),
            })
        })
    }
    fn finish(
        &self,
        mailbox: MailboxAccess,
        permit: Uuid,
        retry_after: Option<Duration>,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            let [inflight, _, cooldown, ..] = keys(mailbox);
            let delay = retry_after
                .map(|delay| delay.as_millis().clamp(1, 86_400_000) as u64)
                .unwrap_or(0);
            let result: redis::RedisResult<i32> = redis::Script::new(FINISH)
                .key(inflight)
                .key(cooldown)
                .arg(permit.to_string())
                .arg(delay)
                .invoke_async(&mut self.connection.clone())
                .await;
            if result.is_err() {
                // A completed provider write must retain its known outcome even
                // when releasing admission fails. The crash lease will expire.
                tracing::warn!(link_id=%mailbox.link_id,"failed to finish Microsoft request admission");
            }
        })
    }
    fn admitted(
        &self,
        mailbox: MailboxAccess,
    ) -> Pin<Box<dyn Future<Output = Option<u64>> + Send + '_>> {
        Box::pin(async move {
            let [.., requests, _] = keys(mailbox);
            let admitted: redis::RedisResult<Option<u64>> = redis::cmd("HGET")
                .arg(requests)
                .arg(mailbox.sync_generation)
                .query_async(&mut self.connection.clone())
                .await;
            admitted
                .inspect_err(|error| {
                    tracing::warn!(link_id = %mailbox.link_id, %error, "failed to read admitted Microsoft requests");
                })
                .ok()
                .flatten()
        })
    }
}

impl RedisMicrosoftRequestGate {
    /// Runs one admission check. `wait` is how much longer the request may wait for room.
    async fn admit(
        &self,
        mailbox: MailboxAccess,
        permit: Uuid,
        wait: Duration,
    ) -> redis::RedisResult<Admission> {
        let [inflight, window, cooldown, requests, waiting] = keys(mailbox);
        let (concurrent_requests, requests_per_window) = self.budget.limits();
        let waiters = if self.wait.is_zero() {
            0
        } else {
            IMPORT_WAITERS
        };
        let (limit, delay, waits): (u8, u64, u8) = redis::Script::new(ACQUIRE)
            .key(inflight)
            .key(window)
            .key(cooldown)
            .key(requests)
            .key(waiting)
            .arg(permit.to_string())
            .arg(concurrent_requests)
            .arg(requests_per_window)
            .arg(WINDOW_MS)
            .arg(PERMIT_MS)
            .arg(mailbox.sync_generation)
            .arg(REQUEST_COUNT_MS)
            .arg(BUSY_RETRY_MS)
            .arg(waiters)
            .arg(WAIT_POLL_MS)
            .arg(wait.as_millis().to_string())
            .arg(WAITER_LEASE_MARGIN_MS)
            .invoke_async(&mut self.connection.clone())
            .await?;
        let limit = match limit {
            0 => return Ok(Admission::Admitted),
            1 => GateLimit::Cooldown,
            2 => GateLimit::Concurrency,
            _ => GateLimit::Window,
        };
        let delay = Duration::from_millis(delay);
        Ok(if waits == 1 {
            Admission::Wait(limit, delay)
        } else {
            Admission::Refused(limit, delay)
        })
    }

    /// Holds a refused request until it is admitted or its wait runs out.
    #[tracing::instrument(
        name = "outlook.gate_wait",
        skip_all,
        fields(
            mailbox.link_id = %mailbox.link_id,
            outlook.gate_admitted = tracing::field::Empty,
        ),
        err
    )]
    async fn wait_for_room(
        &self,
        mailbox: MailboxAccess,
        permit: Uuid,
        mut delay: Duration,
    ) -> redis::RedisResult<Admission> {
        let deadline = tokio::time::Instant::now() + self.wait;
        loop {
            tokio::time::sleep(delay).await;
            let wait = deadline.saturating_duration_since(tokio::time::Instant::now());
            match self.admit(mailbox, permit, wait).await? {
                Admission::Wait(_, next) => delay = next,
                admission => {
                    tracing::Span::current()
                        .record("outlook.gate_admitted", admission == Admission::Admitted);
                    return Ok(admission);
                }
            }
        }
    }
}
