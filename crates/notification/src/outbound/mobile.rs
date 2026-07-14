//! Mobile push notification adapter.

use aws_sdk_sns::types::MessageAttributeValue;
use rootcause::Report;
use serde::Serialize;
use std::collections::HashMap;

use crate::domain::models::android::FCMMessage;
use crate::domain::models::apple::{APNSPushNotification, VoipPushPayload};
use crate::domain::models::mobile::{MessageAttributes, PushType, SnsTarget};
use crate::domain::ports::NotificationSender;

/// Mobile push notification adapter.
///
/// This adapter sends push notifications to mobile devices via APNS (iOS)
/// and FCM (Android) through SNS.
pub struct MobilePushAdapter<P> {
    /// Push service implementation used to send SNS messages.
    pub push_service: P,
    /// APNS topic / bundle ID for regular iOS push notifications.
    pub apns_bundle_id: String,
    /// Set to `<bundle_id>.voip` when VoIP push is configured.
    pub voip_bundle_id: Option<String>,
}

/// Trait for mobile push service operations via SNS.
///
/// This allows the adapter to work with different SNS client implementations.
pub trait MobilePushOps {
    /// Send a push notification to the specified endpoint ARN using a typed SNS target.
    ///
    /// Returns the SNS message ID on success.
    fn push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        message: &SnsTarget<'_, T>,
        attributes: HashMap<String, MessageAttributeValue>,
    ) -> impl std::future::Future<Output = Result<String, Report>> + Send;
}

impl MobilePushOps for aws_sdk_sns::Client {
    async fn push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        message: &SnsTarget<'_, T>,
        attributes: HashMap<String, MessageAttributeValue>,
    ) -> Result<String, Report> {
        let payload = message.as_json()?;
        let output = self
            .publish()
            .target_arn(endpoint_arn)
            .message_structure("json")
            .message(payload)
            .set_message_attributes(Some(attributes))
            .send()
            .await
            .map_err(|e| {
                rootcause::report!(
                    "SNS publish to {endpoint_arn} failed: {}",
                    aws_sdk_sns::error::DisplayErrorContext(&e)
                )
            })?;

        Ok(output.message_id.unwrap_or_default())
    }
}

impl<P: MobilePushOps + Send + Sync + 'static> NotificationSender for MobilePushAdapter<P> {
    async fn send_ios_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        notification: &APNSPushNotification<T>,
        attributes: &MessageAttributes,
    ) -> Result<String, Report> {
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
    ) -> Result<String, Report> {
        let target = SnsTarget::Android(notification);
        let sns_attributes = build_sns_attributes(&self.apns_bundle_id, attributes);
        self.push_service
            .push_notification(endpoint_arn, &target, sns_attributes)
            .await
    }
}

impl<P: MobilePushOps + Send + Sync + 'static> MobilePushAdapter<P> {
    /// Send a VoIP push notification via APNS_VOIP.
    ///
    /// Bypasses the normal notification pipeline — sent immediately without
    /// DB persistence. Wakes the app via PushKit so CallKit can report an
    /// incoming call.
    #[tracing::instrument(err, skip(self, payload))]
    pub async fn send_voip_push(
        &self,
        endpoint_arn: &str,
        payload: &VoipPushPayload,
    ) -> Result<String, Report> {
        let voip_bundle_id = self.voip_bundle_id.as_deref().ok_or_else(|| {
            rootcause::report!("voip_bundle_id not configured on MobilePushAdapter")
        })?;

        let target: SnsTarget<'_, ()> = SnsTarget::Voip(payload);
        let attrs = build_voip_sns_attributes(voip_bundle_id);
        self.push_service
            .push_notification(endpoint_arn, &target, attrs)
            .await
    }
}

/// Build SNS message attributes for a regular APNS notification.
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

/// Build SNS message attributes for a VoIP (APNS_VOIP) notification.
fn build_voip_sns_attributes(voip_bundle_id: &str) -> HashMap<String, MessageAttributeValue> {
    HashMap::from([
        (
            "AWS.SNS.MOBILE.APNS.TOPIC".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value(voip_bundle_id)
                .build()
                .expect("valid attribute"),
        ),
        (
            "AWS.SNS.MOBILE.APNS.PUSH_TYPE".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value("voip")
                .build()
                .expect("valid attribute"),
        ),
        (
            "AWS.SNS.MOBILE.APNS.PRIORITY".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value("10")
                .build()
                .expect("valid attribute"),
        ),
        (
            "AWS.SNS.MOBILE.APNS.TTL".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value("0")
                .build()
                .expect("valid attribute"),
        ),
    ])
}
