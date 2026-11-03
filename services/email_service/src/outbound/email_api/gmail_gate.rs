//! Redis admission shared by every Gmail request for a mailbox.

#[cfg(test)]
mod test;

use std::time::Duration;

use email_api_client::domain::models::{
    ApiOperationKind, EmailApiError, MailboxLoad, RateLimitOrigin, RateLimitRefusal, RequestPermit,
};
use email_api_client::domain::ports::ProviderRequestGate;
use models_email::gmail::operations::GmailApiOperation;
use redis::aio::ConnectionManager;
use uuid::Uuid;

// Gmail answers 429 "Too many concurrent requests for user" above an
// unpublished per-user limit that every client of the mailbox shares; it was
// 91% of our Gmail rate limits. Backfill leaves two of the mailbox's slots to
// sync and user writes.
const CONCURRENT_REQUESTS: u32 = 5;
const LIVE_RESERVED_REQUESTS: u32 = 2;
// Gmail's real limit may be lower, and other clients of the mailbox use it
// too. After that 429, the mailbox's cap drops to three quarters, at most once
// a second so requests already in flight don't count twice, then rises by one
// a minute back to five.
const LEARNED_CAP_HOLD_MS: u32 = 1_000;
const LEARNED_CAP_INCREASE_MS: u32 = 60_000;
// Gmail allows 250 quota units per user per second (moving average) and, under
// this project's grandfathered quota, 15,000 per minute. A ten-second window
// enforces both: 2,300 units averages 230 a second and caps a minute at 13,800.
const WINDOW_SECONDS: u32 = 10;
const UNITS_PER_WINDOW: u32 = 2_300;
const BACKFILL_UNITS_PER_WINDOW: u32 = 1_800;
// Longer than the Gmail client's 60-second request timeout. Finished and
// dropped permits release themselves; the lease frees the slots of a crashed
// process.
const PERMIT_MS: u32 = 90_000;
// Google asks clients to wait at least a second before retrying a 429.
const BUSY_RETRY_MS: u32 = 1_000;
// A refused backfill request defers its SQS message, and deferred work comes
// back in waves that leave backfill's slots idle. Up to twelve refused backfill
// requests per mailbox, about a second of work for its three slots, wait for
// room instead, so a freed slot is taken at once. The rest still defer, which
// keeps one mailbox from tying up the workers other mailboxes need.
const BACKFILL_WAITERS: u32 = 12;
// Well inside the backfill queue's 60-second visibility timeout.
const BACKFILL_WAIT: Duration = Duration::from_secs(20);
// How often a waiting request checks for a free slot. Reads take about 200 ms,
// and with several waiters polling a freed slot idles a few milliseconds.
const WAIT_POLL_MS: u32 = 50;
// A waiter's place outlives its sleep by this much, so a crashed waiter frees it.
const WAITER_LEASE_MARGIN_MS: u32 = 1_000;
// Gmail sends no Retry-After with its rate limits. The concurrency and
// per-second limits behind 97% of them clear within Google's one-second
// minimum, and a longer pause stalls every caller for the mailbox.
const DEFAULT_COOLDOWN: Duration = Duration::from_secs(1);
// Backfill stays out longer after Gmail rate-limits the mailbox, so sync and
// user writes get the room Gmail has left before backfill fills it again.
const BACKFILL_COOLDOWN: Duration = Duration::from_secs(10);
// Per-second and per-minute quotas recover within a minute. Longer Retry-After
// values come from daily sending or bandwidth limits, which must not pause the
// mailbox's other work for hours.
const MAX_COOLDOWN: Duration = Duration::from_secs(60);
const UNAVAILABLE_RETRY_AFTER: Duration = Duration::from_secs(5);

// Returns {delay, waiting, in_flight, cap}: {0, 0, in_flight, cap} admits the
// request, reporting the mailbox's requests in flight counting this one and the
// cap it was admitted under; {delay, 1, 0, 0} keeps it waiting for room and
// {delay, 0, 0, 0} refuses it.
const ACQUIRE: &str = r#"
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local waiters = tonumber(ARGV[8])
local function refuse(delay, busy)
    local wait = delay
    if busy then wait = tonumber(ARGV[9]) end
    if waiters > 0 then
        redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', now)
        if wait <= tonumber(ARGV[10]) and
            (redis.call('ZSCORE', KEYS[4], ARGV[1]) or redis.call('ZCARD', KEYS[4]) < waiters) then
            local lease = wait + tonumber(ARGV[11])
            redis.call('ZADD', KEYS[4], now + lease, ARGV[1])
            if redis.call('PTTL', KEYS[4]) < lease then redis.call('PEXPIRE', KEYS[4], lease) end
            return {wait, 1, 0, 0}
        end
        redis.call('ZREM', KEYS[4], ARGV[1])
    end
    return {delay, 0, 0, 0}
end
local cooldown = redis.call('PTTL', KEYS[3])
if ARGV[12] == '1' then cooldown = math.max(cooldown, redis.call('PTTL', KEYS[5])) end
if cooldown > 0 then return refuse(cooldown, false) end
local cap = tonumber(ARGV[2])
local learned = redis.call('HMGET', KEYS[6], 'cap', 'at')
if learned[1] then
    cap = math.min(cap, tonumber(learned[1]) + math.floor((now - tonumber(learned[2])) / tonumber(ARGV[13])))
end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local in_flight = redis.call('ZCARD', KEYS[1])
if in_flight >= cap - tonumber(ARGV[14]) then return refuse(tonumber(ARGV[7]), true) end
local second = tonumber(clock[1])
local window = tonumber(ARGV[5])
local limit = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local buckets = redis.call('HGETALL', KEYS[2])
local live = {}
local used = 0
for i = 1, #buckets, 2 do
    local bucket = tonumber(buckets[i])
    if bucket <= second - window then
        redis.call('HDEL', KEYS[2], buckets[i])
    else
        local units = tonumber(buckets[i + 1])
        used = used + units
        table.insert(live, {bucket, units})
    end
end
if used + cost > limit then
    table.sort(live, function(a, b) return a[1] < b[1] end)
    for _, entry in ipairs(live) do
        used = used - entry[2]
        if used + cost <= limit then
            return refuse(math.max(1, (entry[1] + window) * 1000 - now), false)
        end
    end
    return refuse(window * 1000, false)
end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[6]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[6])
redis.call('HINCRBY', KEYS[2], clock[1], cost)
redis.call('EXPIRE', KEYS[2], window + 1)
if waiters > 0 then redis.call('ZREM', KEYS[4], ARGV[1]) end
return {0, 0, in_flight + 1, cap}
"#;

const FINISH: &str = r#"
redis.call('ZREM', KEYS[1], ARGV[1])
for i = 2, 3 do
    local delay = tonumber(ARGV[i])
    if delay > 0 and redis.call('PTTL', KEYS[i]) < delay then
        redis.call('SET', KEYS[i], '1', 'PX', delay)
    end
end
if ARGV[4] == '1' then
    local clock = redis.call('TIME')
    local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
    local default = tonumber(ARGV[5])
    local increase = tonumber(ARGV[7])
    local learned = redis.call('HMGET', KEYS[4], 'cap', 'at')
    if not learned[2] or now - tonumber(learned[2]) >= tonumber(ARGV[6]) then
        local cap = default
        if learned[1] then
            cap = math.min(cap, tonumber(learned[1]) + math.floor((now - tonumber(learned[2])) / increase))
        end
        cap = math.max(1, math.floor(cap * 3 / 4))
        redis.call('HSET', KEYS[4], 'cap', cap, 'at', now)
        redis.call('PEXPIRE', KEYS[4], (default - cap) * increase)
    end
end
return 1
"#;

/// Selects which share of a mailbox's Gmail allowance a service instance uses.
///
/// `Live` and `Backfill` are two thresholds over one shared Redis state per
/// mailbox, not two allowances: every request occupies the same in-flight set
/// and charges the same window, and the budget only decides the limit it is
/// compared against. Splitting the keys per budget would let live and backfill
/// together exceed Gmail's per-user limits. Don't "fix" the key sharing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RateBudget {
    /// Interactive, incremental, and user-initiated work, which may use the
    /// mailbox's whole allowance.
    Live,
    /// Mailbox backfills, held below the full allowance so live work keeps
    /// room while a backfill runs.
    Backfill,
}

impl RateBudget {
    /// The in-flight slots left to others, and the quota units per window.
    fn limits(self) -> (u32, u32) {
        match self {
            Self::Live => (0, UNITS_PER_WINDOW),
            Self::Backfill => (LIVE_RESERVED_REQUESTS, BACKFILL_UNITS_PER_WINDOW),
        }
    }

    /// Live callers handle their own retries, so only backfill waits.
    fn wait(self) -> Duration {
        match self {
            Self::Live => Duration::ZERO,
            Self::Backfill => BACKFILL_WAIT,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Admission {
    Admitted(MailboxLoad),
    Wait(Duration),
    Refused(Duration),
}

/// Caps in-flight Gmail requests and quota units per mailbox, and pauses the
/// mailbox after Gmail rate-limits it.
///
/// It fails closed: when Redis cannot decide, the request is refused as a
/// local rate limit, so callers defer or requeue the work rather than send it
/// unmetered. Because of that it needs a reconnecting connection; a dropped
/// multiplexed connection would stop all Gmail work until the process restarts.
#[derive(Clone)]
pub struct RedisGmailRequestGate {
    connection: ConnectionManager,
    budget: RateBudget,
    wait: Duration,
}

impl RedisGmailRequestGate {
    /// Creates a gate that admits requests within the selected budget.
    pub fn new(connection: ConnectionManager, budget: RateBudget) -> Self {
        Self {
            connection,
            budget,
            wait: budget.wait(),
        }
    }
}

fn keys(link_id: Uuid) -> [String; 6] {
    // Hash tags colocate the Lua keys in Redis Cluster.
    let scope = format!("gmail:{{{link_id}}}");
    [
        format!("{scope}:inflight"),
        format!("{scope}:window"),
        format!("{scope}:cooldown"),
        format!("{scope}:waiting"),
        format!("{scope}:backfill_cooldown"),
        format!("{scope}:limit"),
    ]
}

/// What a finished request tells the gate about the mailbox.
#[derive(Default)]
struct Outcome {
    /// Pause for every caller.
    cooldown: Duration,
    /// Pause for backfill alone.
    backfill_cooldown: Duration,
    /// Gmail refused it for too many requests in flight.
    concurrency_limited: bool,
}

fn outcome(error: Option<&EmailApiError>) -> Outcome {
    match error {
        Some(EmailApiError::RateLimited {
            origin: RateLimitOrigin::Provider { concurrency },
            retry_after,
        }) => {
            let cooldown = retry_after.unwrap_or(DEFAULT_COOLDOWN).min(MAX_COOLDOWN);
            Outcome {
                cooldown,
                backfill_cooldown: cooldown.max(BACKFILL_COOLDOWN),
                concurrency_limited: *concurrency,
            }
        }
        _ => Outcome::default(),
    }
}

impl ProviderRequestGate for RedisGmailRequestGate {
    async fn acquire(
        &self,
        link_id: Uuid,
        operation: ApiOperationKind,
    ) -> Result<RequestPermit, RateLimitRefusal> {
        let permit = Uuid::now_v7();
        let cost = gmail_operation(operation).cost();
        let admission = match self.admit(link_id, permit, cost, self.wait).await {
            Ok(Admission::Wait(delay)) => self.wait_for_room(link_id, permit, cost, delay).await,
            admission => admission,
        };
        match admission {
            Ok(Admission::Admitted(load)) => {
                let gate = self.clone();
                Ok(RequestPermit::new(link_id, permit, move |link_id, permit| {
                    // Drop cannot wait. Without a runtime, the lease frees the slot.
                    if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                        runtime.spawn(async move {
                            gate.release(link_id, permit, Outcome::default()).await
                        });
                    }
                })
                .with_load(load))
            }
            Ok(Admission::Wait(delay) | Admission::Refused(delay)) => {
                Err(RateLimitRefusal::new(Some(delay)))
            }
            Err(error) => {
                tracing::warn!(%link_id, %error, "Gmail request admission is unavailable");
                Err(RateLimitRefusal::new(Some(UNAVAILABLE_RETRY_AFTER)))
            }
        }
    }

    async fn finish(&self, permit: RequestPermit, error: Option<&EmailApiError>) {
        self.release(permit.link_id(), permit.id(), outcome(error))
            .await;
        permit.disarm();
    }
}

impl RedisGmailRequestGate {
    /// Runs one admission check. `wait` is how much longer the request may wait for room.
    async fn admit(
        &self,
        link_id: Uuid,
        permit: Uuid,
        cost: u32,
        wait: Duration,
    ) -> redis::RedisResult<Admission> {
        let [
            inflight,
            window,
            cooldown,
            waiting,
            backfill_cooldown,
            limit,
        ] = keys(link_id);
        let (reserved_requests, units_per_window) = self.budget.limits();
        let waiters = if self.wait.is_zero() {
            0
        } else {
            BACKFILL_WAITERS
        };
        let (delay, waits, in_flight, cap): (u64, u8, u32, u32) = redis::Script::new(ACQUIRE)
            .key(inflight)
            .key(window)
            .key(cooldown)
            .key(waiting)
            .key(backfill_cooldown)
            .key(limit)
            .arg(permit.to_string())
            .arg(CONCURRENT_REQUESTS)
            .arg(units_per_window)
            .arg(cost)
            .arg(WINDOW_SECONDS)
            .arg(PERMIT_MS)
            .arg(BUSY_RETRY_MS)
            .arg(waiters)
            .arg(WAIT_POLL_MS)
            .arg(wait.as_millis().to_string())
            .arg(WAITER_LEASE_MARGIN_MS)
            .arg(u8::from(self.budget == RateBudget::Backfill))
            .arg(LEARNED_CAP_INCREASE_MS)
            .arg(reserved_requests)
            .invoke_async(&mut self.connection.clone())
            .await?;
        let delay = Duration::from_millis(delay);
        Ok(match (delay.is_zero(), waits == 1) {
            (true, _) => Admission::Admitted(MailboxLoad { in_flight, cap }),
            (false, true) => Admission::Wait(delay),
            (false, false) => Admission::Refused(delay),
        })
    }

    /// Holds a refused request until it is admitted or its wait runs out.
    #[tracing::instrument(
        name = "gmail.request_gate.wait",
        skip(self, cost),
        fields(admitted),
        err
    )]
    async fn wait_for_room(
        &self,
        link_id: Uuid,
        permit: Uuid,
        cost: u32,
        mut delay: Duration,
    ) -> redis::RedisResult<Admission> {
        let deadline = tokio::time::Instant::now() + self.wait;
        loop {
            tokio::time::sleep(delay).await;
            let wait = deadline.saturating_duration_since(tokio::time::Instant::now());
            match self.admit(link_id, permit, cost, wait).await? {
                Admission::Wait(next) => delay = next,
                admission => {
                    tracing::Span::current()
                        .record("admitted", matches!(admission, Admission::Admitted(_)));
                    return Ok(admission);
                }
            }
        }
    }

    async fn release(&self, link_id: Uuid, permit: Uuid, outcome: Outcome) {
        let [inflight, _, cooldown_key, _, backfill_cooldown_key, limit] = keys(link_id);
        let result: redis::RedisResult<i32> = redis::Script::new(FINISH)
            .key(inflight)
            .key(cooldown_key)
            .key(backfill_cooldown_key)
            .key(limit)
            .arg(permit.to_string())
            .arg(outcome.cooldown.as_millis().to_string())
            .arg(outcome.backfill_cooldown.as_millis().to_string())
            .arg(u8::from(outcome.concurrency_limited))
            .arg(CONCURRENT_REQUESTS)
            .arg(LEARNED_CAP_HOLD_MS)
            .arg(LEARNED_CAP_INCREASE_MS)
            .invoke_async(&mut self.connection.clone())
            .await;
        if result.is_err() {
            // The provider call already happened and its outcome must reach the
            // caller even when releasing admission fails. The lease expires.
            tracing::warn!(%link_id, "failed to finish Gmail request admission");
        }
    }
}

fn gmail_operation(operation: ApiOperationKind) -> GmailApiOperation {
    match operation {
        ApiOperationKind::GetProfile => GmailApiOperation::UsersGetProfile,
        ApiOperationKind::ListChanges => GmailApiOperation::HistoryList,
        ApiOperationKind::ListLabels => GmailApiOperation::LabelsList,
        ApiOperationKind::CreateLabel => GmailApiOperation::LabelsCreate,
        ApiOperationKind::DeleteLabel => GmailApiOperation::LabelsDelete,
        ApiOperationKind::GetMessage => GmailApiOperation::MessagesGet,
        ApiOperationKind::ListMessages => GmailApiOperation::MessagesList,
        ApiOperationKind::ModifyMessageLabels => GmailApiOperation::MessagesModify,
        ApiOperationKind::BatchModifyMessageLabels => GmailApiOperation::MessagesBatchModify,
        ApiOperationKind::GetAttachment => GmailApiOperation::MessagesAttachmentsGet,
        ApiOperationKind::SendMessage => GmailApiOperation::MessagesSend,
        ApiOperationKind::GetThread => GmailApiOperation::ThreadsGet,
        ApiOperationKind::ListThreads => GmailApiOperation::ThreadsList,
        // People API calls share this budget. Gmail has no corresponding quota
        // operation, so use a one-unit operation as the accounting proxy.
        ApiOperationKind::ListContacts => GmailApiOperation::UsersGetProfile,
        // Block and unblock are composite filter operations. One admission
        // charges the dominant write operation rather than every request.
        ApiOperationKind::BlockSender => GmailApiOperation::SettingsFiltersCreate,
        ApiOperationKind::UnblockSender => GmailApiOperation::SettingsFiltersDelete,
        ApiOperationKind::ListBlockedSenders => GmailApiOperation::SettingsFiltersList,
        ApiOperationKind::Subscribe => GmailApiOperation::Watch,
        ApiOperationKind::Unsubscribe => GmailApiOperation::Stop,
    }
}
