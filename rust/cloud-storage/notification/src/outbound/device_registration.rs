//! Database adapter for deleting device registrations.

use crate::domain::ports::DeviceRegistrationDeleter;
use rootcause::Report;
use sqlx::PgPool;

/// Trait for device registration database operations.
///
/// This allows the adapter to work with different database client implementations.
pub trait DeviceRegistrationDbOps: Send + Sync + 'static {
    /// Delete a device registration by its SNS endpoint ARN.
    fn delete_by_endpoint(
        &self,
        endpoint_arn: &str,
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;
}

impl DeviceRegistrationDbOps for PgPool {
    async fn delete_by_endpoint(&self, endpoint_arn: &str) -> Result<(), Report> {
        sqlx::query!(
            r#"
            DELETE FROM notification_user_device_registration
            WHERE device_endpoint = $1
            "#,
            endpoint_arn
        )
        .execute(self)
        .await?;

        Ok(())
    }
}

/// Database-backed adapter for deleting device registrations.
pub struct DbDeviceRegistrationDeleter<D> {
    db: D,
}

impl<D> DbDeviceRegistrationDeleter<D> {
    /// Create a new database device registration deleter.
    pub fn new(db: D) -> Self {
        Self { db }
    }
}

impl<D: DeviceRegistrationDbOps> DeviceRegistrationDeleter for DbDeviceRegistrationDeleter<D> {
    #[tracing::instrument(err, skip(self))]
    async fn delete_device_by_endpoint(&self, endpoint_arn: &str) -> Result<(), Report> {
        self.db.delete_by_endpoint(endpoint_arn).await
    }
}
