use super::*;
use anyhow::Context;
use calendar_events::domain::{
    models::{AppliedGoogleGrant, CalendarGrantIntent, GoogleScopeSet},
    ports::CalendarRepository,
    service::CalendarService,
};
use std::sync::Arc;

pub struct GoogleConnectionGrants<R> {
    pub db: sqlx::PgPool,
    pub calendar: Arc<CalendarService<R>>,
}

impl<R: CalendarRepository> ConnectionGrants for GoogleConnectionGrants<R> {
    async fn unrecorded(&self, link: Uuid) -> bool {
        has_unrecorded_google_grant(&self.db, link).await
    }

    async fn apply(
        &self,
        email_link_id: Uuid,
        granted_scopes: &[String],
        intent: CalendarGrantIntent,
    ) -> Result<AppliedGoogleGrant, ConnectionError> {
        self.calendar
            .apply_google_grant(
                email_link_id,
                GoogleScopeSet::from_scopes(granted_scopes.iter().cloned()),
                intent,
            )
            .await
            .map_err(|error| {
                ConnectionError::DatabaseError(anyhow::anyhow!(
                    "failed to apply Google grant to email link: {error:?}"
                ))
            })
    }

    async fn consume(&self, in_progress_link_id: Uuid) -> Result<(), ConnectionError> {
        macro_db_client::in_progress_user_link::delete_in_progress_user_link(
            &self.db,
            &in_progress_link_id,
        )
        .await
        .context("Failed to consume applied Google grant")?;
        Ok(())
    }

    async fn clear_reauth(&self, email_link_id: Uuid) {
        email_db_client::links::update::clear_link_needs_reauth(&self.db, email_link_id)
            .await
            .inspect_err(|error| {
                tracing::warn!(error = ?error, link_id = %email_link_id, "failed to clear the reauth flag after a completed consent");
            })
            .ok();
    }
}

/// Returns false when the link is missing or the lookup fails so token discovery remains
/// best-effort on the authentication path.
pub(crate) async fn has_unrecorded_google_grant(db: &sqlx::PgPool, link_id: Uuid) -> bool {
    sqlx::query_scalar!(
        r#"
        SELECT COALESCE(g.grant_version, 0) = 0 AS "unrecorded!"
        FROM email_links l
        LEFT JOIN email_link_google_scopes g ON g.link_id = l.id
        WHERE l.id = $1
        "#,
        link_id,
    )
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .unwrap_or(false)
}
