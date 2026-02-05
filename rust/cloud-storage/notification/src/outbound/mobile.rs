//! Mobile push notification adapter.

use aws_sdk_sns::types::MessageAttributeValue;
use rootcause::Report;
use serde::Serialize;
use std::collections::HashMap;

use crate::domain::models::android::FCMMessage;
use crate::domain::models::apple::APNSPushNotification;
use crate::domain::models::mobile::{MessageAttributes, PushType, SnsTarget};
use crate::domain::ports::NotificationSender;

/// Mobile push notification adapter.
///
/// This adapter sends push notifications to mobile devices via APNS (iOS)
/// and FCM (Android) through SNS.
pub struct MobilePushAdapter<P> {
    push_service: P,
    apns_bundle_id: String,
}

impl<P> MobilePushAdapter<P> {
    /// Create a new mobile push adapter.
    pub fn new(push_service: P, apns_bundle_id: String) -> Self {
        Self {
            push_service,
            apns_bundle_id,
        }
    }
}

/// Trait for mobile push service operations via SNS.
///
/// This allows the adapter to work with different SNS client implementations.
pub trait MobilePushOps {
    /// Send a push notification to the specified endpoint ARN.
    fn push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        message: &SnsTarget<'_, T>,
        attributes: HashMap<String, MessageAttributeValue>,
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;
}

impl MobilePushOps for aws_sdk_sns::Client {
    async fn push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        message: &SnsTarget<'_, T>,
        attributes: HashMap<String, MessageAttributeValue>,
    ) -> Result<(), Report> {
        let payload = message.as_json()?;

        self.publish()
            .target_arn(endpoint_arn)
            .message_structure("json")
            .message(payload)
            .set_message_attributes(Some(attributes))
            .send()
            .await?;

        Ok(())
    }
}

impl<P: MobilePushOps + Send + Sync + 'static> NotificationSender for MobilePushAdapter<P> {
    async fn send_ios_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        notification: &APNSPushNotification<T>,
        attributes: &MessageAttributes,
    ) -> Result<(), Report> {
        let target = SnsTarget::Ios(notification);
        let sns_attributes = build_sns_attributes(&self.apns_bundle_id, attributes);
        self.push_service
            .push_notification(endpoint_arn, &target, sns_attributes)
            .await
    }

    async fn send_android_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        notification: &FCMMessage<T>,
        attributes: &MessageAttributes,
    ) -> Result<(), Report> {
        let target = SnsTarget::Android(notification);
        let sns_attributes = build_sns_attributes(&self.apns_bundle_id, attributes);
        self.push_service
            .push_notification(endpoint_arn, &target, sns_attributes)
            .await
    }
}

/// Build SNS message attributes from our domain attributes.
fn build_sns_attributes(
    apns_bundle_id: &str,
    attributes: &MessageAttributes,
) -> HashMap<String, MessageAttributeValue> {
    let push_type_str = match attributes.push_type {
        PushType::Background => "background",
        PushType::Alert => "alert",
    };

    HashMap::from([
        (
            "AWS.SNS.MOBILE.APNS.TOPIC".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value(apns_bundle_id)
                .build()
                .expect("valid attribute"),
        ),
        (
            "AWS.SNS.MOBILE.APNS.PUSH_TYPE".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value(push_type_str)
                .build()
                .expect("valid attribute"),
        ),
        (
            "AWS.SNS.MOBILE.APNS.PRIORITY".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value("5")
                .build()
                .expect("valid attribute"),
        ),
        (
            "AWS.SNS.MOBILE.APNS.COLLAPSE_ID".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value(&attributes.collapse_key)
                .build()
                .expect("valid attribute"),
        ),
    ])
}
