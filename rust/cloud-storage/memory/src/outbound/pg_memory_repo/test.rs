use super::PgMemoryRepo;
use crate::domain::{MemoryError, MemoryRepo};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Pool, Postgres};

/// Helper to insert a macro_user + User + Chat row for testing eligible users queries.
async fn insert_user_with_chat(pool: &Pool<Postgres>, user_id: &str) {
    let macro_user_uuid = macro_uuid::generate_uuid_v7();
    let email = user_id.trim_start_matches("macro|");

    // macro_user (User.macro_user_id FK)
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO NOTHING
        "#,
        macro_user_uuid,
        user_id,
        email,
        format!("cus_test_{email}"),
    )
    .execute(pool)
    .await
    .unwrap();

    // User row (Chat has FK to User.id)
    sqlx::query!(
        r#"
        INSERT INTO "User" (id, email, name, macro_user_id)
        VALUES ($1, $2, $1, $3)
        ON CONFLICT (id) DO NOTHING
        "#,
        user_id,
        email,
        macro_user_uuid,
    )
    .execute(pool)
    .await
    .unwrap();

    // Chat row
    sqlx::query!(
        r#"
        INSERT INTO "Chat" (id, "userId", name)
        VALUES ($1, $2, 'test chat')
        "#,
        macro_uuid::generate_uuid_v7().to_string(),
        user_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

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

    let latest = repo.get_latest_memory(user).await.unwrap();
    assert_eq!(latest, "second memory");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_latest_no_memories_returns_error(pool: Pool<Postgres>) {
    let repo = PgMemoryRepo::new(pool);
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    let result = repo.get_latest_memory(user).await;
    assert!(matches!(result, Err(MemoryError::NoMemory)));
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
    assert!(matches!(result, Err(MemoryError::NoMemory)));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_by_id_nonexistent_returns_error(pool: Pool<Postgres>) {
    let repo = PgMemoryRepo::new(pool);
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    let fake_id = macro_uuid::generate_uuid_v7();

    let result = repo.get_memory_by_id(user, fake_id).await;
    assert!(matches!(result, Err(MemoryError::NoMemory)));
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

    let latest_a = repo.get_latest_memory(user_a).await.unwrap();
    let latest_b = repo.get_latest_memory(user_b).await.unwrap();

    assert_eq!(latest_a, "user a memory");
    assert_eq!(latest_b, "user b memory");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn eligible_users_returns_chat_users_without_fresh_memory(pool: Pool<Postgres>) {
    let repo = PgMemoryRepo::new(pool.clone());
    let active_user = "macro|active@example.com";
    let memorized_user = "macro|memorized@example.com";

    // Both users have recent chats
    insert_user_with_chat(&pool, active_user).await;
    insert_user_with_chat(&pool, memorized_user).await;

    // memorized_user already has a fresh memory
    let memorized = MacroUserIdStr::parse_from_str(memorized_user).unwrap();
    repo.save_memory(&"existing memory".to_string(), memorized)
        .await
        .unwrap();

    let eligible = repo
        .get_eligible_users_for_memory_generation(None, 100)
        .await
        .unwrap();

    let ids: Vec<&str> = eligible.iter().map(|u| u.as_ref()).collect();
    assert!(ids.contains(&active_user));
    assert!(!ids.contains(&memorized_user));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn eligible_users_pagination(pool: Pool<Postgres>) {
    let repo = PgMemoryRepo::new(pool.clone());

    // Create 3 users with chats
    for email in ["macro|aaa@example.com", "macro|bbb@example.com", "macro|ccc@example.com"] {
        insert_user_with_chat(&pool, email).await;
    }

    // Page 1: limit 2
    let page1 = repo
        .get_eligible_users_for_memory_generation(None, 2)
        .await
        .unwrap();
    assert_eq!(page1.len(), 2);

    // Page 2: use last item as cursor
    let page2 = repo
        .get_eligible_users_for_memory_generation(page1.last(), 2)
        .await
        .unwrap();
    assert_eq!(page2.len(), 1);

    // Page 3: should be empty
    let page3 = repo
        .get_eligible_users_for_memory_generation(page2.last(), 2)
        .await
        .unwrap();
    assert!(page3.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn user_has_any_memory_true_when_exists(pool: Pool<Postgres>) {
    let repo = PgMemoryRepo::new(pool);
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    assert!(!repo.user_has_any_memory(user.clone()).await.unwrap());

    repo.save_memory(&"a memory".to_string(), user.clone())
        .await
        .unwrap();

    assert!(repo.user_has_any_memory(user).await.unwrap());
}
