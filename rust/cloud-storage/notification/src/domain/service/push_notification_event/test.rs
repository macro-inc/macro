use super::*;
use crate::domain::models::email_notification_digest::ports::MessageId;
use crate::domain::models::email_notification_digest::{
    BulkDigestFailureStateMachine, StateMachineDecisionC,
};
use crate::domain::models::push_notification_event::{EventType, SnsPushNotificationEvent};
use crate::domain::ports::{NotificationRepository, SnsEndpointManager};
use rootcause::Report;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

/// Mock notification repository that only implements delete_device_by_endpoint.
struct MockNotifRepo {
    deleted_endpoints: Mutex<Vec<String>>,
    should_fail: bool,
}

impl MockNotifRepo {
    fn new() -> Self {
        Self {
            deleted_endpoints: Mutex::new(Vec::new()),
            should_fail: false,
        }
    }

    fn failing() -> Self {
        Self {
            deleted_endpoints: Mutex::new(Vec::new()),
            should_fail: true,
        }
    }

    fn get_deleted(&self) -> Vec<String> {
        self.deleted_endpoints.lock().unwrap().clone()
    }
}

impl NotificationRepository for MockNotifRepo {
    async fn delete_device_by_endpoint(&self, endpoint_arn: &str) -> Result<(), Report> {
        self.deleted_endpoints
            .lock()
            .unwrap()
            .push(endpoint_arn.to_string());
        if self.should_fail {
            rootcause::bail!("mock device deletion failure");
        }
        Ok(())
    }

    async fn get_muted_users<'a>(
        &self,
        _: &[macro_user_id::user_id::MacroUserIdStr<'a>],
    ) -> Result<std::collections::HashSet<macro_user_id::user_id::MacroUserIdStr<'static>>, Report>
    {
        unimplemented!()
    }
    async fn get_unsubscribed_users<'a>(
        &self,
        _: &str,
        _: &[macro_user_id::user_id::MacroUserIdStr<'a>],
    ) -> Result<std::collections::HashSet<macro_user_id::user_id::MacroUserIdStr<'static>>, Report>
    {
        unimplemented!()
    }
    async fn create_notification<'a, T: Serialize + Send + Sync>(
        &self,
        _: crate::domain::models::SendNotificationRequestBuilder<
            'a,
            crate::domain::models::TaggedContent<T>,
        >,
        _: uuid::Uuid,
        _: &str,
        _: Option<&str>,
    ) -> Result<Option<Vec<crate::domain::models::UserNotificationRow<std::sync::Arc<T>>>>, Report>
    {
        unimplemented!()
    }
    async fn update_sent_status<'a>(
        &self,
        _: uuid::Uuid,
        _: &[macro_user_id::user_id::MacroUserIdStr<'a>],
    ) -> Result<(), Report> {
        unimplemented!()
    }
    async fn get_device_endpoints<'a>(
        &self,
        _: &[macro_user_id::user_id::MacroUserIdStr<'a>],
    ) -> Result<
        std::collections::HashMap<
            macro_user_id::user_id::MacroUserIdStr<'static>,
            Vec<crate::domain::models::DeviceEndpoint>,
        >,
        Report,
    > {
        unimplemented!()
    }
    async fn mark_notifications_seen(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
        _: &[uuid::Uuid],
    ) -> Result<
        Vec<
            crate::domain::models::PatchDelete<
                uuid::Uuid,
                crate::domain::models::NotificationStatusPatch,
            >,
        >,
        Report,
    > {
        unimplemented!()
    }
    async fn mark_notifications_done(
        &self,
        _: &macro_user_id::user_id::MacroUserIdStr<'_>,
        _: &[uuid::Uuid],
        _: bool,
    ) -> Result<
        Vec<
            crate::domain::models::PatchDelete<
                uuid::Uuid,
                crate::domain::models::NotificationStatusPatch,
            >,
        >,
        Report,
    > {
        unimplemented!()
    }
    async fn get_basic_notifications(
        &self,
        _: &[uuid::Uuid],
    ) -> Result<Vec<crate::domain::models::NotificationIdAndCollapseKey>, Report> {
        unimplemented!()
    }
    async fn get_digest_eligible_notification_ids(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
        _: &[uuid::Uuid],
    ) -> Result<HashSet<uuid::Uuid>, Report> {
        unimplemented!()
    }
    async fn get_user_notifications<T: serde::de::DeserializeOwned + Send>(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
        _: u32,
        _: models_pagination::Query<uuid::Uuid, models_pagination::CreatedAt, ()>,
        _: crate::domain::models::request::NotificationListFilters,
    ) -> Result<Vec<crate::domain::models::UserNotificationRow<T>>, Report> {
        unimplemented!()
    }
    async fn get_user_notifications_by_event_item_ids<T: serde::de::DeserializeOwned + Send>(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
        _: &[uuid::Uuid],
        _: u32,
        _: models_pagination::Query<uuid::Uuid, models_pagination::CreatedAt, ()>,
        _: crate::domain::models::request::NotificationListFilters,
    ) -> Result<Vec<crate::domain::models::UserNotificationRow<T>>, Report> {
        unimplemented!()
    }
    async fn get_user_notification_by_id<T: serde::de::DeserializeOwned + Send>(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
        _: uuid::Uuid,
    ) -> Result<Option<crate::domain::models::UserNotificationRow<T>>, Report> {
        unimplemented!()
    }
    async fn delete_user_notification(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
        _: uuid::Uuid,
    ) -> Result<(), Report> {
        unimplemented!()
    }
    async fn bulk_delete_user_notifications(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
        _: &[uuid::Uuid],
    ) -> Result<(), Report> {
        unimplemented!()
    }
    async fn delete_all_user_notifications(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<(), Report> {
        unimplemented!()
    }
    async fn get_device_endpoint(&self, _: &str) -> Result<Option<String>, Report> {
        unimplemented!()
    }
    async fn upsert_device(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
        _: &str,
        _: &str,
        _: &crate::domain::models::device::DeviceType,
    ) -> Result<(), Report> {
        unimplemented!()
    }
    async fn delete_device_by_token(
        &self,
        _: &str,
        _: &crate::domain::models::device::DeviceType,
    ) -> Result<String, Report> {
        unimplemented!()
    }
    async fn get_users_with_type_disabled<'a>(
        &self,
        _: &str,
        _: &[macro_user_id::user_id::MacroUserIdStr<'a>],
    ) -> Result<std::collections::HashSet<macro_user_id::user_id::MacroUserIdStr<'static>>, Report>
    {
        unimplemented!()
    }
    async fn get_disabled_notification_types(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<Vec<crate::domain::models::DisabledNotificationType>, Report> {
        unimplemented!()
    }
    async fn disable_notification_type(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
        _: &str,
    ) -> Result<(), Report> {
        unimplemented!()
    }
    async fn enable_notification_type(
        &self,
        _: macro_user_id::user_id::MacroUserIdStr<'_>,
        _: &str,
    ) -> Result<(), Report> {
        unimplemented!()
    }
}

/// Mock SNS endpoint manager that only implements delete_endpoint.
struct MockSnsManager {
    deleted_endpoints: Mutex<Vec<String>>,
    should_fail: bool,
}

impl MockSnsManager {
    fn new() -> Self {
        Self {
            deleted_endpoints: Mutex::new(Vec::new()),
            should_fail: false,
        }
    }

    fn failing() -> Self {
        Self {
            deleted_endpoints: Mutex::new(Vec::new()),
            should_fail: true,
        }
    }

    fn get_deleted(&self) -> Vec<String> {
        self.deleted_endpoints.lock().unwrap().clone()
    }
}

impl SnsEndpointManager for MockSnsManager {
    async fn delete_endpoint(&self, endpoint_arn: &str) -> Result<(), Report> {
        self.deleted_endpoints
            .lock()
            .unwrap()
            .push(endpoint_arn.to_string());
        if self.should_fail {
            rootcause::bail!("mock SNS deletion failure");
        }
        Ok(())
    }

    async fn create_platform_endpoint(&self, _: &str, _: &str) -> Result<String, Report> {
        unimplemented!()
    }
    async fn get_endpoint_attributes(&self, _: &str) -> Result<HashMap<String, String>, Report> {
        unimplemented!()
    }
    async fn set_endpoint_attributes(
        &self,
        _: &str,
        _: HashMap<String, String>,
    ) -> Result<(), Report> {
        unimplemented!()
    }
}

/// Mock digest failure state machine that tracks calls.
struct MockDigestFailureStateMachine {
    calls: Mutex<Vec<String>>,
    should_fail: bool,
}

impl MockDigestFailureStateMachine {
    fn new() -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            should_fail: false,
        }
    }

    fn failing() -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            should_fail: true,
        }
    }

    fn get_calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }
}

impl BulkDigestFailureStateMachine for MockDigestFailureStateMachine {
    async fn mark_message_as_failed(
        &self,
        message_id: MessageId,
    ) -> Result<StateMachineDecisionC, Report> {
        self.calls.lock().unwrap().push(message_id.0.clone());
        if self.should_fail {
            rootcause::bail!("mock digest failure state machine error");
        }
        Ok(StateMachineDecisionC::NoAction)
    }
}

#[tokio::test]
async fn test_delivery_failure_deletes_device_and_sns_endpoint() {
    let repository = MockNotifRepo::new();
    let sns_manager = MockSnsManager::new();
    let digest_sm = MockDigestFailureStateMachine::new();
    let service = PushNotificationEventService::new(repository, sns_manager, digest_sm);

    let event = SnsPushNotificationEvent {
        endpoint_arn: "arn:aws:sns:us-east-1:123:endpoint/APNS/app/device1".to_string(),
        event_type: EventType::DeliveryFailure,
        message_id: MessageId(String::new()),
    };

    service.handle_event(&event).await.unwrap();

    assert_eq!(
        service.repository.get_deleted(),
        vec![event.endpoint_arn.clone()]
    );
    assert_eq!(service.sns_manager.get_deleted(), vec![event.endpoint_arn]);
}

#[tokio::test]
async fn test_endpoint_deleted_only_deletes_device() {
    let repository = MockNotifRepo::new();
    let sns_manager = MockSnsManager::new();
    let digest_sm = MockDigestFailureStateMachine::new();
    let service = PushNotificationEventService::new(repository, sns_manager, digest_sm);

    let event = SnsPushNotificationEvent {
        endpoint_arn: "arn:aws:sns:us-east-1:123:endpoint/APNS/app/device1".to_string(),
        event_type: EventType::EndpointDeleted,
        message_id: MessageId(String::new()),
    };

    service.handle_event(&event).await.unwrap();

    assert_eq!(service.repository.get_deleted(), vec![event.endpoint_arn]);
    assert!(
        service.sns_manager.get_deleted().is_empty(),
        "SNS endpoint should not be deleted for EndpointDeleted events"
    );
}

#[tokio::test]
async fn test_device_deletion_failure_propagates_error() {
    let repository = MockNotifRepo::failing();
    let sns_manager = MockSnsManager::new();
    let digest_sm = MockDigestFailureStateMachine::new();
    let service = PushNotificationEventService::new(repository, sns_manager, digest_sm);

    let event = SnsPushNotificationEvent {
        endpoint_arn: "arn:aws:sns:us-east-1:123:endpoint/APNS/app/device1".to_string(),
        event_type: EventType::DeliveryFailure,
        message_id: MessageId(String::new()),
    };

    let result = service.handle_event(&event).await;
    assert!(result.is_err());

    // SNS deletion should not be attempted when DB deletion fails
    assert!(
        service.sns_manager.get_deleted().is_empty(),
        "SNS endpoint should not be deleted when device deletion fails"
    );
}

#[tokio::test]
async fn test_sns_deletion_failure_propagates_error() {
    let repository = MockNotifRepo::new();
    let sns_manager = MockSnsManager::failing();
    let digest_sm = MockDigestFailureStateMachine::new();
    let service = PushNotificationEventService::new(repository, sns_manager, digest_sm);

    let event = SnsPushNotificationEvent {
        endpoint_arn: "arn:aws:sns:us-east-1:123:endpoint/APNS/app/device1".to_string(),
        event_type: EventType::DeliveryFailure,
        message_id: MessageId(String::new()),
    };

    let result = service.handle_event(&event).await;
    assert!(result.is_err());

    // Device should still have been deleted before the SNS failure
    assert_eq!(service.repository.get_deleted(), vec![event.endpoint_arn]);
}

#[tokio::test]
async fn test_delivery_failure_calls_digest_state_machine() {
    let repository = MockNotifRepo::new();
    let sns_manager = MockSnsManager::new();
    let digest_sm = MockDigestFailureStateMachine::new();
    let service = PushNotificationEventService::new(repository, sns_manager, digest_sm);

    let event = SnsPushNotificationEvent {
        endpoint_arn: "arn:aws:sns:us-east-1:123:endpoint/APNS/app/device1".to_string(),
        event_type: EventType::DeliveryFailure,
        message_id: MessageId("msg-123".to_string()),
    };

    service.handle_event(&event).await.unwrap();

    assert_eq!(service.digest_failure_sm.get_calls(), vec!["msg-123"]);
}

#[tokio::test]
async fn test_endpoint_deleted_does_not_call_digest_state_machine() {
    let repository = MockNotifRepo::new();
    let sns_manager = MockSnsManager::new();
    let digest_sm = MockDigestFailureStateMachine::new();
    let service = PushNotificationEventService::new(repository, sns_manager, digest_sm);

    let event = SnsPushNotificationEvent {
        endpoint_arn: "arn:aws:sns:us-east-1:123:endpoint/APNS/app/device1".to_string(),
        event_type: EventType::EndpointDeleted,
        message_id: MessageId("msg-456".to_string()),
    };

    service.handle_event(&event).await.unwrap();

    assert!(
        service.digest_failure_sm.get_calls().is_empty(),
        "digest state machine should not be called for EndpointDeleted events"
    );
}

#[tokio::test]
async fn test_digest_state_machine_failure_does_not_propagate() {
    let repository = MockNotifRepo::new();
    let sns_manager = MockSnsManager::new();
    let digest_sm = MockDigestFailureStateMachine::failing();
    let service = PushNotificationEventService::new(repository, sns_manager, digest_sm);

    let event = SnsPushNotificationEvent {
        endpoint_arn: "arn:aws:sns:us-east-1:123:endpoint/APNS/app/device1".to_string(),
        event_type: EventType::DeliveryFailure,
        message_id: MessageId("msg-789".to_string()),
    };

    let result = service.handle_event(&event).await;
    assert!(result.is_ok(), "digest SM failure should not propagate");

    assert_eq!(service.digest_failure_sm.get_calls(), vec!["msg-789"]);

    assert_eq!(
        service.repository.get_deleted(),
        vec![event.endpoint_arn.clone()]
    );
    assert_eq!(service.sns_manager.get_deleted(), vec![event.endpoint_arn]);
}
