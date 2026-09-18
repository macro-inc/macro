//! PostgreSQL policy adapter. No permissive cache: queued sends use current policy.

use crate::domain::{
    DisclosurePolicy, PrivacyError, PrivacyRepository, PrivacyStatus, SetPrivacyRequest,
};
use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

/// Shared pool-backed adapter; composition roots construct it.
#[derive(Clone)]
pub struct PgPrivacyRepository(pub PgPool);

#[async_trait]
impl PrivacyRepository for PgPrivacyRepository {
    async fn status(&self, user_id: &str) -> Result<PrivacyStatus, PrivacyError> {
        let row = sqlx::query!(
            r#"
            SELECT t.id, t.paying OR t.enterprise AS "paid!",
                u.team_role::text IN ('admin', 'owner') AS "is_admin!",
                COALESCE(p.hipaa_enabled, FALSE) AS "enabled!",
                p.hipaa_approved_at IS NOT NULL AS "ready!",
                COALESCE(p.revision, 0) AS "revision!"
            FROM team_user u JOIN team t ON t.id = u.team_id
            LEFT JOIN team_privacy p ON p.team_id = t.id
            WHERE u.user_id = $1
        "#,
            user_id
        )
        .fetch_optional(&self.0)
        .await
        .map_err(|_| PrivacyError::Unavailable)?;
        Ok(row
            .map(|r| PrivacyStatus {
                team_id: Some(r.id),
                hipaa_enabled: r.enabled,
                hipaa_ready: r.ready,
                paid: r.paid,
                is_admin: r.is_admin,
                revision: r.revision,
            })
            .unwrap_or_default())
    }

    async fn set(
        &self,
        user_id: &str,
        team_id: Uuid,
        request: &SetPrivacyRequest,
    ) -> Result<(), PrivacyError> {
        let mut tx = self
            .0
            .begin()
            .await
            .map_err(|_| PrivacyError::Unavailable)?;
        // Lock membership and billing rows through commit. Role changes, departure and billing
        // webhooks cannot race the guarded update below.
        let allowed = sqlx::query!(
            r#"
            SELECT t.paying OR t.enterprise AS "paid!"
            FROM team t JOIN team_user u ON u.team_id = t.id
            WHERE t.id = $1 AND u.user_id = $2 AND u.team_role::text IN ('admin', 'owner')
            FOR UPDATE OF t, u
        "#,
            team_id,
            user_id
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| PrivacyError::Unavailable)?;
        let paid = allowed.ok_or(PrivacyError::Forbidden)?.paid;
        // Readiness rows are provisioned by operations, never by the customer API.
        let changed = sqlx::query!(
            r#"
            UPDATE team_privacy SET hipaa_enabled = $2, revision = revision + 1, updated_at = now()
            WHERE team_id = $1 AND revision = $3
              AND (NOT $2 OR hipaa_enabled OR ($4 AND hipaa_approved_at IS NOT NULL))
            RETURNING revision
        "#,
            team_id,
            request.enabled,
            request.expected_revision,
            paid
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| PrivacyError::Unavailable)?;
        if changed.is_none() {
            return Err(PrivacyError::Conflict);
        }
        sqlx::query!(
            r#"
            INSERT INTO team_privacy_audit (id, team_id, actor_user_id, enabled)
            VALUES ($1, $2, $3, $4)
        "#,
            Uuid::now_v7(),
            team_id,
            user_id,
            request.enabled
        )
        .execute(&mut *tx)
        .await
        .map_err(|_| PrivacyError::Unavailable)?;
        tx.commit().await.map_err(|_| PrivacyError::Unavailable)
    }
}

#[async_trait]
impl DisclosurePolicy for PgPrivacyRepository {
    async fn restricted_team(&self, team_id: Uuid) -> Result<bool, PrivacyError> {
        sqlx::query_scalar!(r#"SELECT EXISTS (SELECT 1 FROM team_privacy WHERE team_id = $1 AND hipaa_enabled) AS "restricted!""#, team_id)
            .fetch_one(&self.0).await.map_err(|_| PrivacyError::Unavailable)
    }
    async fn restricted_user(&self, user_id: &str) -> Result<bool, PrivacyError> {
        // Email aliases are used by conversion events; normalize without logging the identity.
        let id = if user_id.starts_with("macro|") {
            user_id.to_owned()
        } else {
            format!("macro|{}", user_id.trim().to_lowercase())
        };
        sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM team_user u JOIN team_privacy p ON p.team_id = u.team_id
                WHERE u.user_id = $1 AND p.hipaa_enabled
            ) OR (
                NOT EXISTS (SELECT 1 FROM team_user WHERE user_id = $1)
                AND EXISTS (SELECT 1 FROM team_privacy WHERE hipaa_enabled)
            ) AS "restricted!"
        "#,
            id
        )
        .fetch_one(&self.0)
        .await
        .map_err(|_| PrivacyError::Unavailable)
    }

    async fn restricted_push(
        &self,
        endpoint: &str,
        notification_id: Option<Uuid>,
    ) -> Result<bool, PrivacyError> {
        let Some(notification_id) = notification_id else {
            // VoIP and other unscoped paths cannot prove source ownership.
            return self.any_restricted_workspace().await;
        };
        sqlx::query_scalar!(r#"
            SELECT NOT EXISTS (SELECT 1 FROM notification WHERE id = $2)
                OR NOT EXISTS (SELECT 1 FROM notification_user_device_registration WHERE device_endpoint = $1)
                OR EXISTS (
                    SELECT 1 FROM team_privacy p JOIN team_user u ON u.team_id = p.team_id
                    WHERE p.hipaa_enabled AND (
                        u.user_id IN (SELECT user_id FROM notification_user_device_registration WHERE device_endpoint = $1)
                        OR u.user_id IN (SELECT user_id FROM user_notification WHERE notification_id = $2)
                        OR u.user_id IN (SELECT sender_id FROM notification WHERE id = $2)
                    )
                ) AS "restricted!"
        "#, endpoint, notification_id).fetch_one(&self.0).await.map_err(|_| PrivacyError::Unavailable)
    }

    async fn any_restricted_workspace(&self) -> Result<bool, PrivacyError> {
        sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM team_privacy WHERE hipaa_enabled) AS "restricted!""#
        )
        .fetch_one(&self.0)
        .await
        .map_err(|_| PrivacyError::Unavailable)
    }
}
