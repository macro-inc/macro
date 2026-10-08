//! Read and request this app's notification authorization from macOS.
//!
//! The cross-platform notification plugin always reports permission granted on
//! desktop. Its delivery transport remains in use; these commands provide the
//! actual system permission without prompting during a permission read.

use std::ptr::NonNull;

use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_foundation::{NSBundle, NSError};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNNotificationSettings, UNUserNotificationCenter,
};
use serde::{Serialize, Serializer};
use tokio::sync::mpsc;

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
pub enum NotificationPermissionError {
    #[error("macOS notification permissions require an application bundle; use the installed app")]
    MissingBundleIdentifier,
    #[error("macOS notification permission callback was dropped")]
    CallbackDropped,
    #[error("macOS notification authorization failed ({domain} {code}): {description}")]
    Native {
        domain: String,
        code: isize,
        description: String,
    },
}

fn ensure_application_bundle() -> Result<(), NotificationPermissionError> {
    NSBundle::mainBundle()
        .bundleIdentifier()
        .filter(|identifier| !identifier.is_empty())
        .ok_or(NotificationPermissionError::MissingBundleIdentifier)?;
    Ok(())
}

impl Serialize for NotificationPermissionError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
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
pub async fn get_macos_notification_permission()
-> Result<NotificationPermission, NotificationPermissionError> {
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
        .ok_or(NotificationPermissionError::CallbackDropped)
}

#[tauri::command]
pub async fn request_macos_notification_permission()
-> Result<NotificationPermission, NotificationPermissionError> {
    ensure_application_bundle()?;
    let (sender, mut receiver) = mpsc::channel(1);
    {
        let callback = RcBlock::new(move |granted: Bool, error: *mut NSError| {
            // SAFETY: the optional NSError belongs to macOS and remains valid
            // during the callback. Copy its details before returning.
            let result = match unsafe { error.as_ref() } {
                Some(error) => Err(NotificationPermissionError::Native {
                    domain: error.domain().to_string(),
                    code: error.code(),
                    description: error.localizedDescription().to_string(),
                }),
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
        .ok_or(NotificationPermissionError::CallbackDropped)?
}
