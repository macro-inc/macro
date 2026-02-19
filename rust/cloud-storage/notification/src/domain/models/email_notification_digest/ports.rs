use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::time::Duration;

/// trait for checking whether or not a user exists
pub trait UserExistenceChecker: Send + Sync + 'static {
    /// does the user exist in the database?
    fn user_exists<'a>(
        &self,
        id: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<bool, Report>> + Send;
}

/// trait for checking whether or not a user has push notifications enabled
pub trait PushNotificationChecker: Send + Sync + 'static {
    /// does the user have push notifications enabled?
    fn push_notification_enabled<'a>(
        &self,
        user: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<bool, Report>> + Send;
}

/// trait for checking the duration since the last known online time of the user
pub trait LastOnlineChecker: Send + Sync + 'static {
    /// return the duration since the last known online time of the user
    fn last_online_checker<'a>(
        &self,
        user: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<Duration, Report>> + Send;
}
