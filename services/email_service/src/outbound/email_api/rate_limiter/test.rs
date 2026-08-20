use email_api_client::domain::models::ApiOperationKind;
use models_email::gmail::operations::GmailApiOperation;
use uuid::Uuid;

use super::{
    RateBudget, RedisProviderRateLimiter, gmail_operation, rate_limit_args, rate_limit_result,
};

/// Redis being unreachable must fail open: quota accounting degrades, mail
/// flow does not.
#[tokio::test]
async fn unreachable_redis_fails_open() {
    let redis_client = crate::util::redis::RedisClient::new(
        redis::Client::open("redis://127.0.0.1:1/").expect("client construction is offline"),
        100,
        50,
        60,
    );
    let limiter = RedisProviderRateLimiter::new(redis_client, RateBudget::Live);

    let result = email_api_client::domain::ports::ProviderRateLimiter::check_rate_limit(
        &limiter,
        Uuid::new_v4(),
        ApiOperationKind::GetMessage,
    )
    .await;

    assert!(
        result.is_ok(),
        "redis outage must not refuse provider calls"
    );
}

#[test]
fn contacts_use_a_one_unit_shared_budget_proxy() {
    assert_eq!(gmail_operation(ApiOperationKind::ListContacts).cost(), 1);
}

#[test]
fn composite_blocklist_operations_use_the_dominant_filter_write_cost() {
    assert_eq!(gmail_operation(ApiOperationKind::BlockSender).cost(), 5);
    assert_eq!(gmail_operation(ApiOperationKind::UnblockSender).cost(), 5);
}

#[test]
fn refusal_is_returned_only_for_a_denied_preflight_check() {
    assert!(rate_limit_result(false).is_ok());

    let refusal = rate_limit_result(true).expect_err("denied request should be refused");
    assert_eq!(refusal.retry_after, None);
}

#[test]
fn rate_budget_selects_live_or_backfill_limit() {
    let link_id = Uuid::new_v4();

    let live = rate_limit_args(link_id, ApiOperationKind::GetMessage, RateBudget::Live);
    assert_eq!(live.user_id, link_id);
    assert_eq!(live.operation, GmailApiOperation::MessagesGet);
    assert!(!live.is_backfill);

    let backfill = rate_limit_args(link_id, ApiOperationKind::GetMessage, RateBudget::Backfill);
    assert_eq!(backfill.user_id, link_id);
    assert_eq!(backfill.operation, GmailApiOperation::MessagesGet);
    assert!(backfill.is_backfill);
}
