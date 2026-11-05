//! `agent_repos` rows in MacroDB.

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{AgentRepo, RepoTokenHash};
use crate::domain::ports::RepoRepository;

/// Errors from [`PgRepoRepository`].
#[derive(Debug, thiserror::Error)]
pub enum PgRepoRepositoryError {
    /// The query failed.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    /// A stored user id did not parse.
    #[error("stored agent user id is malformed: {0}")]
    MalformedUserId(String),
    /// A size did not fit the column.
    #[error("size {0} does not fit in BIGINT")]
    SizeOutOfRange(u64),
}

/// [`RepoRepository`] over MacroDB.
#[derive(Clone)]
pub struct PgRepoRepository {
    pool: PgPool,
}

impl PgRepoRepository {
    /// Wrap the pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl RepoRepository for PgRepoRepository {
    type Err = PgRepoRepositoryError;

    #[tracing::instrument(skip_all, err)]
    async fn find_repo(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<AgentRepo>, PgRepoRepositoryError> {
        let row = sqlx::query!(
            r#"
            SELECT agent_user_id, team_id, token_hash, size_bytes, created_at, last_push_at
            FROM agent_repos
            WHERE agent_user_id = $1
            "#,
            agent_user_id.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else {
            return Ok(None);
        };

        let stored_user_id = MacroUserIdStr::try_from(row.agent_user_id.clone())
            .map_err(|_| PgRepoRepositoryError::MalformedUserId(row.agent_user_id))?;

        Ok(Some(AgentRepo {
            agent_user_id: stored_user_id,
            team_id: row.team_id,
            token_hash: RepoTokenHash::from_stored(row.token_hash),
            size_bytes: row.size_bytes.and_then(|size| u64::try_from(size).ok()),
            created_at: row.created_at,
            last_push_at: row.last_push_at,
        }))
    }

    #[tracing::instrument(skip_all, err)]
    async fn upsert_repo(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        team_id: Uuid,
        token_hash: &RepoTokenHash,
    ) -> Result<bool, PgRepoRepositoryError> {
        let stored = sqlx::query_scalar!(
            r#"
            INSERT INTO agent_repos (agent_user_id, team_id, token_hash)
            VALUES ($1, $2, $3)
            ON CONFLICT (agent_user_id) DO UPDATE
                SET token_hash = EXCLUDED.token_hash
                WHERE agent_repos.team_id = EXCLUDED.team_id
            RETURNING agent_user_id
            "#,
            agent_user_id.as_ref(),
            team_id,
            token_hash.as_str(),
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(stored.is_some())
    }

    #[tracing::instrument(skip_all, err)]
    async fn insert_repo_if_missing(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        team_id: Uuid,
        token_hash: &RepoTokenHash,
    ) -> Result<(), PgRepoRepositoryError> {
        sqlx::query!(
            r#"INSERT INTO agent_repos (agent_user_id, team_id, token_hash)
               VALUES ($1, $2, $3) ON CONFLICT (agent_user_id) DO NOTHING"#,
            agent_user_id.as_ref(),
            team_id,
            token_hash.as_str(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn record_push(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        size_bytes: u64,
    ) -> Result<(), PgRepoRepositoryError> {
        let size = i64::try_from(size_bytes)
            .map_err(|_| PgRepoRepositoryError::SizeOutOfRange(size_bytes))?;

        sqlx::query!(
            r#"
            UPDATE agent_repos
            SET size_bytes = $2, last_push_at = now()
            WHERE agent_user_id = $1
            "#,
            agent_user_id.as_ref(),
            size,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn delete_repo(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), PgRepoRepositoryError> {
        sqlx::query!(
            "DELETE FROM agent_repos WHERE agent_user_id = $1",
            agent_user_id.as_ref(),
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
