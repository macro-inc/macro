//! Domain models for user hotkey profiles.

use serde::{Deserialize, Serialize};
use strum::{EnumString, IntoStaticStr};
use utoipa::ToSchema;

/// A keyboard shortcut layout for Email, modelled on another email app.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, EnumString, IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum EmailHotkeyProfile {
    /// Superhuman's shortcuts.
    Superhuman,
}

impl EmailHotkeyProfile {
    /// The name stored in the database and sent over the wire.
    pub fn as_str(self) -> &'static str {
        self.into()
    }
}

/// A keyboard shortcut layout for Tasks, modelled on another task app.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, EnumString, IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum TasksHotkeyProfile {
    /// Linear's shortcuts.
    Linear,
}

impl TasksHotkeyProfile {
    /// The name stored in the database and sent over the wire.
    pub fn as_str(self) -> &'static str {
        self.into()
    }
}

/// The keyboard shortcut layouts a user picked per area of the app. `None`
/// keeps Macro's own shortcuts there.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserHotkeyProfiles {
    /// The Email layout, or `None` for Macro's.
    #[schema(required = true)]
    pub email: Option<EmailHotkeyProfile>,
    /// The Tasks layout, or `None` for Macro's.
    #[schema(required = true)]
    pub tasks: Option<TasksHotkeyProfile>,
}

/// Errors returned by the user hotkey profiles service.
#[derive(Debug, thiserror::Error)]
pub enum UserHotkeyProfilesError {
    /// The user does not exist.
    #[error("user not found")]
    UserNotFound,
    /// Any other internal error.
    #[error("internal user hotkey profiles error: {0:?}")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for UserHotkeyProfilesError {
    fn from(report: rootcause::Report) -> Self {
        UserHotkeyProfilesError::Internal(report)
    }
}
