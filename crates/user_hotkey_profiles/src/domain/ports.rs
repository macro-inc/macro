//! Ports (trait contracts) for the user hotkey profiles domain.

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::{UserHotkeyProfiles, UserHotkeyProfilesError};

/// Outbound persistence port for user hotkey profiles.
pub trait UserHotkeyProfilesRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The user's stored profiles, or `None` when they never picked any.
    fn get_profiles(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<UserHotkeyProfiles>, Self::Err>> + Send;

    /// Replace the user's profiles. Returns `false` when the user does not
    /// exist.
    fn set_profiles(
        &self,
        user_id: &MacroUserIdStr<'_>,
        profiles: UserHotkeyProfiles,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Inbound service port: the user hotkey profiles API used by drivers (HTTP).
pub trait UserHotkeyProfilesService: Send + Sync + 'static {
    /// The user's profiles; Macro's own shortcuts everywhere they never picked
    /// one.
    fn get_profiles(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<UserHotkeyProfiles, UserHotkeyProfilesError>> + Send;

    /// Replace the user's profiles and return what is now stored.
    fn set_profiles(
        &self,
        user_id: &MacroUserIdStr<'_>,
        profiles: UserHotkeyProfiles,
    ) -> impl Future<Output = Result<UserHotkeyProfiles, UserHotkeyProfilesError>> + Send;
}
