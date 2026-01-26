//! Mobile push notification adapter.

use rootcause::Report;

use crate::domain::models::android::FCMMessage;
use crate::domain::models::apple::APNSPushNotification;
use crate::domain::models::mobile::MessageAttributes;
use crate::domain::ports::NotificationSender;

/// Mobile push notification adapter.
///
/// This adapter sends push notifications to mobile devices via APNS (iOS)
/// and FCM (Android) through SNS.
pub struct MobilePushAdapter<P> {
    push_service: P,
}

impl<P> MobilePushAdapter<P> {
    /// Create a new mobile push adapter.
    pub fn new(push_service: P) -> Self {
        Self { push_service }
    }
}

/// Trait for mobile push service operations via SNS.
///
/// This allows the adapter to work with different SNS client implementations.
pub trait MobilePushOps {
    /// Send an iOS push notification via APNS/SNS.
    fn send_ios<T: Send>(
        &self,
        notification: APNSPushNotification<T>,
        attributes: MessageAttributes,
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;

    /// Send an Android push notification via FCM/SNS.
    fn send_android<T: Send>(
        &self,
        notification: FCMMessage<T>,
        attributes: MessageAttributes,
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;
}

impl<P: MobilePushOps + Send + Sync> NotificationSender for MobilePushAdapter<P> {
    async fn send_ios_push_notification<T: Send>(
        &self,
        notification: APNSPushNotification<T>,
        attributes: MessageAttributes,
    ) -> Result<(), Report> {
        self.push_service.send_ios(notification, attributes).await
    }

    async fn send_android_push_notification<T: Send>(
        &self,
        notification: FCMMessage<T>,
        attributes: MessageAttributes,
    ) -> Result<(), Report> {
        self.push_service.send_android(notification, attributes).await
    }
}
