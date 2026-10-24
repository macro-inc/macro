//! Redis admission shared by every Gmail request for a mailbox.

#[cfg(test)]
mod test;

use std::time::Duration;

use email_api_client::domain::models::{
    ApiOperationKind, EmailApiError, RateLimitOrigin, RateLimitRefusal,
};
use email_api_client::domain::ports::ProviderRequestGate;
use models_email::gmail::operations::GmailApiOperation;
use redis::aio::ConnectionManager;
use uuid::Uuid;

// Gmail answers 429 "Too many concurrent requests for user" above an
// unpublished per-user limit that every client of the mailbox shares; it was
// 91% of our Gmail rate limits. Backfill may hold three of the five slots, so
// sync and user writes always keep two.
const CONCURRENT_REQUESTS: u32 = 5;
const BACKFILL_CONCURRENT_REQUESTS: u32 = 3;
// Gmail allows 250 quota units per user per second (moving average) and, under
// this project's grandfathered quota, 15,000 per minute. A ten-second window
// enforces both: 2,300 units averages 230 a second and caps a minute at 13,800.
const WINDOW_SECONDS: u32 = 10;
const UNITS_PER_WINDOW: u32 = 2_300;
const BACKFILL_UNITS_PER_WINDOW: u32 = 1_800;
// Gmail requests have no client timeout, so this lease is what frees the slot
// of a crashed, cancelled, or hung caller. It matches the Gmail queues'
// 60-second visibility timeout, after which their work is redelivered anyway.
const PERMIT_MS: u32 = 60_000;
// Google asks clients to wait at least a second before retrying a 429.
const BUSY_RETRY_MS: u32 = 1_000;
// Gmail sends no Retry-After with its rate limits.
const DEFAULT_COOLDOWN: Duration = Duration::from_secs(5);
// Per-second and per-minute quotas recover within a minute. Longer Retry-After
// values come from daily sending or bandwidth limits, which must not pause the
// mailbox's other work for hours.
const MAX_COOLDOWN: Duration = Duration::from_secs(60);
const UNAVAILABLE_RETRY_AFTER: Duration = Duration::from_secs(5);

const ACQUIRE: &str = r#"
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local cooldown = redis.call('PTTL', KEYS[3])
if cooldown > 0 then return cooldown end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return tonumber(ARGV[7]) end
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
            return math.max(1, (entry[1] + window) * 1000 - now)
        end
    end
    return window * 1000
end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[6]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[6])
redis.call('HINCRBY', KEYS[2], clock[1], cost)
redis.call('EXPIRE', KEYS[2], window + 1)
return 0
"#;

const FINISH: &str = r#"
redis.call('ZREM', KEYS[1], ARGV[1])
local delay = tonumber(ARGV[2])
if delay > 0 and redis.call('PTTL', KEYS[2]) < delay then
    redis.call('SET', KEYS[2], '1', 'PX', delay)
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
    fn limits(self) -> (u32, u32) {
        match self {
            Self::Live => (CONCURRENT_REQUESTS, UNITS_PER_WINDOW),
            Self::Backfill => (BACKFILL_CONCURRENT_REQUESTS, BACKFILL_UNITS_PER_WINDOW),
        }
    }
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
}

impl RedisGmailRequestGate {
    /// Creates a gate that admits requests within the selected budget.
    pub fn new(connection: ConnectionManager, budget: RateBudget) -> Self {
        Self { connection, budget }
    }
}

fn keys(link_id: Uuid) -> [String; 3] {
    // Hash tags colocate the Lua keys in Redis Cluster.
    let scope = format!("gmail:{{{link_id}}}");
    [
        format!("{scope}:inflight"),
        format!("{scope}:window"),
        format!("{scope}:cooldown"),
    ]
}

fn cooldown(error: Option<&EmailApiError>) -> Duration {
    match error {
        Some(EmailApiError::RateLimited {
            origin: RateLimitOrigin::Provider,
            retry_after,
        }) => retry_after.unwrap_or(DEFAULT_COOLDOWN).min(MAX_COOLDOWN),
        _ => Duration::ZERO,
    }
}

impl ProviderRequestGate for RedisGmailRequestGate {
    async fn acquire(
        &self,
        link_id: Uuid,
        operation: ApiOperationKind,
    ) -> Result<Uuid, RateLimitRefusal> {
        let permit = Uuid::now_v7();
        let [inflight, window, cooldown] = keys(link_id);
        let (concurrent_requests, units_per_window) = self.budget.limits();
        let delay: redis::RedisResult<u64> = redis::Script::new(ACQUIRE)
            .key(inflight)
            .key(window)
            .key(cooldown)
            .arg(permit.to_string())
            .arg(concurrent_requests)
            .arg(units_per_window)
            .arg(gmail_operation(operation).cost())
            .arg(WINDOW_SECONDS)
            .arg(PERMIT_MS)
            .arg(BUSY_RETRY_MS)
            .invoke_async(&mut self.connection.clone())
            .await;
        match delay {
            Ok(0) => Ok(permit),
            Ok(delay) => Err(RateLimitRefusal::new(Some(Duration::from_millis(delay)))),
            Err(error) => {
                tracing::warn!(%link_id, %error, "Gmail request admission is unavailable");
                Err(RateLimitRefusal::new(Some(UNAVAILABLE_RETRY_AFTER)))
            }
        }
    }

    async fn finish(&self, link_id: Uuid, permit: Uuid, error: Option<&EmailApiError>) {
        let [inflight, _, cooldown_key] = keys(link_id);
        let result: redis::RedisResult<i32> = redis::Script::new(FINISH)
            .key(inflight)
            .key(cooldown_key)
            .arg(permit.to_string())
            .arg(cooldown(error).as_millis().to_string())
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
