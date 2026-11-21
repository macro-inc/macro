use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

async fn rows(pool: &PgPool) -> Vec<(String, String, String, String, Option<String>)> {
    sqlx::query!(
        r#"
        SELECT source_entity_type, source_entity_id, entity_type, entity_id, user_id
        FROM comms_entity_mentions
        ORDER BY source_entity_type, source_entity_id
        "#,
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| {
        (
            row.source_entity_type,
            row.source_entity_id,
            row.entity_type,
            row.entity_id,
            row.user_id,
        )
    })
    .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_source_mentions_one_entity_and_keeps_an_unchanged_row(pool: PgPool) {
    let task_1 = NewEntityMention {
        entity_type: "document".to_string(),
        entity_id: "task-1".to_string(),
    };
    let task_2 = NewEntityMention {
        entity_type: "document".to_string(),
        entity_id: "task-2".to_string(),
    };
    // A document that happens to share the source id is not touched.
    super::super::create_entity_mentions(&pool, "document", "s-1", None, &[task_2.clone()])
        .await
        .unwrap();

    replace_source_mention(
        &pool,
        "agent_session",
        "s-1",
        Some("macro|owner@example.com"),
        &task_1,
    )
    .await
    .unwrap();
    let first_created_at = sqlx::query_scalar!(
        "SELECT created_at FROM comms_entity_mentions WHERE source_entity_type = 'agent_session'"
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    replace_source_mention(
        &pool,
        "agent_session",
        "s-1",
        Some("macro|owner@example.com"),
        &task_1,
    )
    .await
    .unwrap();
    let again_created_at = sqlx::query_scalar!(
        "SELECT created_at FROM comms_entity_mentions WHERE source_entity_type = 'agent_session'"
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(first_created_at, again_created_at);

    replace_source_mention(
        &pool,
        "agent_session",
        "s-1",
        Some("macro|owner@example.com"),
        &task_2,
    )
    .await
    .unwrap();

    assert_eq!(
        rows(&pool).await,
        vec![
            (
                "agent_session".to_string(),
                "s-1".to_string(),
                "document".to_string(),
                "task-2".to_string(),
                Some("macro|owner@example.com".to_string()),
            ),
            (
                "document".to_string(),
                "s-1".to_string(),
                "document".to_string(),
                "task-2".to_string(),
                None,
            ),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_replaces_leave_one_row(pool: PgPool) {
    let replaces = (0..8).map(|n| {
        let pool = pool.clone();
        async move {
            let mention = NewEntityMention {
                entity_type: "document".to_string(),
                entity_id: format!("task-{}", n % 2),
            };
            replace_source_mention(&pool, "agent_session", "s-1", None, &mention).await
        }
    });
    for result in futures::future::join_all(replaces).await {
        result.unwrap();
    }

    assert_eq!(rows(&pool).await.len(), 1);
}
