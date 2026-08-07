//! Redis-backed provider rate-limiter adapter.

#[cfg(test)]
mod test;

use email_api_client::domain::models::{ApiOperationKind, RateLimitRefusal};
use email_api_client::domain::ports::ProviderRateLimiter;
use models_email::gmail::operations::GmailApiOperation;
use uuid::Uuid;

use crate::util::redis::RedisClient;
use crate::util::redis::rate_limit::RateLimitArgs;

/// Selects the shared provider quota budget used by a service instance.
///
/// `Live` and `Backfill` are two *thresholds over one shared Redis window*,
/// not two counters: every operation charges the same per-user key, and the
/// budget only decides the limit that charge is compared against. Splitting
/// the Redis key per budget would let live + backfill together exceed Gmail's
/// per-user quota — and would silently reset quota state already deployed
/// under the shared key. Don't "fix" the key sharing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RateBudget {
    /// The normal threshold used by interactive and incremental operations.
    Live,
    /// The lower threshold reserved for mailbox backfills, leaving headroom
    /// for live operations while a backfill runs.
    Backfill,
}

impl RateBudget {
    fn is_backfill(self) -> bool {
        matches!(self, Self::Backfill)
    }
}

/// Applies Gmail quota policy through the email service's Redis rate limiter.
///
/// Redis failures remain fail-open because [`RedisClient::is_rate_limited`]
/// reports them as an allowed request.
#[derive(Clone)]
pub struct RedisProviderRateLimiter {
    redis_client: RedisClient,
    budget: RateBudget,
}

impl RedisProviderRateLimiter {
    /// Creates a provider rate limiter using the selected quota budget.
    pub fn new(redis_client: RedisClient, budget: RateBudget) -> Self {
        Self {
            redis_client,
            budget,
        }
    }
}

impl ProviderRateLimiter for RedisProviderRateLimiter {
    async fn check_rate_limit(
        &self,
        link_id: Uuid,
        operation: ApiOperationKind,
    ) -> Result<(), RateLimitRefusal> {
        let args = rate_limit_args(link_id, operation, self.budget);

        rate_limit_result(self.redis_client.is_rate_limited(args).await)
    }
}

fn rate_limit_result(is_limited: bool) -> Result<(), RateLimitRefusal> {
    if is_limited {
        return Err(RateLimitRefusal::new(None));
    }

    Ok(())
}

fn rate_limit_args(
    link_id: Uuid,
    operation: ApiOperationKind,
    budget: RateBudget,
) -> RateLimitArgs {
    RateLimitArgs {
        user_id: link_id,
        operation: gmail_operation(operation),
        is_backfill: budget.is_backfill(),
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
        ApiOperationKind::GetAttachment => GmailApiOperation::MessagesAttachmentsGet,
        ApiOperationKind::SendMessage => GmailApiOperation::MessagesSend,
        ApiOperationKind::GetThread => GmailApiOperation::ThreadsGet,
        ApiOperationKind::ListThreads => GmailApiOperation::ThreadsList,
        // People API calls share this budget in v1. Gmail has no corresponding
        // quota operation, so use a one-unit operation as the accounting proxy.
        ApiOperationKind::ListContacts => GmailApiOperation::UsersGetProfile,
        // Block and unblock are composite filter operations. One preflight
        // check charges the dominant write operation rather than every request.
        ApiOperationKind::BlockSender => GmailApiOperation::SettingsFiltersCreate,
        ApiOperationKind::UnblockSender => GmailApiOperation::SettingsFiltersDelete,
        ApiOperationKind::ListBlockedSenders => GmailApiOperation::SettingsFiltersList,
        ApiOperationKind::Subscribe => GmailApiOperation::Watch,
        ApiOperationKind::Unsubscribe => GmailApiOperation::Stop,
    }
}
