//! PostgreSQL implementation of the [`GithubRepo`] port.

#[cfg(test)]
mod test;

use macro_user_id::cowlike::CowLike;
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::{models::GithubLink, ports::GithubRepo};

/// PostgreSQL-backed github repository.
#[derive(Clone)]
pub struct PgGithubRepo {
    pool: PgPool,
}

impl PgGithubRepo {
    /// Create a new repository backed by the given connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl GithubRepo for PgGithubRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(skip(self), err)]
    async fn get_github_link_by_user_id<'a>(
        &self,
        macro_user_id: &MacroUserId<Lowercase<'a>>,
    ) -> Result<GithubLink, Self::Err> {
        let link = sqlx::query!(
        r#"
        SELECT id, macro_id, fusionauth_user_id as "fusionauth_user_id: Uuid", github_username, github_user_id, created_at, updated_at
        FROM github_links
        WHERE macro_id = $1
        "#,
        macro_user_id.as_ref()
        )
        .try_map(|r| Ok(GithubLink{
                id: r.id,
                macro_id: MacroUserIdStr::parse_from_str(&r.macro_id)
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
                .into_owned(),
                fusionauth_user_id: r.fusionauth_user_id,
                github_username: r.github_username,
                github_user_id: r.github_user_id,
                created_at: r.created_at,
                updated_at: r.updated_at,
            }))
        .fetch_optional(&self.pool)
        .await?;

        match link {
            Some(l) => Ok(l),
            None => Err(sqlx::Error::RowNotFound),
        }
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_github_link_by_github_user_id(
        &self,
        github_user_id: &str,
    ) -> Result<GithubLink, Self::Err> {
        let link = sqlx::query!(
        r#"
        SELECT id, macro_id, fusionauth_user_id as "fusionauth_user_id: Uuid", github_username, github_user_id, created_at, updated_at
        FROM github_links
        WHERE github_user_id = $1
        "#,
        github_user_id
        )
        .try_map(|r| Ok(GithubLink{
                id: r.id,
                macro_id: MacroUserIdStr::parse_from_str(&r.macro_id)
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
                .into_owned(),
                fusionauth_user_id: r.fusionauth_user_id,
                github_username: r.github_username,
                github_user_id: r.github_user_id,
                created_at: r.created_at,
                updated_at: r.updated_at,
            }))
        .fetch_optional(&self.pool)
        .await?;

        match link {
            Some(l) => Ok(l),
            None => Err(sqlx::Error::RowNotFound),
        }
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_github_link_by_id(&self, id: &uuid::Uuid) -> Result<GithubLink, Self::Err> {
        let link = sqlx::query!(
        r#"
        SELECT id, macro_id, fusionauth_user_id as "fusionauth_user_id: Uuid", github_username, github_user_id, created_at, updated_at
        FROM github_links
        WHERE id = $1
        "#,
        id
        )
        .try_map(|r| Ok(GithubLink{
                id: r.id,
                macro_id: MacroUserIdStr::parse_from_str(&r.macro_id)
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
                .into_owned(),
                fusionauth_user_id: r.fusionauth_user_id,
                github_username: r.github_username,
                github_user_id: r.github_user_id,
                created_at: r.created_at,
                updated_at: r.updated_at,
            }))
        .fetch_optional(&self.pool)
        .await?;

        match link {
            Some(l) => Ok(l),
            None => Err(sqlx::Error::RowNotFound),
        }
    }

    #[tracing::instrument(skip(self), err)]
    async fn insert_github_link(&self, link: &GithubLink) -> Result<(), Self::Err> {
        sqlx::query!(
                  r#"
                  INSERT INTO github_links (id, macro_id, fusionauth_user_id, github_username, github_user_id, created_at, updated_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7)
                  "#,
                  link.id,
                  link.macro_id.as_ref(),
                  link.fusionauth_user_id,
                  link.github_username,
                  link.github_user_id,
                  link.created_at,
                  link.updated_at,
              )
              .execute(&self.pool)
              .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_in_progress_user_link(
        &self,
        in_progress_link_id: &uuid::Uuid,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            DELETE FROM
                in_progress_user_link
            WHERE
                id = $1
        "#,
            in_progress_link_id
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_github_link(&self, link_id: &uuid::Uuid) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            DELETE FROM github_links
            WHERE id = $1
            "#,
            link_id
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
