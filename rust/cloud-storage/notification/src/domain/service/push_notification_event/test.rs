use super::*;
use crate::domain::models::email_notification_digest::ports::MessageId;
use crate::domain::models::email_notification_digest::{
    BulkDigestFailureStateMachine, StateMachineDecisionC,
};
use crate::domain::models::push_notification_event::{EventType, SnsPushNotificationEvent};
use crate::domain::ports::{DeviceRegistrationDeleter, SnsEndpointDeleter};
use rootcause::Report;
use std::sync::Mutex;

/// Mock device registration deleter that tracks calls.
struct MockDeviceDeleter {
    deleted_endpoints: Mutex<Vec<String>>,
    should_fail: bool,
}

impl MockDeviceDeleter {
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

impl DeviceRegistrationDeleter for MockDeviceDeleter {
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
}

/// Mock SNS endpoint deleter that tracks calls.
struct MockSnsDeleter {
    deleted_endpoints: Mutex<Vec<String>>,
    should_fail: bool,
}

impl MockSnsDeleter {
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

impl SnsEndpointDeleter for MockSnsDeleter {
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
    let device_deleter = MockDeviceDeleter::new();
    let sns_deleter = MockSnsDeleter::new();
    let digest_sm = MockDigestFailureStateMachine::new();
    let service = PushNotificationEventService::new(device_deleter, sns_deleter, digest_sm);

    let event = SnsPushNotificationEvent {
        endpoint_arn: "arn:aws:sns:us-east-1:123:endpoint/APNS/app/device1".to_string(),
        event_type: EventType::DeliveryFailure,
        message_id: MessageId(String::new()),
    };

    service.handle_event(&event).await.unwrap();

    assert_eq!(
        service.device_deleter.get_deleted(),
        vec![event.endpoint_arn.clone()]
    );
    assert_eq!(service.sns_deleter.get_deleted(), vec![event.endpoint_arn]);
}

#[tokio::test]
async fn test_endpoint_deleted_only_deletes_device() {
    let device_deleter = MockDeviceDeleter::new();
    let sns_deleter = MockSnsDeleter::new();
    let digest_sm = MockDigestFailureStateMachine::new();
    let service = PushNotificationEventService::new(device_deleter, sns_deleter, digest_sm);

    let event = SnsPushNotificationEvent {
        endpoint_arn: "arn:aws:sns:us-east-1:123:endpoint/APNS/app/device1".to_string(),
        event_type: EventType::EndpointDeleted,
        message_id: MessageId(String::new()),
    };

    service.handle_event(&event).await.unwrap();

    assert_eq!(
        service.device_deleter.get_deleted(),
        vec![event.endpoint_arn]
    );
    assert!(
        service.sns_deleter.get_deleted().is_empty(),
        "SNS endpoint should not be deleted for EndpointDeleted events"
    );
}

#[tokio::test]
async fn test_device_deletion_failure_propagates_error() {
    let device_deleter = MockDeviceDeleter::failing();
    let sns_deleter = MockSnsDeleter::new();
    let digest_sm = MockDigestFailureStateMachine::new();
    let service = PushNotificationEventService::new(device_deleter, sns_deleter, digest_sm);

    let event = SnsPushNotificationEvent {
        endpoint_arn: "arn:aws:sns:us-east-1:123:endpoint/APNS/app/device1".to_string(),
        event_type: EventType::DeliveryFailure,
        message_id: MessageId(String::new()),
    };

    let result = service.handle_event(&event).await;
    assert!(result.is_err());

    // SNS deletion should not be attempted when DB deletion fails
    assert!(
        service.sns_deleter.get_deleted().is_empty(),
        "SNS endpoint should not be deleted when device deletion fails"
    );
}

#[tokio::test]
async fn test_sns_deletion_failure_propagates_error() {
    let device_deleter = MockDeviceDeleter::new();
    let sns_deleter = MockSnsDeleter::failing();
    let digest_sm = MockDigestFailureStateMachine::new();
    let service = PushNotificationEventService::new(device_deleter, sns_deleter, digest_sm);

    let event = SnsPushNotificationEvent {
        endpoint_arn: "arn:aws:sns:us-east-1:123:endpoint/APNS/app/device1".to_string(),
        event_type: EventType::DeliveryFailure,
        message_id: MessageId(String::new()),
    };

    let result = service.handle_event(&event).await;
    assert!(result.is_err());

    // Device should still have been deleted before the SNS failure
    assert_eq!(
        service.device_deleter.get_deleted(),
        vec![event.endpoint_arn]
    );
}

#[tokio::test]
async fn test_delivery_failure_calls_digest_state_machine() {
    let device_deleter = MockDeviceDeleter::new();
    let sns_deleter = MockSnsDeleter::new();
    let digest_sm = MockDigestFailureStateMachine::new();
    let service = PushNotificationEventService::new(device_deleter, sns_deleter, digest_sm);

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
    let device_deleter = MockDeviceDeleter::new();
    let sns_deleter = MockSnsDeleter::new();
    let digest_sm = MockDigestFailureStateMachine::new();
    let service = PushNotificationEventService::new(device_deleter, sns_deleter, digest_sm);

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
    let device_deleter = MockDeviceDeleter::new();
    let sns_deleter = MockSnsDeleter::new();
    let digest_sm = MockDigestFailureStateMachine::failing();
    let service = PushNotificationEventService::new(device_deleter, sns_deleter, digest_sm);

    let event = SnsPushNotificationEvent {
        endpoint_arn: "arn:aws:sns:us-east-1:123:endpoint/APNS/app/device1".to_string(),
        event_type: EventType::DeliveryFailure,
        message_id: MessageId("msg-789".to_string()),
    };

    let result = service.handle_event(&event).await;
    assert!(result.is_ok(), "digest SM failure should not propagate");

    assert_eq!(service.digest_failure_sm.get_calls(), vec!["msg-789"]);

    assert_eq!(
        service.device_deleter.get_deleted(),
        vec![event.endpoint_arn.clone()]
    );
    assert_eq!(service.sns_deleter.get_deleted(), vec![event.endpoint_arn]);
}
