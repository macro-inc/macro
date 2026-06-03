use std::sync::Arc;

use embedding::embedding_provider::openai::DIMS;
use embedding::{Content, Embeddable, EmbeddingModel, LabeledEmbedding};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::*;
use crate::domain::models::NewTask;
use crate::domain::ports::TaskDedupNotifier;
use crate::domain::service::{TaskDedupConfig, TaskDedupService};
use crate::outbound::judge::LocalDuplicateJudge;
use crate::outbound::reranker::NoOpReranker;

const OWNER: &str = "macro|user@user.com";
const TEAM_ID: Uuid = uuid::uuid!("a0000000-0000-0000-0000-000000000001");
const TASK_ONE: &str = "d1000000-0000-0000-0000-000000000001";
const TASK_TWO: &str = "d1000000-0000-0000-0000-000000000002";
const TASK_THREE: &str = "d1000000-0000-0000-0000-000000000003";

type TestService = TaskDedupService<DIMS, LocalEmbedder, PgTaskVectorDb, NoOpReranker>;

struct NoopNotifier;

#[async_trait::async_trait]
impl TaskDedupNotifier for NoopNotifier {
    async fn notify_matches_updated(&self, _document_id: &str) -> anyhow::Result<()> {
        Ok(())
    }
}

/// Deterministic, offline embedder so duplicate-detection logic can be exercised
/// without calling OpenAI. Each field is embedded independently with
/// [`local_embedding`].
struct LocalEmbedder;

impl EmbeddingModel<DIMS> for LocalEmbedder {
    async fn embed(
        &self,
        content: &(dyn Embeddable + Sync),
    ) -> anyhow::Result<Vec<LabeledEmbedding<'static, DIMS>>> {
        Ok(content
            .embedding_content()
            .into_iter()
            .map(|(search_key, text)| LabeledEmbedding {
                search_key,
                embedding: local_embedding(text.as_ref()),
                content: Content::Owned(text.into_owned()),
            })
            .collect())
    }
}

/// Deterministic local embedding used only by tests. Hashes each token into a
/// fixed bucket so semantically identical inputs produce identical vectors,
/// which is enough for the pgvector similarity tests.
fn local_embedding(text: &str) -> [f32; DIMS] {
    let mut vector = [0.0_f32; DIMS];
    for token in text
        .split(|ch: char| !ch.is_alphanumeric())
        .map(str::to_lowercase)
        .filter(|token| token.len() > 2)
    {
        let mut hash = 1469598103934665603_u64;
        for byte in token.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(1099511628211);
        }
        let idx = (hash as usize) % DIMS;
        let sign = if hash & 1 == 0 { 1.0 } else { -1.0 };
        vector[idx] += sign;
    }

    let norm = vector
        .iter()
        .map(|value| value * value)
        .sum::<f32>()
        .sqrt()
        .max(1.0);
    for value in &mut vector {
        *value /= norm;
    }
    vector
}

fn service(pool: PgPool) -> TestService {
    TaskDedupService::new(
        TaskDedupConfig::default(),
        LocalEmbedder,
        PgTaskVectorDb::new(pool.clone()),
        NoOpReranker,
        Arc::new(LocalDuplicateJudge::new()),
        Arc::new(NoopNotifier),
        Arc::new(PgTaskMatchRepo::new(pool)),
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

/// Seeds the two per-field embeddings (`title`, `body`) a task would have after
/// the live pipeline embedded it.
async fn insert_task_embedding(pool: &PgPool, document_id: &str, title: &str, body: &str) {
    for (search_key, text) in [("title", title), ("body", body)] {
        let embedding = vector_sql_literal(&local_embedding(text));
        sqlx::query!(
            r#"
            INSERT INTO task_duplicate_embedding (document_id, search_key, content, embedding)
            VALUES ($1, $2, $3, $4::text::vector)
            "#,
            document_id,
            search_key,
            text,
            embedding,
        )
        .execute(pool)
        .await
        .unwrap();
    }
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

const DETECTION_TITLE: &str = "Add duplicate task detection";
const DETECTION_BODY: &str =
    "Use pgvector embeddings to find duplicate task descriptions and show a duplicates pill.";

fn detection_task(document_id: &str) -> NewTask {
    NewTask {
        document_id: document_id.to_string(),
        owner: OWNER.to_string(),
        team_id: Some(TEAM_ID),
        title: DETECTION_TITLE.to_string(),
        markdown: DETECTION_BODY.to_string(),
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../documents/fixtures",
        scripts("documents_test_data")
    )
)]
async fn upsert_embeddings_inserts_and_updates(pool: PgPool) {
    setup_tasks(&pool).await;
    let vector_db = PgTaskVectorDb::new(pool.clone());

    // Insert a task's two fields.
    vector_db
        .upsert_embeddings(
            TASK_ONE.to_string(),
            vec![
                LabeledEmbedding {
                    search_key: "title",
                    content: Content::Owned("first title".to_string()),
                    embedding: local_embedding("first title"),
                },
                LabeledEmbedding {
                    search_key: "body",
                    content: Content::Owned("first body".to_string()),
                    embedding: local_embedding("first body"),
                },
            ],
        )
        .await
        .unwrap();

    let count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM task_duplicate_embedding WHERE document_id = $1"#,
        TASK_ONE,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 2);

    // Re-upsert the title field with new content: updates in place per
    // (document_id, search_key), no duplicate row.
    vector_db
        .upsert_embeddings(
            TASK_ONE.to_string(),
            vec![LabeledEmbedding {
                search_key: "title",
                content: Content::Owned("first title updated".to_string()),
                embedding: local_embedding("first title updated"),
            }],
        )
        .await
        .unwrap();

    let count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM task_duplicate_embedding WHERE document_id = $1"#,
        TASK_ONE,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 2);

    let content = sqlx::query_scalar!(
        r#"SELECT content FROM task_duplicate_embedding WHERE document_id = $1 AND search_key = 'title'"#,
        TASK_ONE,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(content, "first title updated");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../documents/fixtures",
        scripts("documents_test_data")
    )
)]
async fn cross_field_match_query_title_to_stored_body(pool: PgPool) {
    setup_tasks(&pool).await;
    // TASK_TWO's BODY shares tokens only with the QUERY's TITLE. No same-key
    // overlap exists, so this only surfaces if the cross-product is OR'd.
    insert_task_embedding(
        &pool,
        TASK_TWO,
        "alpha bravo charlie delta",
        "echo foxtrot golf hotel",
    )
    .await;

    let service = service(pool.clone());
    let results = service
        .similarity_search(
            OWNER,
            Some(TEAM_ID),
            // query title == TASK_TWO body
            "echo foxtrot golf hotel",
            // query body matches nothing
            "india juliet kilo lima",
        )
        .await
        .unwrap();

    assert_eq!(
        results
            .iter()
            .map(|r| r.task_id.as_str())
            .collect::<Vec<_>>(),
        vec![TASK_TWO],
        "query-title vs stored-body should be an OR hit"
    );
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
    insert_task_embedding(&pool, TASK_TWO, DETECTION_TITLE, DETECTION_BODY).await;

    let service = service(pool.clone());
    service
        .detect_new_task(detection_task(TASK_ONE))
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
    insert_task_embedding(&pool, TASK_TWO, DETECTION_TITLE, DETECTION_BODY).await;

    let service = service(pool.clone());
    service
        .detect_new_task(detection_task(TASK_ONE))
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
    insert_task_embedding(&pool, TASK_TWO, DETECTION_TITLE, DETECTION_BODY).await;
    insert_task_embedding(
        &pool,
        TASK_THREE,
        "Fix unrelated billing copy",
        "Update subscription receipt text.",
    )
    .await;

    let service = service(pool.clone());
    let results = service
        .similarity_search(OWNER, Some(TEAM_ID), DETECTION_TITLE, DETECTION_BODY)
        .await
        .unwrap();

    // Only the similar task is surfaced; the unrelated one is filtered out.
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].task_id, TASK_TWO);
    assert_eq!(results[0].task_name, "Detect duplicate tasks");

    // Nothing was persisted for the unsaved task: only the seeded embeddings
    // (two fields per seeded task) and no match rows at all.
    let embedding_count =
        sqlx::query_scalar!(r#"SELECT COUNT(*) AS "count!" FROM task_duplicate_embedding"#)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(embedding_count, 4);

    let match_count =
        sqlx::query_scalar!(r#"SELECT COUNT(*) AS "count!" FROM task_duplicate_match"#)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(match_count, 0);
}
