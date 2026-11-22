//! The `pipedream_mcp_connections` table, shared by the two hosted sources.
//!
//! Pipedream and Macro Connect keep their connections in one table keyed by
//! `(user_id, app_slug)`, told apart by `provider`. Each source reads and
//! writes through a [`HostedRepo`] bound to its own provider, so neither can
//! see or change the other's rows. The one exception is
//! [`HostedRepo::replace`]: the key is shared, so a connection completed
//! through one provider takes the app's row from the other, and the caller
//! revokes the grant it replaced.

use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use sqlx::PgPool;

#[cfg(test)]
mod test;

/// Which hosted provider holds a row's grant.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Provider {
    /// Pipedream Connect: `account_id` is a Pipedream account (`apn_...`).
    Pipedream,
    /// Macro Connect: `account_id` is the Connect app id.
    Connect,
}

impl Provider {
    /// The value stored in `pipedream_mcp_connections.provider`.
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Pipedream => "pipedream",
            Self::Connect => "connect",
        }
    }
}

/// One row of a provider.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct HostedRow {
    /// The user holding it.
    pub(crate) user: MacroUserIdStr<'static>,
    /// The slug it is stored under, e.g. `slack_v2`.
    pub(crate) app_slug: String,
    /// The display name.
    pub(crate) server_name: String,
    /// Where the provider keeps the grant.
    pub(crate) account_id: String,
    /// Whether the user has it turned on.
    pub(crate) enabled: bool,
}

/// Where a hosted provider keeps a user's grant.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Grant {
    /// The provider holding it.
    pub(crate) provider: Provider,
    /// Where that provider keeps it.
    pub(crate) account_id: String,
}

/// Revoking a grant a hosted provider keeps for a user.
///
/// `#[async_trait]` because a source holds the other provider's revoker as
/// `Arc<dyn RevokeGrant>`.
#[async_trait::async_trait]
pub(crate) trait RevokeGrant: Send + Sync {
    /// Delete the grant at `account_id`. A grant that is already gone is not
    /// an error.
    async fn revoke(&self, user: &MacroUserIdStr<'static>, account_id: &str) -> Result<(), Report>;
}

/// `pipedream_mcp_connections`, limited to one provider's rows.
#[derive(Clone)]
pub(crate) struct HostedRepo {
    pool: PgPool,
    provider: Provider,
}

impl HostedRepo {
    /// The rows of `provider`.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "composition.rs builds the sources in the next step; remove this then"
        )
    )]
    pub(crate) fn new(pool: PgPool, provider: Provider) -> Self {
        Self { pool, provider }
    }

    /// Every row the user holds here, enabled or not.
    #[tracing::instrument(skip_all, fields(provider = self.provider.as_str()), err)]
    pub(crate) async fn list(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<HostedRow>, Report> {
        let rows = sqlx::query!(
            r#"
            SELECT user_id, app_slug, server_name, account_id, enabled
            FROM pipedream_mcp_connections
            WHERE user_id = $1 AND provider = $2
            ORDER BY app_slug
            "#,
            user.as_ref(),
            self.provider.as_str(),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(Report::new)?;

        rows.into_iter()
            .map(|row| {
                Ok(HostedRow {
                    user: parse_user(&row.user_id)?,
                    app_slug: row.app_slug,
                    server_name: row.server_name,
                    account_id: row.account_id,
                    enabled: row.enabled,
                })
            })
            .collect()
    }

    /// Every user with an enabled row here under any of `slugs`.
    #[tracing::instrument(skip_all, fields(provider = self.provider.as_str()), err)]
    pub(crate) async fn holders(
        &self,
        slugs: &[&str],
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        let slugs: Vec<String> = slugs.iter().map(|slug| (*slug).to_owned()).collect();
        let users = sqlx::query_scalar!(
            r#"
            SELECT DISTINCT user_id
            FROM pipedream_mcp_connections
            WHERE app_slug = ANY($1) AND provider = $2 AND enabled
            ORDER BY user_id
            "#,
            &slugs,
            self.provider.as_str(),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(Report::new)?;

        // One malformed user id must not hide every other holder.
        Ok(users
            .iter()
            .filter_map(|user| {
                parse_user(user)
                    .inspect_err(
                        |error| tracing::warn!(error = ?error, "skipping a malformed user id"),
                    )
                    .ok()
            })
            .collect())
    }

    /// Store `row` as the user's only row for the app `slugs` name, whoever
    /// held it before, and turn it on.
    ///
    /// The table's key is `(user_id, app_slug)` across both providers, and an
    /// app can be stored under several slugs (`slack`, `slack_v2`). Every
    /// row under any of `slugs` is deleted and the new one inserted in one
    /// transaction, so the user ends with exactly one row for the app. A
    /// display name the user gave the app before is kept. Returns the rows
    /// removed, for the caller to revoke their grants.
    #[tracing::instrument(skip_all, fields(provider = self.provider.as_str(), app = %row.app_slug), err)]
    pub(crate) async fn replace(
        &self,
        row: &HostedRow,
        slugs: &[&str],
    ) -> Result<Vec<Grant>, Report> {
        let slugs: Vec<String> = slugs.iter().map(|slug| (*slug).to_owned()).collect();
        let mut transaction = self.pool.begin().await.map_err(Report::new)?;

        let removed = sqlx::query!(
            r#"
            DELETE FROM pipedream_mcp_connections
            WHERE user_id = $1 AND (app_slug = ANY($2) OR app_slug = $3)
            RETURNING app_slug, server_name, account_id, provider
            "#,
            row.user.as_ref(),
            &slugs,
            row.app_slug,
        )
        .fetch_all(&mut *transaction)
        .await
        .map_err(Report::new)?;

        // Prefer the name of the row stored under the same slug, then any.
        let kept_name = removed
            .iter()
            .find(|previous| previous.app_slug == row.app_slug)
            .or(removed.first())
            .map_or(row.server_name.as_str(), |previous| {
                previous.server_name.as_str()
            });

        sqlx::query!(
            r#"
            INSERT INTO pipedream_mcp_connections
                (user_id, app_slug, server_name, account_id, enabled, provider)
            VALUES ($1, $2, $3, $4, TRUE, $5)
            "#,
            row.user.as_ref(),
            row.app_slug,
            kept_name,
            row.account_id,
            self.provider.as_str(),
        )
        .execute(&mut *transaction)
        .await
        .map_err(Report::new)?;

        transaction.commit().await.map_err(Report::new)?;

        removed
            .into_iter()
            .map(|previous| {
                let provider = match previous.provider.as_str() {
                    "pipedream" => Provider::Pipedream,
                    "connect" => Provider::Connect,
                    other => {
                        return Err(rootcause::report!("unknown connection provider {other:?}"));
                    }
                };
                Ok(Grant {
                    provider,
                    account_id: previous.account_id,
                })
            })
            .collect()
    }

    /// Turn the user's rows under `slugs` on or off. Returns how many rows
    /// changed.
    #[tracing::instrument(skip_all, fields(provider = self.provider.as_str()), err)]
    pub(crate) async fn set_enabled(
        &self,
        user: &MacroUserIdStr<'static>,
        slugs: &[&str],
        enabled: bool,
    ) -> Result<u64, Report> {
        let slugs: Vec<String> = slugs.iter().map(|slug| (*slug).to_owned()).collect();
        let result = sqlx::query!(
            r#"
            UPDATE pipedream_mcp_connections
            SET enabled = $3, updated_at = NOW()
            WHERE user_id = $1 AND app_slug = ANY($2) AND provider = $4
            "#,
            user.as_ref(),
            &slugs,
            enabled,
            self.provider.as_str(),
        )
        .execute(&self.pool)
        .await
        .map_err(Report::new)?;

        Ok(result.rows_affected())
    }

    /// Rename the user's rows under `slugs`. Returns how many rows changed.
    #[tracing::instrument(skip_all, fields(provider = self.provider.as_str()), err)]
    pub(crate) async fn rename(
        &self,
        user: &MacroUserIdStr<'static>,
        slugs: &[&str],
        name: &str,
    ) -> Result<u64, Report> {
        let slugs: Vec<String> = slugs.iter().map(|slug| (*slug).to_owned()).collect();
        let result = sqlx::query!(
            r#"
            UPDATE pipedream_mcp_connections
            SET server_name = $3, updated_at = NOW()
            WHERE user_id = $1 AND app_slug = ANY($2) AND provider = $4
            "#,
            user.as_ref(),
            &slugs,
            name,
            self.provider.as_str(),
        )
        .execute(&self.pool)
        .await
        .map_err(Report::new)?;

        Ok(result.rows_affected())
    }

    /// Delete the user's rows under `slugs`.
    #[tracing::instrument(skip_all, fields(provider = self.provider.as_str()), err)]
    pub(crate) async fn delete(
        &self,
        user: &MacroUserIdStr<'static>,
        slugs: &[&str],
    ) -> Result<(), Report> {
        let slugs: Vec<String> = slugs.iter().map(|slug| (*slug).to_owned()).collect();
        sqlx::query!(
            r#"
            DELETE FROM pipedream_mcp_connections
            WHERE user_id = $1 AND app_slug = ANY($2) AND provider = $3
            "#,
            user.as_ref(),
            &slugs,
            self.provider.as_str(),
        )
        .execute(&self.pool)
        .await
        .map_err(Report::new)?;

        Ok(())
    }
}

/// Revoke the grants a completed connection replaced, except `kept`, the one
/// it now stores.
///
/// Best effort: the new row is already stored, and a grant left behind only
/// costs the provider a row, so a failure is logged, never returned.
/// `revoker_for` answers each provider's revoker, or `None` where that
/// provider is not configured.
pub(crate) async fn revoke_replaced(
    user: &MacroUserIdStr<'static>,
    kept: &Grant,
    replaced: Vec<Grant>,
    revoker_for: impl Fn(Provider) -> Option<std::sync::Arc<dyn RevokeGrant>>,
) {
    for grant in replaced.into_iter().filter(|grant| grant != kept) {
        let Some(revoker) = revoker_for(grant.provider) else {
            tracing::warn!(
                provider = grant.provider.as_str(),
                "cannot revoke a replaced grant: its provider is not configured"
            );
            continue;
        };

        let _ = revoker
            .revoke(user, &grant.account_id)
            .await
            .inspect_err(|error| {
                tracing::warn!(
                    error = ?error,
                    provider = grant.provider.as_str(),
                    "failed to revoke a replaced grant"
                );
            });
    }
}

fn parse_user(user: &str) -> Result<MacroUserIdStr<'static>, Report> {
    MacroUserIdStr::parse_from_str(user)
        .map(CowLike::into_owned)
        .map_err(|error| rootcause::report!("stored user id is malformed: {error}"))
}
