//! [`SessionListing`] over the agent session table.

use model_entity::Entity;
use sqlx::PgPool;
use uuid::Uuid;

use super::SessionListing;

/// Reads a session's visibility from MacroDB.
pub(crate) struct PgSessionListing(pub PgPool);

impl SessionListing for PgSessionListing {
    async fn is_listed(&self, session: &Entity<'_>) -> Result<bool, rootcause::Report> {
        // The access check before this one already refused a malformed id.
        let id = Uuid::parse_str(&session.entity_id)
            .map_err(|error| rootcause::Report::new(error).into_dynamic())?;
        let listed = sqlx::query_scalar!(
            r#"SELECT EXISTS (
                SELECT 1 FROM agent_session WHERE id = $1 AND visibility = 'listed'
            ) AS "listed!""#,
            id,
        )
        .fetch_one(&self.0)
        .await
        .map_err(|error| rootcause::Report::new(error).into_dynamic())?;
        Ok(listed)
    }
}
