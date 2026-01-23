use crate::domain::models::{
    android::FCMMessage, apple::APNSPushNotification, mobile::MessageAttributes,
};
use rootcause::Report;

pub trait NotificationSender {
    fn send_ios_push_notification<T>(
        &self,
        notification: APNSPushNotification<T>,
        attributes: MessageAttributes,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    fn send_android_push_notification<T>(
        &self,
        notification: FCMMessage<T>,
        attributes: MessageAttributes,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}
