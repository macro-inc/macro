use std::sync::Arc;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::*;
use crate::domain::ports::TaskDedupNotifier;
use crate::domain::service::{TaskDedupConfig, TaskDedupService, task_embedding_content};
use crate::outbound::embedding::{LocalTaskEmbedder, local_embedding};
use crate::outbound::judge::LocalDuplicateJudge;
use crate::outbound::reranker::NoOpTaskReranker;

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
        Arc::new(NoOpTaskReranker),
        Arc::new(LocalDuplicateJudge::new()),
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

async fn insert_match(pool: &PgPool, task_id: &str, duplicate_task_id: &str) -> Uuid {
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
            judge_model,
            judge_reason
        )
        VALUES ($1, $2, $3, 'active', 0.95, 'test', 'same implementation work')
        "#,
        id,
        task_id,
        duplicate_task_id,
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
    fixtures(
        path = "../../../../documents/fixtures",
        scripts("documents_test_data")
    )
)]
async fn bulk_upsert_embeddings_inserts_and_updates(pool: PgPool) {
    setup_tasks(&pool).await;
    let repo = PgTaskDedupRepo::new(pool.clone());

    // Insert two embeddings in one call.
    repo.bulk_upsert_embeddings(
        "text-embedding-3-small",
        &[
            TaskEmbeddingUpsert {
                document_id: TASK_ONE.to_string(),
                content: "first".to_string(),
                embedding: local_embedding("first"),
            },
            TaskEmbeddingUpsert {
                document_id: TASK_TWO.to_string(),
                content: "second".to_string(),
                embedding: local_embedding("second"),
            },
        ],
    )
    .await
    .unwrap();

    let count = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "count!" FROM task_duplicate_embedding"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 2);

    // Re-upsert TASK_ONE with new content: updates in place, no duplicate row.
    repo.bulk_upsert_embeddings(
        "text-embedding-3-small",
        &[TaskEmbeddingUpsert {
            document_id: TASK_ONE.to_string(),
            content: "first updated".to_string(),
            embedding: local_embedding("first updated"),
        }],
    )
    .await
    .unwrap();

    let count = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "count!" FROM task_duplicate_embedding"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 2);

    let content = sqlx::query_scalar!(
        r#"SELECT content FROM task_duplicate_embedding WHERE document_id = $1"#,
        TASK_ONE,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(content, "first updated");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../documents/fixtures",
        scripts("documents_test_data")
    )
)]
async fn lists_active_duplicates_for_either_side_of_pair(pool: PgPool) {
    setup_tasks(&pool).await;
    let match_id = insert_match(&pool, TASK_TWO, TASK_ONE).await;
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
    fixtures(
        path = "../../../../documents/fixtures",
        scripts("documents_test_data")
    )
)]
async fn dismissed_matches_are_hidden(pool: PgPool) {
    setup_tasks(&pool).await;
    let match_id = insert_match(&pool, TASK_ONE, TASK_TWO).await;
    let service = service(pool.clone());

    service
        .dismiss_matches(TASK_ONE, &[match_id], OWNER)
        .await
        .unwrap();

    let duplicates = service.active_duplicates(TASK_ONE).await.unwrap();
    assert!(duplicates.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../documents/fixtures",
        scripts("documents_test_data")
    )
)]
async fn deleted_duplicate_tasks_are_hidden(pool: PgPool) {
    setup_tasks(&pool).await;
    insert_match(&pool, TASK_ONE, TASK_TWO).await;
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
    fixtures(
        path = "../../../../documents/fixtures",
        scripts("documents_test_data")
    )
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
    fixtures(
        path = "../../../../documents/fixtures",
        scripts("documents_test_data")
    )
)]
async fn detection_closes_existing_duplicate_component(pool: PgPool) {
    setup_tasks(&pool).await;
    insert_match(&pool, TASK_TWO, TASK_THREE).await;

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
    fixtures(
        path = "../../../../documents/fixtures",
        scripts("documents_test_data")
    )
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
