//! Postgres adapters for task duplicate detection.
//!
//! [`PgTaskVectorDb`] implements the embedding crate's [`VectorDb`] over the
//! `task_duplicate_embedding` table (one row per `(document_id, search_key)`
//! field). [`PgTaskMatchRepo`] owns the duplicate match graph
//! (`task_duplicate_match`).

#[cfg(test)]
mod test;

use std::collections::HashMap;

use anyhow::Context;
use async_trait::async_trait;
use embedding::embedding_provider::openai::DIMS;
use embedding::{Content, KeyedEmbedding, LabeledEmbedding, Match, SearchResults, VectorStore};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{TaskDedupError, TaskDuplicate, TaskSearchParameters};
use crate::domain::ports::TaskMatchRepo;
use crate::domain::service::ordered_pair;

/// Postgres/pgvector implementation of [`VectorDb`] for task embeddings.
///
/// Each task contributes one row per embeddable field (`title`, `body`); the
/// composite primary key `(document_id, search_key)` keeps them distinct.
///
/// Duplicate detection uses a single embedding model everywhere, so no model
/// identifier is stored per row.
#[derive(Clone)]
pub struct PgTaskVectorDb {
    pool: PgPool,
}

impl PgTaskVectorDb {
    /// Creates a store over `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl VectorStore<DIMS> for PgTaskVectorDb {
    type Error = anyhow::Error;
    type Metadata = String;
    type SearchParameters = TaskSearchParameters;

    async fn upsert_embeddings<'a>(
        &self,
        metadata: String,
        embeddings: Vec<LabeledEmbedding<'a, DIMS>>,
    ) -> anyhow::Result<()> {
        if embeddings.is_empty() {
            return Ok(());
        }

        let search_keys: Vec<String> = embeddings
            .iter()
            .map(|field| field.search_key.to_string())
            .collect();
        let contents: Vec<String> = embeddings
            .iter()
            .map(|field| field.content.as_ref().to_string())
            .collect();
        let vectors: Vec<String> = embeddings
            .iter()
            .map(|field| vector_sql_literal(&field.embedding))
            .collect();

        sqlx::query!(
            r#"
            INSERT INTO task_duplicate_embedding (document_id, search_key, content, embedding)
            SELECT $1, sk, ct, emb::vector
            FROM unnest($2::text[], $3::text[], $4::text[]) AS t(sk, ct, emb)
            ON CONFLICT (document_id, search_key) DO UPDATE
            SET content = EXCLUDED.content,
                embedding = EXCLUDED.embedding,
                updated_at = NOW()
            "#,
            metadata,
            &search_keys,
            &contents,
            &vectors,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn cosine_search(
        &self,
        query: Vec<KeyedEmbedding<DIMS>>,
        params: TaskSearchParameters,
    ) -> anyhow::Result<Vec<SearchResults<String, DIMS>>> {
        if query.is_empty() {
            return Ok(Vec::new());
        }

        let query_keys: Vec<String> = query.iter().map(|q| q.search_key.to_string()).collect();
        let query_vectors: Vec<String> = query
            .iter()
            .map(|q| vector_sql_literal(&q.embedding))
            .collect();

        // Each candidate field is scored by its best similarity to ANY query
        // field, giving the full query × stored cross-product (title↔title,
        // title↔body, body↔title, body↔body). Entities are ranked by their best
        // field score and capped at `limit`; all of a kept entity's field rows
        // are returned so the service can reconstruct its text.
        //
        // Iterative index scan keeps recall high despite the owner/team,
        // self-, and dismissed-pair filters dropping rows after the HNSW scan.
        // SET LOCAL binds to the transaction's connection, so the search must run
        // in the same transaction to see it.
        let mut tx = self.pool.begin().await?;
        sqlx::query!("SET LOCAL hnsw.iterative_scan = relaxed_order")
            .execute(&mut *tx)
            .await?;
        let rows = sqlx::query!(
            r#"
            WITH query AS (
                SELECT key, vec::vector AS vec
                FROM unnest($1::text[], $2::text[]) AS t(key, vec)
            ),
            scored AS (
                SELECT
                    e.document_id,
                    e.search_key,
                    e.content,
                    e.embedding::text AS embedding_text,
                    MAX(1 - (e.embedding <=> q.vec))::real AS score
                FROM task_duplicate_embedding e
                JOIN "Document" d ON d.id = e.document_id
                JOIN document_sub_type dst ON dst.document_id = d.id AND dst.sub_type = 'task'
                LEFT JOIN team_task tt ON tt.document_id = d.id
                CROSS JOIN query q
                WHERE d."deletedAt" IS NULL
                  AND (
                    d.owner = $3
                    OR ($4::uuid IS NOT NULL AND tt.team_id = $4)
                  )
                  AND ($5::text IS NULL OR e.document_id <> $5)
                  AND (
                    NOT $6
                    OR NOT EXISTS (
                        SELECT 1
                        FROM task_duplicate_match m
                        WHERE m.task_id = LEAST($5, e.document_id)
                          AND m.duplicate_task_id = GREATEST($5, e.document_id)
                          AND m.status = 'dismissed'
                    )
                  )
                GROUP BY e.document_id, e.search_key, e.content, e.embedding
            ),
            ranked AS (
                SELECT document_id, MAX(score) AS best
                FROM scored
                GROUP BY document_id
                ORDER BY best DESC
                LIMIT $7
            )
            SELECT
                s.document_id AS "document_id!",
                s.search_key AS "search_key!",
                s.content AS "content!",
                s.embedding_text AS "embedding_text!",
                s.score AS "score!"
            FROM scored s
            JOIN ranked r ON r.document_id = s.document_id
            ORDER BY r.best DESC, s.document_id, s.score DESC
            "#,
            &query_keys,
            &query_vectors,
            params.owner,
            params.team_id,
            params.exclude_document_id,
            params.exclude_dismissed,
            params.limit,
        )
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;

        // Group the flat (document_id, field) rows into one SearchResults per
        // entity, preserving the best-first order established by the query.
        let mut results: Vec<SearchResults<String, DIMS>> = Vec::new();
        for row in rows {
            let Some(search_key) = search_key_static(&row.search_key) else {
                tracing::warn!(
                    search_key = %row.search_key,
                    document_id = %row.document_id,
                    "skipping task embedding row with unknown search_key"
                );
                continue;
            };
            let embedding = parse_vector(&row.embedding_text)
                .with_context(|| format!("invalid stored embedding for {}", row.document_id))?;
            let matched = Match {
                score: row.score,
                embedding: LabeledEmbedding {
                    search_key,
                    content: Content::Owned(row.content),
                    embedding,
                },
            };
            match results.last_mut() {
                Some(last) if last.metadata == row.document_id => last.matches.push(matched),
                _ => results.push(SearchResults {
                    metadata: row.document_id,
                    matches: vec![matched],
                }),
            }
        }
        Ok(results)
    }
}

/// Postgres-backed duplicate match graph.
#[derive(Clone)]
pub struct PgTaskMatchRepo {
    pool: PgPool,
}

impl PgTaskMatchRepo {
    /// Creates a match repo over `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl TaskMatchRepo for PgTaskMatchRepo {
    async fn upsert_match(
        &self,
        task_id: &str,
        duplicate_task_id: &str,
        vector_score: f64,
        judge_model: Option<&str>,
        judge_reason: Option<&str>,
    ) -> Result<(), TaskDedupError> {
        let (task_id, duplicate_task_id) = ordered_pair(task_id, duplicate_task_id);
        sqlx::query!(
            r#"
            INSERT INTO task_duplicate_match (
                id,
                task_id,
                duplicate_task_id,
                status,
                vector_score,
                judge_model,
                judge_reason
            )
            VALUES ($1, $2, $3, 'active', $4, $5, $6)
            ON CONFLICT (task_id, duplicate_task_id) DO UPDATE
            SET status = 'active',
                vector_score = EXCLUDED.vector_score,
                judge_model = EXCLUDED.judge_model,
                judge_reason = EXCLUDED.judge_reason,
                updated_at = NOW()
            WHERE task_duplicate_match.status <> 'dismissed'
            "#,
            Uuid::new_v4(),
            task_id,
            duplicate_task_id,
            vector_score,
            judge_model,
            judge_reason,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn active_duplicate_component(
        &self,
        document_ids: &[String],
    ) -> Result<Vec<String>, TaskDedupError> {
        let rows = sqlx::query!(
            r#"
            WITH RECURSIVE edges(left_id, right_id) AS (
                SELECT m.task_id, m.duplicate_task_id
                FROM task_duplicate_match m
                JOIN "Document" left_document ON left_document.id = m.task_id
                JOIN "Document" right_document ON right_document.id = m.duplicate_task_id
                WHERE m.status = 'active'
                  AND left_document."deletedAt" IS NULL
                  AND right_document."deletedAt" IS NULL
            ),
            component(document_id) AS (
                SELECT DISTINCT unnest($1::text[])
                UNION
                SELECT CASE
                    WHEN edges.left_id = component.document_id THEN edges.right_id
                    ELSE edges.left_id
                END
                FROM edges
                JOIN component
                  ON component.document_id = edges.left_id
                  OR component.document_id = edges.right_id
            )
            SELECT DISTINCT document_id AS "document_id!"
            FROM component
            "#,
            document_ids,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(|row| row.document_id).collect())
    }

    async fn trim_matches(&self, document_id: &str, limit: i64) -> Result<(), TaskDedupError> {
        sqlx::query!(
            r#"
            WITH ranked AS (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        ORDER BY vector_score DESC, created_at DESC
                    ) AS rn
                FROM task_duplicate_match
                WHERE status = 'active'
                  AND (task_id = $1 OR duplicate_task_id = $1)
            )
            UPDATE task_duplicate_match m
            SET status = 'dismissed', updated_at = NOW()
            FROM ranked r
            WHERE m.id = r.id
              AND r.rn > $2
            "#,
            document_id,
            limit,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn active_duplicates(
        &self,
        document_id: &str,
    ) -> Result<Vec<TaskDuplicate>, TaskDedupError> {
        let rows = sqlx::query!(
            r#"
            SELECT
                m.id,
                CASE WHEN m.task_id = $1 THEN m.duplicate_task_id ELSE m.task_id END AS "other_task_id!",
                d.name AS "other_task_name!",
                m.vector_score AS "vector_score!",
                m.judge_reason
            FROM task_duplicate_match m
            JOIN "Document" d
              ON d.id = CASE WHEN m.task_id = $1 THEN m.duplicate_task_id ELSE m.task_id END
            WHERE m.status = 'active'
              AND (m.task_id = $1 OR m.duplicate_task_id = $1)
              AND d."deletedAt" IS NULL
            ORDER BY m.vector_score DESC, m.created_at DESC
            LIMIT 10
            "#,
            document_id,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| TaskDuplicate {
                id: row.id,
                task_id: row.other_task_id,
                task_name: row.other_task_name,
                vector_score: row.vector_score,
                judge_reason: row.judge_reason,
            })
            .collect())
    }

    async fn dismiss_match(
        &self,
        document_id: &str,
        match_id: Uuid,
        dismissed_by: &str,
    ) -> Result<bool, TaskDedupError> {
        let rows = sqlx::query!(
            r#"
            UPDATE task_duplicate_match
            SET status = 'dismissed',
                dismissed_by = $3,
                dismissed_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
              AND (task_id = $2 OR duplicate_task_id = $2)
            "#,
            match_id,
            document_id,
            dismissed_by,
        )
        .execute(&self.pool)
        .await?
        .rows_affected();

        Ok(rows > 0)
    }

    async fn match_contains(
        &self,
        document_id: &str,
        match_id: Uuid,
    ) -> Result<bool, TaskDedupError> {
        let exists = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM task_duplicate_match
                WHERE id = $1
                  AND (task_id = $2 OR duplicate_task_id = $2)
            )
            "#,
            match_id,
            document_id,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(exists.unwrap_or(false))
    }

    async fn match_document_ids(&self, match_id: Uuid) -> Result<Vec<String>, TaskDedupError> {
        let row = sqlx::query!(
            r#"
            SELECT task_id, duplicate_task_id
            FROM task_duplicate_match
            WHERE id = $1
            "#,
            match_id,
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row
            .map(|row| vec![row.task_id, row.duplicate_task_id])
            .unwrap_or_default())
    }

    async fn dismiss_match_by_id(&self, match_id: Uuid) -> Result<(), TaskDedupError> {
        sqlx::query!(
            r#"
            UPDATE task_duplicate_match
            SET status = 'dismissed', updated_at = NOW()
            WHERE id = $1
            "#,
            match_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn task_names(
        &self,
        document_ids: &[String],
    ) -> Result<HashMap<String, String>, TaskDedupError> {
        if document_ids.is_empty() {
            return Ok(HashMap::new());
        }
        let rows = sqlx::query!(
            r#"
            SELECT id, name
            FROM "Document"
            WHERE id = ANY($1)
              AND "deletedAt" IS NULL
            "#,
            document_ids,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(|row| (row.id, row.name)).collect())
    }
}

/// Formats an embedding as the pgvector text literal `[a,b,c]` used for the
/// `text::vector` casts in the queries above.
pub fn vector_sql_literal(embedding: &[f32]) -> String {
    let mut literal = String::with_capacity(embedding.len() * 8 + 2);
    literal.push('[');
    for (index, value) in embedding.iter().enumerate() {
        if index > 0 {
            literal.push(',');
        }
        literal.push_str(&value.to_string());
    }
    literal.push(']');
    literal
}

/// Parses a pgvector text literal (`[a,b,c]`) back into a fixed-size embedding.
fn parse_vector(text: &str) -> anyhow::Result<[f32; DIMS]> {
    let inner = text.trim().trim_start_matches('[').trim_end_matches(']');
    let mut embedding = [0.0_f32; DIMS];
    let mut count = 0usize;
    for part in inner.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if count >= DIMS {
            anyhow::bail!("embedding has more than {DIMS} dimensions");
        }
        embedding[count] = part
            .parse()
            .with_context(|| format!("invalid embedding component {part:?}"))?;
        count += 1;
    }
    if count != DIMS {
        anyhow::bail!("expected {DIMS} dimensions, got {count}");
    }
    Ok(embedding)
}

/// Maps a `search_key` string read from the database back to one of the known
/// static keys, so it satisfies the `&'static str` [`SearchKey`](embedding::SearchKey).
///
/// Returns `None` for unrecognized keys (e.g. a future field written by a newer
/// build, or bad data). Callers skip those rows rather than leaking the string
/// into `'static`, which would grow the heap permanently on a mixed-version
/// rollout.
fn search_key_static(key: &str) -> Option<&'static str> {
    match key {
        "title" => Some("title"),
        "body" => Some("body"),
        _ => None,
    }
}
