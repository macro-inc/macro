//! Tests for the email notification digest state machine.

use super::*;
use crate::domain::models::{Notification, UserNotificationRow};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use rootcause::Report;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

// ============================================================================
// Test Notification Types
// ============================================================================

/// A general test notification that is not blocked and not an invite.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct TestNotification {
    message: String,
}

impl Notification for TestNotification {
    const TYPE_NAME: &'static str = "test_notification";
}

/// A notification type that should be blocked from email delivery.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct BlockedNotification;

impl Notification for BlockedNotification {
    const TYPE_NAME: &'static str = "blocked_notification";
}

// ============================================================================
// Mock Implementations
// ============================================================================

/// Mock user existence checker with configurable behavior.
struct MockUserExistenceChecker {
    user_exists: Option<bool>,
    error: Option<String>,
}

impl MockUserExistenceChecker {
    fn with_user_exists() -> Self {
        Self {
            user_exists: Some(true),
            error: None,
        }
    }

    fn with_user_not_exists() -> Self {
        Self {
            user_exists: Some(false),
            error: None,
        }
    }

    fn with_error(msg: &str) -> Self {
        Self {
            user_exists: None,
            error: Some(msg.to_string()),
        }
    }
}

impl UserExistenceChecker for MockUserExistenceChecker {
    fn user_exists<'a>(
        &self,
        _id: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<bool, Report>> + Send {
        let error = self.error.clone();
        let user_exists = self.user_exists;
        async move {
            match (error, user_exists) {
                (Some(err), _) => rootcause::bail!("{}", err),
                (None, Some(exists)) => Ok(exists),
                (None, None) => panic!("MockUserExistenceChecker not configured"),
            }
        }
    }
}

/// Mock push notification checker with configurable behavior.
struct MockPushNotificationChecker {
    push_enabled: Option<bool>,
    error: Option<String>,
}

impl MockPushNotificationChecker {
    fn with_push_enabled() -> Self {
        Self {
            push_enabled: Some(true),
            error: None,
        }
    }

    fn with_push_disabled() -> Self {
        Self {
            push_enabled: Some(false),
            error: None,
        }
    }

    fn with_error(msg: &str) -> Self {
        Self {
            push_enabled: None,
            error: Some(msg.to_string()),
        }
    }
}

impl PushNotificationChecker for MockPushNotificationChecker {
    fn push_notification_enabled<'a>(
        &self,
        _user: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<bool, Report>> + Send {
        let error = self.error.clone();
        let push_enabled = self.push_enabled;
        async move {
            match (error, push_enabled) {
                (Some(err), _) => rootcause::bail!("{}", err),
                (None, Some(enabled)) => Ok(enabled),
                (None, None) => panic!("MockPushNotificationChecker not configured"),
            }
        }
    }
}

/// Mock digest batcher that tracks calls.
struct MockDigestBatcher {
    call_count: Arc<std::sync::atomic::AtomicUsize>,
    should_error: bool,
}

impl MockDigestBatcher {
    fn new() -> (Self, Arc<std::sync::atomic::AtomicUsize>) {
        let call_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        (
            Self {
                call_count: Arc::clone(&call_count),
                should_error: false,
            },
            call_count,
        )
    }
}

impl DigestBatcher for MockDigestBatcher {
    fn add_to_digest(
        &self,
        _notification: &UserNotificationRow<serde_json::Value>,
        _send_after: Duration,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        self.call_count
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let should_error = self.should_error;
        async move {
            if should_error {
                rootcause::bail!("digest batcher error");
            }
            Ok(())
        }
    }

    fn claim_ready_digest(
        &self,
    ) -> impl Future<Output = Result<ports::ClaimResult<ports::DigestBatch>, Report>> + Send {
        async { Ok(ports::ClaimResult::Empty) }
    }
}

/// Mock last online checker with configurable behavior.
struct MockLastOnlineChecker {
    last_online: Option<Duration>,
    error: Option<String>,
}

impl MockLastOnlineChecker {
    fn with_last_online(duration: Duration) -> Self {
        Self {
            last_online: Some(duration),
            error: None,
        }
    }

    fn with_error(msg: &str) -> Self {
        Self {
            last_online: None,
            error: Some(msg.to_string()),
        }
    }
}

impl LastOnlineChecker for MockLastOnlineChecker {
    fn last_online_checker<'a>(
        &self,
        _user: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<Duration, Report>> + Send {
        let error = self.error.clone();
        let last_online = self.last_online;
        async move {
            match (error, last_online) {
                (Some(err), _) => rootcause::bail!("{}", err),
                (None, Some(duration)) => Ok(duration),
                (None, None) => panic!("MockLastOnlineChecker not configured"),
            }
        }
    }
}

// ============================================================================
// Test Helpers
// ============================================================================

fn test_user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("test@example.com").unwrap()
}

fn create_test_notification_row<T: Notification>(metadata: T) -> UserNotificationRow<Arc<T>> {
    UserNotificationRow {
        owner_id: test_user_id(),
        notification_id: uuid::Uuid::now_v7(),
        notification_event_type: T::TYPE_NAME.to_string(),
        entity: EntityType::Document.with_entity_str("doc_123"),
        sent: false,
        done: false,
        created_at: None,
        viewed_at: None,
        updated_at: None,
        deleted_at: None,
        notification_metadata: Arc::new(metadata),
        sender_id: None,
    }
}

fn create_block_list() -> EmailBlockList {
    EmailBlockList::new::<BlockedNotification>()
}

// ============================================================================
// EmailBlockList Tests
// ============================================================================

#[test]
fn test_notification_is_allowed_returns_dont_send_when_blocked() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(BlockedNotification);

    let result = block_list.notification_is_allowed(notif);

    assert!(
        result.is_right(),
        "Blocked notification should return DontSend"
    );
}

#[test]
fn test_notification_is_allowed_returns_allowed_when_not_blocked() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    let result = block_list.notification_is_allowed(notif);

    assert!(
        result.is_left(),
        "Non-blocked notification should return AllowedNotification"
    );
}

// ============================================================================
// AllowedNotification::check_user_existence Tests
// ============================================================================

#[tokio::test]
async fn test_check_user_existence_returns_account_exists() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    let checker = MockUserExistenceChecker::with_user_exists();
    let result = allowed.check_user_existence(&checker).await.unwrap();

    assert!(
        result.is_left(),
        "Should return AccountExists when user exists"
    );
}

#[tokio::test]
async fn test_check_user_existence_returns_account_does_not_exist() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    let checker = MockUserExistenceChecker::with_user_not_exists();
    let result = allowed.check_user_existence(&checker).await.unwrap();

    assert!(
        result.is_right(),
        "Should return DontSend when user does not exist"
    );
}

#[tokio::test]
async fn test_check_user_existence_propagates_error() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    let checker = MockUserExistenceChecker::with_error("database connection failed");
    let result = allowed.check_user_existence(&checker).await;

    match result {
        Err(err) => assert!(
            err.to_string().contains("database connection failed"),
            "Error message should be preserved"
        ),
        Ok(_) => panic!("Should propagate error from checker"),
    }
}

// ============================================================================
// AccountExists::push_notifications_enabled Tests
// ============================================================================

#[tokio::test]
async fn test_push_notifications_enabled_returns_enabled() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    let user_checker = MockUserExistenceChecker::with_user_exists();
    let account_exists = allowed
        .check_user_existence(&user_checker)
        .await
        .unwrap()
        .left()
        .expect("Should be AccountExists");

    let push_checker = MockPushNotificationChecker::with_push_enabled();
    let result = account_exists
        .push_notifications_enabled(&push_checker)
        .await
        .unwrap();

    assert!(
        result.is_left(),
        "Should return PushNotificationsEnabled when push is enabled"
    );
}

#[tokio::test]
async fn test_push_notifications_enabled_returns_disabled() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    let user_checker = MockUserExistenceChecker::with_user_exists();
    let account_exists = allowed
        .check_user_existence(&user_checker)
        .await
        .unwrap()
        .left()
        .expect("Should be AccountExists");

    let push_checker = MockPushNotificationChecker::with_push_disabled();
    let result = account_exists
        .push_notifications_enabled(&push_checker)
        .await
        .unwrap();

    assert!(
        result.is_right(),
        "Should return PushNotificationsDisabled when push is disabled"
    );
}

#[tokio::test]
async fn test_push_notifications_enabled_propagates_error() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    let user_checker = MockUserExistenceChecker::with_user_exists();
    let account_exists = allowed
        .check_user_existence(&user_checker)
        .await
        .unwrap()
        .left()
        .expect("Should be AccountExists");

    let push_checker = MockPushNotificationChecker::with_error("push service unavailable");
    let result = account_exists
        .push_notifications_enabled(&push_checker)
        .await;

    match result {
        Err(err) => assert!(
            err.to_string().contains("push service unavailable"),
            "Error message should be preserved"
        ),
        Ok(_) => panic!("Should propagate error from checker"),
    }
}

// ============================================================================
// PushNotificationsDisabled::check_last_online_time Tests
// ============================================================================

#[tokio::test]
async fn test_check_last_online_time_returns_dont_send_when_recently_online() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    let user_checker = MockUserExistenceChecker::with_user_exists();
    let account_exists = allowed
        .check_user_existence(&user_checker)
        .await
        .unwrap()
        .left()
        .expect("Should be AccountExists");

    let push_checker = MockPushNotificationChecker::with_push_disabled();
    let push_disabled = account_exists
        .push_notifications_enabled(&push_checker)
        .await
        .unwrap()
        .right()
        .expect("Should be PushNotificationsDisabled");

    // User was online 5 minutes ago, threshold is 30 minutes
    let online_checker = MockLastOnlineChecker::with_last_online(Duration::from_secs(5 * 60));
    let threshold = Duration::from_secs(30 * 60);

    let result = push_disabled
        .check_last_online_time(&online_checker, threshold)
        .await
        .unwrap();

    assert!(
        result.is_right(),
        "Should return DontSend when user was recently online (within threshold)"
    );
}

#[tokio::test]
async fn test_check_last_online_time_returns_dont_send_when_exactly_at_threshold() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    let user_checker = MockUserExistenceChecker::with_user_exists();
    let account_exists = allowed
        .check_user_existence(&user_checker)
        .await
        .unwrap()
        .left()
        .expect("Should be AccountExists");

    let push_checker = MockPushNotificationChecker::with_push_disabled();
    let push_disabled = account_exists
        .push_notifications_enabled(&push_checker)
        .await
        .unwrap()
        .right()
        .expect("Should be PushNotificationsDisabled");

    // User was online exactly at the threshold
    let threshold = Duration::from_secs(30 * 60);
    let online_checker = MockLastOnlineChecker::with_last_online(threshold);

    let result = push_disabled
        .check_last_online_time(&online_checker, threshold)
        .await
        .unwrap();

    assert!(
        result.is_right(),
        "Should return DontSend when user was online exactly at threshold (boundary condition)"
    );
}

#[tokio::test]
async fn test_check_last_online_time_returns_batch_send_when_past_threshold() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    let user_checker = MockUserExistenceChecker::with_user_exists();
    let account_exists = allowed
        .check_user_existence(&user_checker)
        .await
        .unwrap()
        .left()
        .expect("Should be AccountExists");

    let push_checker = MockPushNotificationChecker::with_push_disabled();
    let push_disabled = account_exists
        .push_notifications_enabled(&push_checker)
        .await
        .unwrap()
        .right()
        .expect("Should be PushNotificationsDisabled");

    // User was online 1 hour ago, threshold is 30 minutes
    let online_checker = MockLastOnlineChecker::with_last_online(Duration::from_secs(60 * 60));
    let threshold = Duration::from_secs(30 * 60);

    let result = push_disabled
        .check_last_online_time(&online_checker, threshold)
        .await
        .unwrap();

    assert!(
        result.is_left(),
        "Should return BatchSend when user has been offline longer than threshold"
    );
}

#[tokio::test]
async fn test_check_last_online_time_propagates_error() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    let user_checker = MockUserExistenceChecker::with_user_exists();
    let account_exists = allowed
        .check_user_existence(&user_checker)
        .await
        .unwrap()
        .left()
        .expect("Should be AccountExists");

    let push_checker = MockPushNotificationChecker::with_push_disabled();
    let push_disabled = account_exists
        .push_notifications_enabled(&push_checker)
        .await
        .unwrap()
        .right()
        .expect("Should be PushNotificationsDisabled");

    let online_checker = MockLastOnlineChecker::with_error("redis connection failed");
    let threshold = Duration::from_secs(30 * 60);

    let result = push_disabled
        .check_last_online_time(&online_checker, threshold)
        .await;

    match result {
        Err(err) => assert!(
            err.to_string().contains("redis connection failed"),
            "Error message should be preserved"
        ),
        Ok(_) => panic!("Should propagate error from checker"),
    }
}

#[tokio::test]
async fn test_check_last_online_time_edge_case_zero_threshold() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    let user_checker = MockUserExistenceChecker::with_user_exists();
    let account_exists = allowed
        .check_user_existence(&user_checker)
        .await
        .unwrap()
        .left()
        .expect("Should be AccountExists");

    let push_checker = MockPushNotificationChecker::with_push_disabled();
    let push_disabled = account_exists
        .push_notifications_enabled(&push_checker)
        .await
        .unwrap()
        .right()
        .expect("Should be PushNotificationsDisabled");

    // Zero threshold - any non-zero last online should trigger batch send
    let online_checker = MockLastOnlineChecker::with_last_online(Duration::from_secs(1));
    let threshold = Duration::ZERO;

    let result = push_disabled
        .check_last_online_time(&online_checker, threshold)
        .await
        .unwrap();

    assert!(
        result.is_left(),
        "Should return BatchSend when threshold is zero and user has any offline time"
    );
}

#[tokio::test]
async fn test_check_last_online_time_edge_case_zero_last_online() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    let user_checker = MockUserExistenceChecker::with_user_exists();
    let account_exists = allowed
        .check_user_existence(&user_checker)
        .await
        .unwrap()
        .left()
        .expect("Should be AccountExists");

    let push_checker = MockPushNotificationChecker::with_push_disabled();
    let push_disabled = account_exists
        .push_notifications_enabled(&push_checker)
        .await
        .unwrap()
        .right()
        .expect("Should be PushNotificationsDisabled");

    // User was online just now (0 seconds ago)
    let online_checker = MockLastOnlineChecker::with_last_online(Duration::ZERO);
    let threshold = Duration::from_secs(30 * 60);

    let result = push_disabled
        .check_last_online_time(&online_checker, threshold)
        .await
        .unwrap();

    assert!(
        result.is_right(),
        "Should return DontSend when user was online just now (zero duration)"
    );
}

// ============================================================================
// Full Flow Integration Tests
// ============================================================================

#[test]
fn test_full_flow_blocked_notification() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(BlockedNotification);

    let result = block_list.notification_is_allowed(notif);

    assert!(
        result.is_right(),
        "Full flow: blocked notification should immediately return DontSend"
    );
}

#[tokio::test]
async fn test_full_flow_user_exists_push_enabled() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    // Step 1: Check if allowed
    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    // Step 2: Check user existence
    let user_checker = MockUserExistenceChecker::with_user_exists();
    let account_exists = allowed
        .check_user_existence(&user_checker)
        .await
        .unwrap()
        .left()
        .expect("Should be AccountExists");

    // Step 3: Check push notifications
    let push_checker = MockPushNotificationChecker::with_push_enabled();
    let result = account_exists
        .push_notifications_enabled(&push_checker)
        .await
        .unwrap();

    assert!(
        result.is_left(),
        "Full flow: user exists with push enabled should return PushNotificationsEnabled"
    );
}

#[tokio::test]
async fn test_full_flow_user_exists_push_disabled_recently_online() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    // Step 1: Check if allowed
    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    // Step 2: Check user existence
    let user_checker = MockUserExistenceChecker::with_user_exists();
    let account_exists = allowed
        .check_user_existence(&user_checker)
        .await
        .unwrap()
        .left()
        .expect("Should be AccountExists");

    // Step 3: Check push notifications - disabled
    let push_checker = MockPushNotificationChecker::with_push_disabled();
    let push_disabled = account_exists
        .push_notifications_enabled(&push_checker)
        .await
        .unwrap()
        .right()
        .expect("Should be PushNotificationsDisabled");

    // Step 4: Check last online time - recently online
    let online_checker = MockLastOnlineChecker::with_last_online(Duration::from_secs(5 * 60));
    let threshold = Duration::from_secs(30 * 60);
    let result = push_disabled
        .check_last_online_time(&online_checker, threshold)
        .await
        .unwrap();

    assert!(
        result.is_right(),
        "Full flow: user exists, push disabled, recently online should return DontSend"
    );
}

#[tokio::test]
async fn test_full_flow_user_exists_push_disabled_offline() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    // Step 1: Check if allowed
    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    // Step 2: Check user existence
    let user_checker = MockUserExistenceChecker::with_user_exists();
    let account_exists = allowed
        .check_user_existence(&user_checker)
        .await
        .unwrap()
        .left()
        .expect("Should be AccountExists");

    // Step 3: Check push notifications - disabled
    let push_checker = MockPushNotificationChecker::with_push_disabled();
    let push_disabled = account_exists
        .push_notifications_enabled(&push_checker)
        .await
        .unwrap()
        .right()
        .expect("Should be PushNotificationsDisabled");

    // Step 4: Check last online time - offline for a while
    let online_checker = MockLastOnlineChecker::with_last_online(Duration::from_secs(60 * 60));
    let threshold = Duration::from_secs(30 * 60);
    let result = push_disabled
        .check_last_online_time(&online_checker, threshold)
        .await
        .unwrap();

    assert!(
        result.is_left(),
        "Full flow: user exists, push disabled, offline should return BatchSend"
    );
}

#[tokio::test]
async fn test_full_flow_user_not_exists() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    // Step 1: Check if allowed
    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    // Step 2: Check user existence - does not exist → DontSend (no account = no email)
    let user_checker = MockUserExistenceChecker::with_user_not_exists();
    let result = allowed.check_user_existence(&user_checker).await.unwrap();

    assert!(
        result.is_right(),
        "Full flow: user does not exist should return DontSend"
    );
}

// ============================================================================
// StateMachineDriverA::ingest Tests
// ============================================================================

fn create_driver(
    user_checker: MockUserExistenceChecker,
    notification_checker: MockPushNotificationChecker,
    online_checker: MockLastOnlineChecker,
) -> (
    StateMachineDriverA<
        MockUserExistenceChecker,
        MockPushNotificationChecker,
        MockLastOnlineChecker,
        MockDigestBatcher,
    >,
    Arc<std::sync::atomic::AtomicUsize>,
) {
    let (batcher, call_count) = MockDigestBatcher::new();
    (
        StateMachineDriverA::new_with_defaults(
            user_checker,
            notification_checker,
            online_checker,
            batcher,
            create_block_list(),
        ),
        call_count,
    )
}

#[tokio::test]
async fn test_ingest_blocked_notification_returns_dont_send() {
    let (driver, digest_calls) = create_driver(
        MockUserExistenceChecker::with_user_exists(),
        MockPushNotificationChecker::with_push_disabled(),
        MockLastOnlineChecker::with_last_online(Duration::from_secs(0)),
    );
    let notif = create_test_notification_row(BlockedNotification);

    let result = driver.ingest(notif).await.unwrap();

    assert!(
        matches!(result, StateMachineDecisionA::DontSend(_)),
        "Blocked notification should return DontSend"
    );
    assert_eq!(
        digest_calls.load(std::sync::atomic::Ordering::Relaxed),
        0,
        "Blocked notification should not queue a digest"
    );
}

#[tokio::test]
async fn test_ingest_user_not_exists_returns_dont_send() {
    let (driver, digest_calls) = create_driver(
        MockUserExistenceChecker::with_user_not_exists(),
        MockPushNotificationChecker::with_push_disabled(),
        MockLastOnlineChecker::with_last_online(Duration::from_secs(0)),
    );
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    let result = driver.ingest(notif).await.unwrap();

    assert!(
        matches!(result, StateMachineDecisionA::DontSend(_)),
        "User without account should return DontSend"
    );
    assert_eq!(
        digest_calls.load(std::sync::atomic::Ordering::Relaxed),
        0,
        "No-account path should not queue a digest"
    );
}

#[tokio::test]
async fn test_ingest_user_exists_push_enabled_returns_indeterminate() {
    let (driver, digest_calls) = create_driver(
        MockUserExistenceChecker::with_user_exists(),
        MockPushNotificationChecker::with_push_enabled(),
        MockLastOnlineChecker::with_last_online(Duration::from_secs(0)),
    );
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    let result = driver.ingest(notif).await.unwrap();

    assert!(
        matches!(result, StateMachineDecisionA::Indeterminate(_)),
        "User with push enabled should return Indeterminate (awaiting push delivery result)"
    );
    assert_eq!(
        digest_calls.load(std::sync::atomic::Ordering::Relaxed),
        0,
        "Indeterminate path should not queue a digest yet"
    );
}

#[tokio::test]
async fn test_ingest_user_exists_push_disabled_recently_online_returns_dont_send() {
    let (driver, digest_calls) = create_driver(
        MockUserExistenceChecker::with_user_exists(),
        MockPushNotificationChecker::with_push_disabled(),
        // Online 5 mins ago, threshold is 60 mins (default)
        MockLastOnlineChecker::with_last_online(Duration::from_secs(5 * 60)),
    );
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    let result = driver.ingest(notif).await.unwrap();

    assert!(
        matches!(result, StateMachineDecisionA::DontSend(_)),
        "Recently online user with push disabled should return DontSend"
    );
    assert_eq!(
        digest_calls.load(std::sync::atomic::Ordering::Relaxed),
        0,
        "Recently online user should not queue a digest"
    );
}

#[tokio::test]
async fn test_ingest_user_exists_push_disabled_offline_returns_batch_was_queued() {
    let (driver, digest_calls) = create_driver(
        MockUserExistenceChecker::with_user_exists(),
        MockPushNotificationChecker::with_push_disabled(),
        // Offline for 2 hours, threshold is 60 mins (default)
        MockLastOnlineChecker::with_last_online(Duration::from_secs(2 * 60 * 60)),
    );
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    let result = driver.ingest(notif).await.unwrap();

    assert!(
        matches!(result, StateMachineDecisionA::BatchWasQueued(_)),
        "Offline user with push disabled should return BatchWasQueued"
    );
    assert_eq!(
        digest_calls.load(std::sync::atomic::Ordering::Relaxed),
        1,
        "Offline user should have queued exactly one digest"
    );
}
