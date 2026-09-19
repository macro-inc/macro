use crate::domain::models::{MacroUserIdStr, PipedreamConnection};
use crate::domain::ports::ConnectionStore;
use macro_user_id::cowlike::CowLike;
use sqlx::PgPool;

/// Postgres-backed [`ConnectionStore`] over the `pipedream_mcp_connections` table.
///
/// Rows hold no secrets: Pipedream owns the OAuth grants, we persist only
/// the app, its display name, and the Pipedream account ID.
#[derive(Clone)]
pub struct PgConnectionRepo {
    pool: PgPool,
}

impl PgConnectionRepo {
    /// Create a repository over `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl ConnectionStore for PgConnectionRepo {
    type Err = anyhow::Error;

    #[tracing::instrument(skip(self), err)]
    async fn save(&self, record: &PipedreamConnection) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            INSERT INTO pipedream_mcp_connections (user_id, app_slug, server_name, account_id, enabled)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id, app_slug) DO UPDATE SET
                server_name = EXCLUDED.server_name,
                account_id = EXCLUDED.account_id,
                enabled = EXCLUDED.enabled,
                updated_at = NOW()
            "#,
            record.user_id.as_ref(),
            record.app_slug,
            record.server_name,
            record.account_id,
            record.enabled,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn load(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> Result<Option<PipedreamConnection>, Self::Err> {
        let row = sqlx::query!(
            r#"
            SELECT user_id, app_slug, server_name, account_id, enabled
            FROM pipedream_mcp_connections
            WHERE user_id = $1 AND app_slug = $2
            "#,
            user_id.as_ref(),
            app_slug,
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(|row| {
            to_record(
                row.user_id,
                row.app_slug,
                row.server_name,
                row.account_id,
                row.enabled,
            )
        })
        .transpose()
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            "DELETE FROM pipedream_mcp_connections WHERE user_id = $1 AND app_slug = $2",
            user_id.as_ref(),
            app_slug,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn list(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<PipedreamConnection>, Self::Err> {
        let rows = sqlx::query!(
            r#"
            SELECT user_id, app_slug, server_name, account_id, enabled
            FROM pipedream_mcp_connections
            WHERE user_id = $1
            ORDER BY server_name
            "#,
            user_id.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                to_record(
                    row.user_id,
                    row.app_slug,
                    row.server_name,
                    row.account_id,
                    row.enabled,
                )
            })
            .collect()
    }
}

fn to_record(
    user_id: String,
    app_slug: String,
    server_name: String,
    account_id: String,
    enabled: bool,
) -> anyhow::Result<PipedreamConnection> {
    let user_id = MacroUserIdStr::parse_from_str(&user_id)?.into_owned();
    Ok(PipedreamConnection {
        user_id,
        app_slug,
        server_name,
        account_id,
        enabled,
    })
}
