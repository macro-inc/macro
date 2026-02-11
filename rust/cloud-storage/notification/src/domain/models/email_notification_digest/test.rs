//! Tests for the email notification digest state machine.

use super::*;
use crate::domain::models::{Notification, RateLimitConfig, RateLimitKey, UserNotificationRow};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use rootcause::Report;
use serde::{Deserialize, Serialize};
use std::future::Future;
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

    fn rate_limit_config() -> Option<RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<RateLimitKey> {
        None
    }
}

/// A notification type that should be blocked from email delivery.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct BlockedNotification;

impl Notification for BlockedNotification {
    const TYPE_NAME: &'static str = "blocked_notification";

    fn rate_limit_config() -> Option<RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<RateLimitKey> {
        None
    }
}

/// An invite notification that should be sent immediately (single send).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct InviteNotification {
    workspace_name: String,
}

impl Notification for InviteNotification {
    const TYPE_NAME: &'static str = "invite_notification";

    fn rate_limit_config() -> Option<RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<RateLimitKey> {
        None
    }
}

/// A workspace invite notification for testing multiple invite types.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct WorkspaceInviteNotification;

impl Notification for WorkspaceInviteNotification {
    const TYPE_NAME: &'static str = "workspace_invite_notification";

    fn rate_limit_config() -> Option<RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<RateLimitKey> {
        None
    }
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

fn create_test_notification_row<T>(metadata: T) -> UserNotificationRow<T> {
    UserNotificationRow {
        owner_id: test_user_id(),
        notification_id: uuid::Uuid::now_v7(),
        notification_event_type: "test".to_string(),
        entity: EntityType::Document.with_entity_str("doc_123"),
        sent: false,
        done: false,
        created_at: None,
        viewed_at: None,
        updated_at: None,
        deleted_at: None,
        notification_metadata: metadata,
        sender_id: None,
    }
}

fn create_block_list() -> EmailBlockList {
    EmailBlockList::new::<BlockedNotification>()
}

fn create_invite_list() -> ExplicitInviteAllowList {
    ExplicitInviteAllowList::new::<InviteNotification>().append::<WorkspaceInviteNotification>()
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
        "Should return AccountDoesNotExist when user does not exist"
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
// AccountDoesNotExist::batch_or_single_send Tests
// ============================================================================

#[tokio::test]
async fn test_batch_or_single_send_returns_single_send_for_invite() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(InviteNotification {
        workspace_name: "Test Workspace".to_string(),
    });

    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    let user_checker = MockUserExistenceChecker::with_user_not_exists();
    let account_not_exists = allowed
        .check_user_existence(&user_checker)
        .await
        .unwrap()
        .right()
        .expect("Should be AccountDoesNotExist");

    let invite_list = create_invite_list();
    let result = account_not_exists.batch_or_single_send(&invite_list);

    assert!(
        result.is_left(),
        "Should return SingleSend for invite notifications"
    );
}

#[tokio::test]
async fn test_batch_or_single_send_returns_batch_send_for_non_invite() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    let user_checker = MockUserExistenceChecker::with_user_not_exists();
    let account_not_exists = allowed
        .check_user_existence(&user_checker)
        .await
        .unwrap()
        .right()
        .expect("Should be AccountDoesNotExist");

    let invite_list = create_invite_list();
    let result = account_not_exists.batch_or_single_send(&invite_list);

    assert!(
        result.is_right(),
        "Should return BatchSend for non-invite notifications"
    );
}

#[tokio::test]
async fn test_batch_or_single_send_with_multiple_invite_types() {
    // Test that workspace invite also gets single send
    let block_list = create_block_list();
    let notif = create_test_notification_row(WorkspaceInviteNotification);

    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    let user_checker = MockUserExistenceChecker::with_user_not_exists();
    let account_not_exists = allowed
        .check_user_existence(&user_checker)
        .await
        .unwrap()
        .right()
        .expect("Should be AccountDoesNotExist");

    let invite_list = create_invite_list();
    let result = account_not_exists.batch_or_single_send(&invite_list);

    assert!(
        result.is_left(),
        "Should return SingleSend for workspace invite notifications"
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
async fn test_full_flow_user_not_exists_invite() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(InviteNotification {
        workspace_name: "Test Workspace".to_string(),
    });

    // Step 1: Check if allowed
    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    // Step 2: Check user existence - does not exist
    let user_checker = MockUserExistenceChecker::with_user_not_exists();
    let account_not_exists = allowed
        .check_user_existence(&user_checker)
        .await
        .unwrap()
        .right()
        .expect("Should be AccountDoesNotExist");

    // Step 3: Decide batch vs single - invite should be single
    let invite_list = create_invite_list();
    let result = account_not_exists.batch_or_single_send(&invite_list);

    assert!(
        result.is_left(),
        "Full flow: user does not exist, invite notification should return SingleSend"
    );
}

#[tokio::test]
async fn test_full_flow_user_not_exists_non_invite() {
    let block_list = create_block_list();
    let notif = create_test_notification_row(TestNotification {
        message: "hello".to_string(),
    });

    // Step 1: Check if allowed
    let allowed = block_list
        .notification_is_allowed(notif)
        .left()
        .expect("Should be allowed");

    // Step 2: Check user existence - does not exist
    let user_checker = MockUserExistenceChecker::with_user_not_exists();
    let account_not_exists = allowed
        .check_user_existence(&user_checker)
        .await
        .unwrap()
        .right()
        .expect("Should be AccountDoesNotExist");

    // Step 3: Decide batch vs single - non-invite should be batch
    let invite_list = create_invite_list();
    let result = account_not_exists.batch_or_single_send(&invite_list);

    assert!(
        result.is_right(),
        "Full flow: user does not exist, non-invite notification should return BatchSend"
    );
}
