use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

use super::delete_chat;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn delete_chat_removes_entity_row(pool: Pool<Postgres>) {
    let chat_id: String = sqlx::query_scalar!(
        r#"
        INSERT INTO "Chat" ("userId", name)
        VALUES ($1, $2)
        RETURNING id
        "#,
        "macro|test@example.com",
        "Retention Chat",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let chat_uuid = macro_uuid::string_to_uuid(&chat_id).unwrap();
    sqlx::query(
        r#"
        INSERT INTO entity (id, entity_type, owner_type, owner_id)
        VALUES ($1, 'chat', 'user', $2)
        "#,
    )
    .bind(chat_uuid)
    .bind("macro|test@example.com")
    .execute(&pool)
    .await
    .unwrap();

    delete_chat(pool.clone(), &chat_id).await.unwrap();

    let chat_count: (i64,) = sqlx::query_as(r#"SELECT COUNT(*) FROM "Chat" WHERE id = $1"#)
        .bind(&chat_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(chat_count.0, 0);

    let entity_count: (i64,) = sqlx::query_as(r#"SELECT COUNT(*) FROM entity WHERE id = $1"#)
        .bind(chat_uuid)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(entity_count.0, 0);
}
