use std::future::Future;

use super::models::{BounceNotification, ComplaintNotification};

pub(crate) trait SuppressionStore: Send + Sync {
    // Preserve the existing helper's error and context chain without rewrapping it.
    fn bulk_upsert_block_email(
        &self,
        emails: &[&str],
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

pub(crate) trait SuppressionService: Send + Sync {
    fn handle_bounce_notification(
        &self,
        notification: &BounceNotification,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    fn handle_complaint_notification(
        &self,
        notification: &ComplaintNotification,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}
