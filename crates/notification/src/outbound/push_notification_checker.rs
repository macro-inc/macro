//! This module provides an implementation of [PushNotificationChecker] which is a wrapper over some T which is a [NotificationRepository]
//!
use crate::domain::{
    models::email_notification_digest::ports::PushNotificationChecker,
    ports::NotificationRepository,
};
use cowlike::CowLike;

/// Struct which implements [PushNotificationChecker] for some T where T is [NotificationRepository]
pub struct PushNotificationCheckerImpl<T> {
    inner: T,
}

impl<T: NotificationRepository> PushNotificationCheckerImpl<T> {
    /// create a new instance of self
    pub fn new(repo: T) -> Self {
        PushNotificationCheckerImpl { inner: repo }
    }
}

impl<T: NotificationRepository> PushNotificationChecker for PushNotificationCheckerImpl<T> {
    async fn push_notification_enabled<'a>(
        &self,
        user: macro_user_id::user_id::MacroUserIdStr<'a>,
    ) -> Result<bool, rootcause::Report> {
        // a user with push notifications enabled is currently defined as someone
        // who does not have notifications muted and who has registered device endpoints.
        // This is subject to change though
        let res = self.inner.get_muted_users(&[user.copied()]).await?;

        if !res.is_empty() {
            return Ok(false);
        }
        let endpoints = self.inner.get_device_endpoints(&[user.copied()]).await?;

        Ok(match endpoints.len() {
            0 => false,
            1.. => true,
        })
    }
}
