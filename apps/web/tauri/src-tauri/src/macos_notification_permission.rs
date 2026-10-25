//! Authorize and deliver this app's notifications through macOS UserNotifications.
//!
//! The cross-platform notification plugin always reports permission granted on
//! desktop and delivers through the legacy NSUserNotificationCenter API. macOS
//! rejects legacy delivery after this app has connected to UserNotifications,
//! so permission reads, authorization, and delivery must all use the modern API.

use std::{fmt, ptr::NonNull};

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2_foundation::{NSBundle, NSError, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
    UNNotificationContent, UNNotificationRequest, UNNotificationSettings, UNNotificationSound,
    UNUserNotificationCenter,
};
use serde::{Serialize, Serializer};
use tokio::sync::mpsc;
use uuid::Uuid;

mod activation;
mod communication;
pub use activation::install_delegate;

#[cfg(test)]
mod test;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NotificationPermission {
    Default,
    Denied,
    Granted,
}

#[derive(Debug, thiserror::Error)]
pub enum NotificationError {
    #[error("macOS notifications require an application bundle; use the installed app")]
    MissingBundleIdentifier,
    #[error("macOS notification callback was dropped")]
    CallbackDropped,
    #[error("macOS notification {operation} failed ({domain} {code}): {description}")]
    Native {
        operation: NotificationOperation,
        domain: String,
        code: isize,
        description: String,
    },
}

#[derive(Debug)]
pub enum NotificationOperation {
    Authorization,
    Delivery,
}

impl fmt::Display for NotificationOperation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Authorization => "authorization",
            Self::Delivery => "delivery",
        })
    }
}

fn ensure_application_bundle() -> Result<(), NotificationError> {
    NSBundle::mainBundle()
        .bundleIdentifier()
        .filter(|identifier| !identifier.is_empty())
        .ok_or(NotificationError::MissingBundleIdentifier)?;
    Ok(())
}

impl Serialize for NotificationError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

fn native_error(operation: NotificationOperation, error: &NSError) -> NotificationError {
    NotificationError::Native {
        operation,
        domain: error.domain().to_string(),
        code: error.code(),
        description: error.localizedDescription().to_string(),
    }
}

fn permission_from_status(status: UNAuthorizationStatus) -> NotificationPermission {
    match status {
        UNAuthorizationStatus::NotDetermined => NotificationPermission::Default,
        UNAuthorizationStatus::Authorized
        | UNAuthorizationStatus::Provisional
        | UNAuthorizationStatus::Ephemeral => NotificationPermission::Granted,
        // Unknown future statuses must not enable notification delivery.
        _ => NotificationPermission::Denied,
    }
}

#[tauri::command]
pub async fn get_macos_notification_permission() -> Result<NotificationPermission, NotificationError>
{
    // UserNotifications raises an Objective-C exception for unbundled dev/test
    // executables. Fail explicitly before asking it to create a center.
    ensure_application_bundle()?;
    let (sender, mut receiver) = mpsc::channel(1);
    {
        let callback = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
            // SAFETY: macOS supplies a non-null settings object that remains
            // valid for the duration of this completion handler.
            let status = unsafe { settings.as_ref() }.authorizationStatus();
            let permission = permission_from_status(status);
            // The frontend may have closed while macOS was completing the read.
            let _ = sender.try_send(permission);
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .getNotificationSettingsWithCompletionHandler(&callback);
    }
    receiver
        .recv()
        .await
        .ok_or(NotificationError::CallbackDropped)
}

#[tauri::command]
pub async fn request_macos_notification_permission()
-> Result<NotificationPermission, NotificationError> {
    ensure_application_bundle()?;
    let (sender, mut receiver) = mpsc::channel(1);
    {
        let callback = RcBlock::new(move |granted: Bool, error: *mut NSError| {
            // SAFETY: the optional NSError belongs to macOS and remains valid
            // during the callback. Copy its details before returning.
            let result = match unsafe { error.as_ref() } {
                Some(error) => Err(native_error(NotificationOperation::Authorization, error)),
                None => Ok(if granted.as_bool() {
                    NotificationPermission::Granted
                } else {
                    NotificationPermission::Denied
                }),
            };
            let _ = sender.try_send(result);
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .requestAuthorizationWithOptions_completionHandler(
                UNAuthorizationOptions::Alert
                    | UNAuthorizationOptions::Sound
                    | UNAuthorizationOptions::Badge,
                &callback,
            );
    }
    receiver
        .recv()
        .await
        .ok_or(NotificationError::CallbackDropped)?
}

fn notification_content(
    title: &str,
    subtitle: Option<&str>,
    body: Option<&str>,
    thread_id: Option<&str>,
) -> Retained<UNMutableNotificationContent> {
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(title));
    content.setBody(&NSString::from_str(body.unwrap_or_default()));
    if let Some(subtitle) = subtitle {
        content.setSubtitle(&NSString::from_str(subtitle));
    }
    // Notification Center stacks a conversation's notifications together.
    if let Some(thread_id) = thread_id {
        content.setThreadIdentifier(&NSString::from_str(thread_id));
    }
    content.setSound(Some(&UNNotificationSound::defaultSound()));
    content
}

fn notification_request(
    content: &UNNotificationContent,
    notification_id: Option<&str>,
) -> Retained<UNNotificationRequest> {
    // Reusing an identifier would replace a previously delivered notification.
    let delivery_id = Uuid::new_v4().to_string();
    let identifier = match notification_id {
        Some(notification_id) => {
            let mut url =
                url::Url::parse("macro:///notification").expect("static notification URL");
            url.query_pairs_mut()
                .append_pair("notificationId", notification_id)
                .append_pair("deliveryId", &delivery_id);
            NSString::from_str(url.as_str())
        }
        None => NSString::from_str(&delivery_id),
    };
    UNNotificationRequest::requestWithIdentifier_content_trigger(&identifier, content, None)
}

/// Deliver immediately through the same framework used for authorization.
/// Completion means macOS accepted the request; system presentation settings
/// still determine whether it appears as a banner.
///
/// Every argument after `body` is optional so frontends and native builds of
/// different versions keep working together.
#[tauri::command]
#[tracing::instrument(
    name = "notification.desktop_deliver",
    skip_all,
    fields(notification_id, has_sender = sender.is_some(), has_avatar),
    err
)]
pub async fn send_macos_notification(
    title: String,
    body: Option<String>,
    notification_id: Option<String>,
    subtitle: Option<String>,
    thread_id: Option<String>,
    sender: Option<communication::Sender>,
) -> Result<(), NotificationError> {
    let span = tracing::Span::current();
    if let Some(notification_id) = &notification_id {
        span.record("notification_id", notification_id.as_str());
    }
    ensure_application_bundle()?;
    let avatar = match &sender {
        Some(sender) => sender.download_avatar().await,
        None => None,
    };
    span.record("has_avatar", avatar.is_some());
    let (result_sender, mut receiver) = mpsc::channel(1);
    {
        let content = notification_content(
            &title,
            subtitle.as_deref(),
            body.as_deref(),
            thread_id.as_deref(),
        );
        let content = match &sender {
            Some(sender) => communication::from_sender(
                content,
                sender,
                avatar.as_deref(),
                subtitle.as_deref(),
                thread_id.as_deref(),
            ),
            None => Retained::into_super(content),
        };
        let request = notification_request(&content, notification_id.as_deref());
        let callback = RcBlock::new(move |error: *mut NSError| {
            // SAFETY: the optional NSError is valid for this completion handler.
            // Copy its details before the native callback returns.
            let result = match unsafe { error.as_ref() } {
                Some(error) => Err(native_error(NotificationOperation::Delivery, error)),
                None => Ok(()),
            };
            let _ = result_sender.try_send(result);
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .addNotificationRequest_withCompletionHandler(&request, Some(&callback));
    }
    receiver
        .recv()
        .await
        .ok_or(NotificationError::CallbackDropped)?
}
