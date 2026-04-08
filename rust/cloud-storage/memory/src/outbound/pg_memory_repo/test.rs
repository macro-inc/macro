use super::PgMemoryRepo;
use crate::domain::{MemoryError, MemoryRepo};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Pool, Postgres};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn save_and_get_by_id(pool: Pool<Postgres>) {
    let repo = PgMemoryRepo::new(pool);
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    let memory_text = "User is a senior engineer working on cloud infra".to_string();

    let id = repo.save_memory(&memory_text, user.clone()).await.unwrap();
    let fetched = repo.get_memory_by_id(user, id).await.unwrap();

    assert_eq!(fetched, memory_text);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_latest_returns_most_recent(pool: Pool<Postgres>) {
    let repo = PgMemoryRepo::new(pool);
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    repo.save_memory(&"first memory".to_string(), user.clone())
        .await
        .unwrap();
    repo.save_memory(&"second memory".to_string(), user.clone())
        .await
        .unwrap();

    let record = repo.get_latest_memory(user).await.unwrap().unwrap();
    assert_eq!(record.memory, "second memory");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_latest_no_memories_returns_none(pool: Pool<Postgres>) {
    let repo = PgMemoryRepo::new(pool);
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    let result = repo.get_latest_memory(user).await.unwrap();
    assert!(result.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_by_id_wrong_user_returns_error(pool: Pool<Postgres>) {
    let repo = PgMemoryRepo::new(pool);
    let user_a = MacroUserIdStr::parse_from_str("macro|user-a@example.com").unwrap();
    let user_b = MacroUserIdStr::parse_from_str("macro|user-b@example.com").unwrap();

    let id = repo
        .save_memory(&"private memory".to_string(), user_a)
        .await
        .unwrap();

    let result = repo.get_memory_by_id(user_b, id).await;
    assert!(matches!(result, Err(MemoryError::NoGeneration)));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_by_id_nonexistent_returns_error(pool: Pool<Postgres>) {
    let repo = PgMemoryRepo::new(pool);
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    let fake_id = macro_uuid::generate_uuid_v7();

    let result = repo.get_memory_by_id(user, fake_id).await;
    assert!(matches!(result, Err(MemoryError::NoGeneration)));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn memories_are_scoped_to_user(pool: Pool<Postgres>) {
    let repo = PgMemoryRepo::new(pool);
    let user_a = MacroUserIdStr::parse_from_str("macro|user-a@example.com").unwrap();
    let user_b = MacroUserIdStr::parse_from_str("macro|user-b@example.com").unwrap();

    repo.save_memory(&"user a memory".to_string(), user_a.clone())
        .await
        .unwrap();
    repo.save_memory(&"user b memory".to_string(), user_b.clone())
        .await
        .unwrap();

    let latest_a = repo.get_latest_memory(user_a).await.unwrap().unwrap();
    let latest_b = repo.get_latest_memory(user_b).await.unwrap().unwrap();

    assert_eq!(latest_a.memory, "user a memory");
    assert_eq!(latest_b.memory, "user b memory");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_latest_includes_updated_at(pool: Pool<Postgres>) {
    let repo = PgMemoryRepo::new(pool);
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    repo.save_memory(&"a memory".to_string(), user.clone())
        .await
        .unwrap();

    let record = repo.get_latest_memory(user).await.unwrap().unwrap();
    assert!(record.updated_at <= chrono::Utc::now());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_latest_uses_refresh_time_for_staleness(pool: Pool<Postgres>) {
    let repo = PgMemoryRepo::new(pool.clone());
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    repo.save_memory(&"first memory".to_string(), user.clone())
        .await
        .unwrap();

    sqlx::query!(
        r#"
        UPDATE memory
        SET created_at = NOW() - INTERVAL '10 days',
            updated_at = NOW() - INTERVAL '10 days'
        WHERE user_id = $1
        "#,
        user.as_ref()
    )
    .execute(&pool)
    .await
    .unwrap();

    repo.save_memory(&"fresh memory".to_string(), user.clone())
        .await
        .unwrap();

    let record = repo.get_latest_memory(user).await.unwrap().unwrap();
    assert_eq!(record.memory, "fresh memory");
    assert!(record.updated_at > chrono::Utc::now() - chrono::Duration::minutes(1));
}
