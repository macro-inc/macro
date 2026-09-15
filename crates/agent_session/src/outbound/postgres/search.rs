//! Bounded-to-allowlist metadata lookup for search.

use crate::{
    domain::{
        error::Result,
        search::{AgentSessionSearchMetadata, AgentSessionSearchMetadataRepo},
    },
    outbound::postgres::PgAgentSessionRepo,
};

/// Indexing reads use the primary pool; leases use a separate pool so waiting
/// index workers cannot consume the connections needed to read their snapshots.
pub struct PgSearchIndexingRepo {
    pool: sqlx::PgPool,
    lock_pool: sqlx::PgPool,
}

impl PgSearchIndexingRepo {
    /// The two pools must be independent and connect to the same primary DB.
    pub fn new(pool: sqlx::PgPool, lock_pool: sqlx::PgPool) -> Self {
        Self { pool, lock_pool }
    }
}

impl AgentSessionSearchMetadataRepo for PgSearchIndexingRepo {
    async fn search_metadata(&self, ids: &[uuid::Uuid]) -> Result<Vec<AgentSessionSearchMetadata>> {
        Ok(search_metadata(&self.pool, ids)
            .await
            .map_err(anyhow::Error::from)?)
    }
}

impl crate::domain::search::indexing::SearchIndexingRepo for PgSearchIndexingRepo {
    type Lease = sqlx::Transaction<'static, sqlx::Postgres>;

    async fn lock(
        &self,
        id: crate::domain::model::AgentSessionId,
    ) -> Result<Self::Lease, rootcause::Report> {
        let mut transaction = self.lock_pool.begin().await?;
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended('agent-session-search:' || $1::text, 0))",
            id.to_string(),
        )
        .execute(&mut *transaction)
        .await?;
        Ok(transaction)
    }

    async fn page(&self, after: Option<uuid::Uuid>) -> Result<Vec<uuid::Uuid>, rootcause::Report> {
        Ok(sqlx::query_scalar!(
            "SELECT id FROM agent_session WHERE ($1::uuid IS NULL OR id > $1) ORDER BY id LIMIT 100",
            after,
        )
        .fetch_all(&self.pool)
        .await?)
    }
}

/// Fetch current metadata for already authorized session IDs.
#[tracing::instrument(err, skip(pool, ids))]
async fn search_metadata(
    pool: &sqlx::PgPool,
    ids: &[uuid::Uuid],
) -> Result<Vec<AgentSessionSearchMetadata>, sqlx::Error> {
    sqlx::query!(
        r#"
        SELECT id, name, owner_id, bot_id, created_at, modified_at
        FROM agent_session
        WHERE id = ANY($1)
        "#,
        ids,
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| {
        Ok(AgentSessionSearchMetadata {
            id: row.id,
            name: row.name,
            owner_id: macro_user_id::user_id::MacroUserIdStr::try_from(row.owner_id)
                .map_err(|error| sqlx::Error::Decode(Box::new(error)))?,
            bot_id: row.bot_id,
            created_at: row.created_at,
            updated_at: row.modified_at,
        })
    })
    .collect()
}

impl AgentSessionSearchMetadataRepo for PgAgentSessionRepo {
    async fn search_metadata(&self, ids: &[uuid::Uuid]) -> Result<Vec<AgentSessionSearchMetadata>> {
        Ok(search_metadata(&self.pool, ids)
            .await
            .map_err(anyhow::Error::from)?)
    }
}
