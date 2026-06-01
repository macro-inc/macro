//! Postgres task duplicate repo.

use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{
    NewTask, TaskDedupError, TaskDuplicate, TaskDuplicateCandidate, TaskSimilarityCandidate,
};
use crate::domain::ports::TaskDedupRepo;
use crate::domain::service::ordered_pair;

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
        rerank_score: f64,
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
                rerank_score,
                judge_model,
                judge_reason
            )
            VALUES ($1, $2, $3, 'active', $4, $5, $6, $7)
            ON CONFLICT (task_id, duplicate_task_id) DO UPDATE
            SET status = 'active',
                vector_score = EXCLUDED.vector_score,
                rerank_score = EXCLUDED.rerank_score,
                judge_model = EXCLUDED.judge_model,
                judge_reason = EXCLUDED.judge_reason,
                updated_at = NOW()
            WHERE task_duplicate_match.status <> 'dismissed'
            "#,
            Uuid::new_v4(),
            task_id,
            duplicate_task_id,
            vector_score,
            rerank_score,
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
                        ORDER BY rerank_score DESC, vector_score DESC, created_at DESC
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
                m.rerank_score AS "rerank_score!",
                m.judge_reason
            FROM task_duplicate_match m
            JOIN "Document" d
              ON d.id = CASE WHEN m.task_id = $1 THEN m.duplicate_task_id ELSE m.task_id END
            WHERE m.status = 'active'
              AND (m.task_id = $1 OR m.duplicate_task_id = $1)
              AND d."deletedAt" IS NULL
            ORDER BY m.rerank_score DESC, m.vector_score DESC, m.created_at DESC
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
                rerank_score: row.rerank_score,
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

    async fn other_task_id(
        &self,
        document_id: &str,
        match_id: Uuid,
    ) -> Result<Option<String>, TaskDedupError> {
        let row = sqlx::query!(
            r#"
            SELECT task_id, duplicate_task_id
            FROM task_duplicate_match
            WHERE id = $1
              AND (task_id = $2 OR duplicate_task_id = $2)
            "#,
            match_id,
            document_id,
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| {
            if row.task_id == document_id {
                row.duplicate_task_id
            } else {
                row.task_id
            }
        }))
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

    async fn dismiss_match_by_id_for_user(
        &self,
        match_id: Uuid,
        dismissed_by: &str,
    ) -> Result<(), TaskDedupError> {
        sqlx::query!(
            r#"
            UPDATE task_duplicate_match
            SET status = 'dismissed', dismissed_by = $2, dismissed_at = NOW(), updated_at = NOW()
            WHERE id = $1
            "#,
            match_id,
            dismissed_by,
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::PgPool;

    use super::*;
    use crate::domain::ports::TaskDedupNotifier;
    use crate::domain::service::{TaskDedupConfig, TaskDedupService, task_embedding_content};
    use crate::outbound::embedding::{LocalTaskEmbedder, local_embedding};
    use crate::outbound::judge::LocalDuplicateJudge;

    const OWNER: &str = "macro|user@user.com";
    const TEAM_ID: Uuid = uuid::uuid!("a0000000-0000-0000-0000-000000000001");
    const TASK_ONE: &str = "d1000000-0000-0000-0000-000000000001";
    const TASK_TWO: &str = "d1000000-0000-0000-0000-000000000002";
    const TASK_THREE: &str = "d1000000-0000-0000-0000-000000000003";

    struct NoopNotifier;

    #[async_trait::async_trait]
    impl TaskDedupNotifier for NoopNotifier {
        async fn notify_matches_updated(&self, _document_id: &str) -> anyhow::Result<()> {
            Ok(())
        }
    }

    fn service(pool: PgPool) -> TaskDedupService {
        let config = TaskDedupConfig::default();
        TaskDedupService::new(
            config.clone(),
            Arc::new(PgTaskDedupRepo::new(pool)),
            Arc::new(LocalTaskEmbedder),
            Arc::new(LocalDuplicateJudge::new(0.56)),
            Arc::new(NoopNotifier),
        )
    }

    async fn insert_task(pool: &PgPool, id: &str, name: &str, owner: &str) {
        sqlx::query!(
            r#"
            INSERT INTO "Document" (id, name, "fileType", owner)
            VALUES ($1, $2, 'md', $3)
            "#,
            id,
            name,
            owner,
        )
        .execute(pool)
        .await
        .unwrap();

        sqlx::query!(
            r#"
            INSERT INTO document_sub_type (document_id, sub_type)
            VALUES ($1, 'task')
            "#,
            id,
        )
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_team_task(pool: &PgPool, document_id: &str, task_num: i32) {
        sqlx::query!(
            r#"
            INSERT INTO team_task (team_id, document_id, task_num)
            VALUES ($1, $2, $3)
            "#,
            TEAM_ID,
            document_id,
            task_num,
        )
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_embedding(pool: &PgPool, document_id: &str, content: &str) {
        let embedding = vector_sql_literal(&local_embedding(content));
        sqlx::query!(
            r#"
            INSERT INTO task_duplicate_embedding (document_id, model, content, embedding)
            VALUES ($1, $2, $3, $4::text::vector)
            "#,
            document_id,
            "text-embedding-3-small",
            content,
            embedding,
        )
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_match(
        pool: &PgPool,
        task_id: &str,
        duplicate_task_id: &str,
        rerank_score: f64,
    ) -> Uuid {
        let id = Uuid::new_v4();
        let (task_id, duplicate_task_id) =
            crate::domain::service::ordered_pair(task_id, duplicate_task_id);
        sqlx::query!(
            r#"
            INSERT INTO task_duplicate_match (
                id,
                task_id,
                duplicate_task_id,
                status,
                vector_score,
                rerank_score,
                judge_model,
                judge_reason
            )
            VALUES ($1, $2, $3, 'active', 0.95, $4, 'test', 'same implementation work')
            "#,
            id,
            task_id,
            duplicate_task_id,
            rerank_score,
        )
        .execute(pool)
        .await
        .unwrap();
        id
    }

    async fn setup_tasks(pool: &PgPool) {
        insert_task(pool, TASK_ONE, "Add duplicate task detection", OWNER).await;
        insert_task(pool, TASK_TWO, "Detect duplicate tasks", OWNER).await;
        insert_task(pool, TASK_THREE, "Fix unrelated billing copy", OWNER).await;
        insert_team_task(pool, TASK_ONE, 1).await;
        insert_team_task(pool, TASK_TWO, 2).await;
        insert_team_task(pool, TASK_THREE, 3).await;
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../../documents/fixtures", scripts("documents_test_data"))
    )]
    async fn lists_active_duplicates_for_either_side_of_pair(pool: PgPool) {
        setup_tasks(&pool).await;
        let match_id = insert_match(&pool, TASK_TWO, TASK_ONE, 0.88).await;
        let service = service(pool.clone());

        let duplicates = service.active_duplicates(TASK_ONE).await.unwrap();
        assert_eq!(duplicates.len(), 1);
        assert_eq!(duplicates[0].id, match_id);
        assert_eq!(duplicates[0].task_id, TASK_TWO);
        assert_eq!(duplicates[0].task_name, "Detect duplicate tasks");
        assert_eq!(
            duplicates[0].judge_reason.as_deref(),
            Some("same implementation work")
        );

        let duplicates = service.active_duplicates(TASK_TWO).await.unwrap();
        assert_eq!(duplicates.len(), 1);
        assert_eq!(duplicates[0].task_id, TASK_ONE);
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../../documents/fixtures", scripts("documents_test_data"))
    )]
    async fn dismissed_matches_are_hidden(pool: PgPool) {
        setup_tasks(&pool).await;
        let match_id = insert_match(&pool, TASK_ONE, TASK_TWO, 0.88).await;
        let service = service(pool.clone());

        service
            .dismiss_match(TASK_ONE, match_id, OWNER)
            .await
            .unwrap();

        let duplicates = service.active_duplicates(TASK_ONE).await.unwrap();
        assert!(duplicates.is_empty());
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../../documents/fixtures", scripts("documents_test_data"))
    )]
    async fn deleted_duplicate_tasks_are_hidden(pool: PgPool) {
        setup_tasks(&pool).await;
        insert_match(&pool, TASK_ONE, TASK_TWO, 0.88).await;
        let service = service(pool.clone());

        sqlx::query!(
            r#"
            UPDATE "Document"
            SET "deletedAt" = NOW()
            WHERE id = $1
            "#,
            TASK_TWO,
        )
        .execute(&pool)
        .await
        .unwrap();

        let duplicates = service.active_duplicates(TASK_ONE).await.unwrap();
        assert!(duplicates.is_empty());
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../../documents/fixtures", scripts("documents_test_data"))
    )]
    async fn detection_inserts_match_for_similar_existing_task(pool: PgPool) {
        setup_tasks(&pool).await;

        let existing = task_embedding_content(
            "Add duplicate task detection",
            "Use pgvector embeddings to find duplicate task descriptions and show a duplicates pill.",
        );
        insert_embedding(&pool, TASK_TWO, &existing).await;

        let service = service(pool.clone());
        service
            .detect_new_task(NewTask {
                document_id: TASK_ONE.to_string(),
                owner: OWNER.to_string(),
                team_id: Some(TEAM_ID),
                title: "Add duplicate task detection".to_string(),
                markdown:
                    "Use pgvector embeddings to find duplicate task descriptions and show a duplicates pill."
                        .to_string(),
            })
            .await
            .unwrap();

        let duplicates = service.active_duplicates(TASK_ONE).await.unwrap();
        assert_eq!(duplicates.len(), 1);
        assert_eq!(duplicates[0].task_id, TASK_TWO);
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../../documents/fixtures", scripts("documents_test_data"))
    )]
    async fn detection_closes_existing_duplicate_component(pool: PgPool) {
        setup_tasks(&pool).await;
        insert_match(&pool, TASK_TWO, TASK_THREE, 0.88).await;

        let existing = task_embedding_content(
            "Add duplicate task detection",
            "Use pgvector embeddings to find duplicate task descriptions and show a duplicates pill.",
        );
        insert_embedding(&pool, TASK_TWO, &existing).await;

        let service = service(pool.clone());
        service
            .detect_new_task(NewTask {
                document_id: TASK_ONE.to_string(),
                owner: OWNER.to_string(),
                team_id: Some(TEAM_ID),
                title: "Add duplicate task detection".to_string(),
                markdown:
                    "Use pgvector embeddings to find duplicate task descriptions and show a duplicates pill."
                        .to_string(),
            })
            .await
            .unwrap();

        let mut duplicate_ids = service
            .active_duplicates(TASK_ONE)
            .await
            .unwrap()
            .into_iter()
            .map(|duplicate| duplicate.task_id)
            .collect::<Vec<_>>();
        duplicate_ids.sort();

        assert_eq!(duplicate_ids, vec![TASK_TWO, TASK_THREE]);
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../../documents/fixtures", scripts("documents_test_data"))
    )]
    async fn similarity_search_returns_similar_without_persisting(pool: PgPool) {
        setup_tasks(&pool).await;

        let similar = task_embedding_content(
            "Add duplicate task detection",
            "Use pgvector embeddings to find duplicate task descriptions and show a duplicates pill.",
        );
        insert_embedding(&pool, TASK_TWO, &similar).await;
        insert_embedding(
            &pool,
            TASK_THREE,
            &task_embedding_content(
                "Fix unrelated billing copy",
                "Update subscription receipt text.",
            ),
        )
        .await;

        let service = service(pool.clone());
        let results = service
            .similarity_search(
                OWNER,
                Some(TEAM_ID),
                "Add duplicate task detection",
                "Use pgvector embeddings to find duplicate task descriptions and show a duplicates pill.",
            )
            .await
            .unwrap();

        // Only the similar task is surfaced; the unrelated one is filtered out.
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].task_id, TASK_TWO);
        assert_eq!(results[0].task_name, "Detect duplicate tasks");

        // Nothing was persisted for the unsaved task: no extra embedding rows
        // (only the two we seeded) and no match rows at all.
        let embedding_count =
            sqlx::query_scalar!(r#"SELECT COUNT(*) AS "count!" FROM task_duplicate_embedding"#)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(embedding_count, 2);

        let match_count =
            sqlx::query_scalar!(r#"SELECT COUNT(*) AS "count!" FROM task_duplicate_match"#)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(match_count, 0);
    }
}
