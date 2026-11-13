//! Installation claims read from MacroDB.

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

use crate::domain::{models::GithubError, ports::GithubInstallationClaims};

#[cfg(test)]
mod test;

/// Reads GitHub links, installations, installers and team membership.
#[derive(Clone)]
pub struct PgGithubInstallationClaims {
    pool: PgPool,
}

impl PgGithubInstallationClaims {
    /// Create the adapter over the MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl GithubInstallationClaims for PgGithubInstallationClaims {
    #[tracing::instrument(skip(self), err)]
    async fn is_linked(&self, user: &MacroUserIdStr<'_>) -> Result<bool, GithubError> {
        sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM github_links WHERE macro_id = $1) AS "linked!""#,
            user.as_ref(),
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|error| GithubError::Internal(error.into()))
    }

    // A personal installation follows the account linked now: one made with an
    // account the user has since disconnected no longer counts. Installations
    // from before installers were recorded have no installer to compare.
    #[tracing::instrument(skip(self), err)]
    async fn has_claim(
        &self,
        user: &MacroUserIdStr<'_>,
        installation_id: u64,
    ) -> Result<bool, GithubError> {
        sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM github_app_installation i
                WHERE i.id = $1
                  AND EXISTS (SELECT 1 FROM github_links l WHERE l.macro_id = $2)
                  AND (
                    (i.source_type = 'user' AND i.source_id = $2 AND NOT EXISTS (
                        SELECT 1 FROM github_app_installation_installer installer
                        WHERE installer.installation_id = i.id
                          AND installer.github_user_id NOT IN (
                              SELECT l.github_user_id FROM github_links l WHERE l.macro_id = $2
                          )
                    ))
                    OR (i.source_type = 'team' AND EXISTS (
                        SELECT 1 FROM team_user t
                        WHERE t.team_id::text = i.source_id AND t.user_id = $2
                    ))
                  )
            ) AS "claimed!"
            "#,
            installation_id.to_string(),
            user.as_ref(),
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|error| GithubError::Internal(error.into()))
    }

    // The set form of `has_claim`: the same predicate, for every candidate at
    // once. Each arm starts from the installation's rows (one installation,
    // few owners) and probes `github_links` and `team_user` by key.
    #[tracing::instrument(skip(self, users), fields(candidates = users.len()), err)]
    async fn claimants(
        &self,
        users: &[MacroUserIdStr<'static>],
        installation_id: u64,
    ) -> Result<Vec<MacroUserIdStr<'static>>, GithubError> {
        if users.is_empty() {
            return Ok(Vec::new());
        }
        let candidates: Vec<String> = users.iter().map(|user| user.as_ref().to_owned()).collect();
        let claimants = sqlx::query_scalar!(
            r#"
            SELECT DISTINCT u.user_id AS "user_id!"
            FROM unnest($2::text[]) AS u(user_id)
            JOIN github_app_installation i ON i.id = $1
            WHERE EXISTS (SELECT 1 FROM github_links l WHERE l.macro_id = u.user_id)
              AND (
                (i.source_type = 'user' AND i.source_id = u.user_id AND NOT EXISTS (
                    SELECT 1 FROM github_app_installation_installer installer
                    WHERE installer.installation_id = i.id
                      AND installer.github_user_id NOT IN (
                          SELECT l.github_user_id FROM github_links l WHERE l.macro_id = u.user_id
                      )
                ))
                OR (i.source_type = 'team' AND EXISTS (
                    SELECT 1 FROM team_user t
                    WHERE t.team_id::text = i.source_id AND t.user_id = u.user_id
                ))
              )
            "#,
            installation_id.to_string(),
            &candidates,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| GithubError::Internal(error.into()))?;
        Ok(users
            .iter()
            .filter(|user| claimants.iter().any(|claimant| claimant == user.as_ref()))
            .cloned()
            .collect())
    }
}
