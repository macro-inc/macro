use std::{fmt::Debug, future::Future};

use email_types::email::service::pubsub::LinkManagerMessage;
use uuid::Uuid;

pub(crate) trait LinkRepository: Send + Sync {
    // Keep the original concrete error's Debug representation in existing logs.
    type Error: Debug;

    fn fetch_refresh_link_ids(
        &self,
        current_hour: i32,
    ) -> impl Future<Output = Result<Vec<Uuid>, Self::Error>> + Send;
    fn fetch_health_check_link_ids(
        &self,
        interval_hours: i32,
        bucket: i32,
    ) -> impl Future<Output = Result<Vec<Uuid>, Self::Error>> + Send;
    fn fetch_unused_link_ids(
        &self,
        days: i32,
    ) -> impl Future<Output = Result<Vec<Uuid>, Self::Error>> + Send;
    fn fetch_inactive_link_ids(
        &self,
        days: i32,
    ) -> impl Future<Output = Result<Vec<Uuid>, Self::Error>> + Send;
}

pub(crate) trait LinkManagerQueue: Send + Sync {
    type Error: Debug;

    fn enqueue_link_manager_notification(
        &self,
        notification: LinkManagerMessage,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;
}

pub(crate) trait RefreshService: Send + Sync {
    fn refresh(&self) -> impl Future<Output = anyhow::Result<()>> + Send;
}
