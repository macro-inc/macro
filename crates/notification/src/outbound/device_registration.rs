//! Database adapter for device registration operations.

use crate::domain::models::device::DeviceType;
use macro_user_id::user_id::MacroUserIdStr;
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

    /// Look up an existing device endpoint ARN by its device token and type.
    fn get_device_endpoint(
        &self,
        device_token: &str,
        device_type: &DeviceType,
    ) -> impl std::future::Future<Output = Result<Option<String>, Report>> + Send;

    /// Upsert a device registration.
    fn upsert_device(
        &self,
        user_id: MacroUserIdStr<'_>,
        device_token: &str,
        device_endpoint: &str,
        device_type: &DeviceType,
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;

    /// Delete all of the user's registrations matching the token and type,
    /// returning the removed endpoint ARNs.
    fn delete_user_devices_by_token(
        &self,
        user_id: MacroUserIdStr<'_>,
        device_token: &str,
        device_type: &DeviceType,
    ) -> impl std::future::Future<Output = Result<Vec<String>, Report>> + Send;

    /// Delete registrations sharing the token and type but pointing at a
    /// different endpoint, returning the removed endpoint ARNs.
    fn delete_stale_devices_by_token(
        &self,
        device_token: &str,
        device_type: &DeviceType,
        active_endpoint: &str,
    ) -> impl std::future::Future<Output = Result<Vec<String>, Report>> + Send;
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

    async fn get_device_endpoint(
        &self,
        device_token: &str,
        device_type: &DeviceType,
    ) -> Result<Option<String>, Report> {
        let result = sqlx::query!(
            r#"
            SELECT d.device_endpoint
            FROM notification_user_device_registration d
            WHERE d.device_token = $1 AND d.device_type = $2
            LIMIT 1
            "#,
            device_token,
            device_type as _,
        )
        .map(|row| row.device_endpoint)
        .fetch_optional(self)
        .await?;

        Ok(result)
    }

    async fn upsert_device(
        &self,
        user_id: MacroUserIdStr<'_>,
        device_token: &str,
        device_endpoint: &str,
        device_type: &DeviceType,
    ) -> Result<(), Report> {
        let id = macro_uuid::generate_uuid_v7();
        let user_id_str = user_id.as_ref();
        sqlx::query!(
            r#"
            INSERT INTO notification_user_device_registration (id, user_id, device_token, device_endpoint, device_type)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (device_endpoint) DO UPDATE SET user_id = $2, device_token = $3, device_type = $5, updated_at = NOW()
            "#,
            id,
            user_id_str,
            device_token,
            device_endpoint,
            device_type as _,
        )
        .execute(self)
        .await?;

        Ok(())
    }

    async fn delete_user_devices_by_token(
        &self,
        user_id: MacroUserIdStr<'_>,
        device_token: &str,
        device_type: &DeviceType,
    ) -> Result<Vec<String>, Report> {
        let user_id_str = user_id.as_ref();
        let endpoints = sqlx::query!(
            r#"
            DELETE FROM notification_user_device_registration
            WHERE user_id = $1 AND device_token = $2 AND device_type = $3
            RETURNING device_endpoint
            "#,
            user_id_str,
            device_token,
            device_type as _,
        )
        .map(|row| row.device_endpoint)
        .fetch_all(self)
        .await?;

        Ok(endpoints)
    }

    async fn delete_stale_devices_by_token(
        &self,
        device_token: &str,
        device_type: &DeviceType,
        active_endpoint: &str,
    ) -> Result<Vec<String>, Report> {
        let endpoints = sqlx::query!(
            r#"
            DELETE FROM notification_user_device_registration
            WHERE device_token = $1 AND device_type = $2 AND device_endpoint != $3
            RETURNING device_endpoint
            "#,
            device_token,
            device_type as _,
            active_endpoint,
        )
        .map(|row| row.device_endpoint)
        .fetch_all(self)
        .await?;

        Ok(endpoints)
    }
}
