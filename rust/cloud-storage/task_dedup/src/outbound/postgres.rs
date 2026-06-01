//! Postgres task duplicate repo.

#[cfg(test)]
mod test;

use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{
    NewTask, TaskDedupError, TaskDuplicate, TaskDuplicateCandidate, TaskSimilarityCandidate,
};
use crate::domain::ports::TaskDedupRepo;
use crate::domain::service::ordered_pair;

/// A single task embedding to upsert in bulk.
#[derive(Clone)]
pub struct TaskEmbeddingUpsert {
    /// Document id of the task.
    pub document_id: String,
    /// Embedded content (the output of `task_embedding_content`).
    pub content: String,
    /// Embedding vector.
    pub embedding: Vec<f32>,
}

/// Postgres-backed task duplicate repo using pgvector.
#[derive(Clone)]
pub struct PgTaskDedupRepo {
    pool: PgPool,
}

impl PgTaskDedupRepo {
    /// Creates a Postgres repo.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Upserts many task embeddings in a single statement. Like
    /// [`TaskDedupRepo::upsert_embedding`], existing rows are updated rather than
    /// duplicated (the `document_id` primary key drives the conflict). Used by
    /// the embedding backfill to avoid one round-trip per task.
    pub async fn bulk_upsert_embeddings(
        &self,
        model: &str,
        items: &[TaskEmbeddingUpsert],
    ) -> Result<(), TaskDedupError> {
        if items.is_empty() {
            return Ok(());
        }

        let document_ids: Vec<String> = items.iter().map(|item| item.document_id.clone()).collect();
        let contents: Vec<String> = items.iter().map(|item| item.content.clone()).collect();
        let embeddings: Vec<String> = items
            .iter()
            .map(|item| vector_sql_literal(&item.embedding))
            .collect();

        sqlx::query!(
            r#"
            INSERT INTO task_duplicate_embedding (document_id, model, content, embedding)
            SELECT doc_id, $1, content, embedding_text::vector
            FROM UNNEST($2::text[], $3::text[], $4::text[])
                AS t(doc_id, content, embedding_text)
            ON CONFLICT (document_id) DO UPDATE
            SET model = EXCLUDED.model,
                content = EXCLUDED.content,
                embedding = EXCLUDED.embedding,
                updated_at = NOW()
            "#,
            model,
            &document_ids,
            &contents,
            &embeddings,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[async_trait]
impl TaskDedupRepo for PgTaskDedupRepo {
    async fn upsert_embedding(
        &self,
        document_id: &str,
        model: &str,
        content: &str,
        embedding: &[f32],
    ) -> Result<(), TaskDedupError> {
        let embedding_sql = vector_sql_literal(embedding);
        sqlx::query!(
            r#"
            INSERT INTO task_duplicate_embedding (document_id, model, content, embedding)
            VALUES ($1, $2, $3, $4::text::vector)
            ON CONFLICT (document_id) DO UPDATE
            SET model = EXCLUDED.model,
                content = EXCLUDED.content,
                embedding = EXCLUDED.embedding,
                updated_at = NOW()
            "#,
            document_id,
            model,
            content,
            embedding_sql,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn candidates(
        &self,
        task: &NewTask,
        embedding: &[f32],
        limit: i64,
    ) -> Result<Vec<TaskDuplicateCandidate>, TaskDedupError> {
        let embedding_sql = vector_sql_literal(embedding);
        let rows = sqlx::query!(
            r#"
            SELECT
                e.document_id,
                e.content,
                1 - (e.embedding <=> $2::text::vector) AS "vector_score!"
            FROM task_duplicate_embedding e
            JOIN "Document" d ON d.id = e.document_id
            JOIN document_sub_type dst ON dst.document_id = d.id AND dst.sub_type = 'task'
            LEFT JOIN team_task tt ON tt.document_id = d.id
            WHERE e.document_id <> $1
              AND d."deletedAt" IS NULL
              AND (
                d.owner = $3
                OR ($4::uuid IS NOT NULL AND tt.team_id = $4)
              )
              AND NOT EXISTS (
                SELECT 1
                FROM task_duplicate_match m
                WHERE (
                  m.task_id = LEAST($1, e.document_id)
                  AND m.duplicate_task_id = GREATEST($1, e.document_id)
                  AND m.status = 'dismissed'
                )
              )
            ORDER BY e.embedding <=> $2::text::vector
            LIMIT $5
            "#,
            task.document_id.as_str(),
            embedding_sql,
            task.owner.as_str(),
            task.team_id,
            limit,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| TaskDuplicateCandidate {
                document_id: row.document_id,
                content: row.content,
                vector_score: row.vector_score,
            })
            .collect())
    }

    async fn similarity_candidates(
        &self,
        owner: &str,
        team_id: Option<Uuid>,
        embedding: &[f32],
        limit: i64,
    ) -> Result<Vec<TaskSimilarityCandidate>, TaskDedupError> {
        let embedding_sql = vector_sql_literal(embedding);
        let rows = sqlx::query!(
            r#"
            SELECT
                e.document_id,
                d.name AS "name!",
                e.content,
                1 - (e.embedding <=> $3::text::vector) AS "vector_score!"
            FROM task_duplicate_embedding e
            JOIN "Document" d ON d.id = e.document_id
            JOIN document_sub_type dst ON dst.document_id = d.id AND dst.sub_type = 'task'
            LEFT JOIN team_task tt ON tt.document_id = d.id
            WHERE d."deletedAt" IS NULL
              AND (
                d.owner = $1
                OR ($2::uuid IS NOT NULL AND tt.team_id = $2)
              )
            ORDER BY e.embedding <=> $3::text::vector
            LIMIT $4
            "#,
            owner,
            team_id,
            embedding_sql,
            limit,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| TaskSimilarityCandidate {
                document_id: row.document_id,
                name: row.name,
                content: row.content,
                vector_score: row.vector_score,
            })
            .collect())
    }

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
}

/// Converts an embedding vector into a pgvector literal.
pub fn vector_sql_literal(embedding: &[f32]) -> String {
    let values = embedding
        .iter()
        .map(|value| format!("{value:.8}"))
        .collect::<Vec<_>>()
        .join(",");
    format!("[{values}]")
}
