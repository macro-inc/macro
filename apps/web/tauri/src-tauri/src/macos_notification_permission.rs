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
    UNNotificationRequest, UNNotificationSettings, UNUserNotificationCenter,
};
use serde::{Serialize, Serializer};
use tokio::sync::mpsc;
use uuid::Uuid;

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

fn notification_request(title: &str, body: Option<&str>) -> Retained<UNNotificationRequest> {
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(title));
    content.setBody(&NSString::from_str(body.unwrap_or_default()));
    // Reusing an identifier would replace a previously delivered notification.
    let identifier = NSString::from_str(&Uuid::new_v4().to_string());
    UNNotificationRequest::requestWithIdentifier_content_trigger(&identifier, &content, None)
}

/// Deliver immediately through the same framework used for authorization.
/// Completion means macOS accepted the request; system presentation settings
/// still determine whether it appears as a banner.
#[tauri::command]
pub async fn send_macos_notification(
    title: String,
    body: Option<String>,
) -> Result<(), NotificationError> {
    ensure_application_bundle()?;
    let (sender, mut receiver) = mpsc::channel(1);
    {
        let request = notification_request(&title, body.as_deref());
        let callback = RcBlock::new(move |error: *mut NSError| {
            // SAFETY: the optional NSError is valid for this completion handler.
            // Copy its details before the native callback returns.
            let result = match unsafe { error.as_ref() } {
                Some(error) => Err(native_error(NotificationOperation::Delivery, error)),
                None => Ok(()),
            };
            let _ = sender.try_send(result);
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .addNotificationRequest_withCompletionHandler(&request, Some(&callback));
    }
    receiver
        .recv()
        .await
        .ok_or(NotificationError::CallbackDropped)?
}
