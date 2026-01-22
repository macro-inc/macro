use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::Pool;

use super::get_names_for_ids;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("users"))
)]
async fn test_get_single_user_name(pool: Pool<sqlx::Postgres>) {
    let ids = vec![MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap()];

    let names = get_names_for_ids(&pool, &ids).await.unwrap();

    assert_eq!(names.len(), 1);
    assert_eq!(names[0].id.as_ref(), "macro|user1@test.com");
    assert_eq!(names[0].first_name.as_deref(), Some("John"));
    assert_eq!(names[0].last_name.as_deref(), Some("Doe"));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("users"))
)]
async fn test_get_multiple_user_names(pool: Pool<sqlx::Postgres>) {
    let ids = vec![
        MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap(),
        MacroUserIdStr::parse_from_str("macro|user2@test.com").unwrap(),
        MacroUserIdStr::parse_from_str("macro|user3@test.com").unwrap(),
    ];

    let names = get_names_for_ids(&pool, &ids).await.unwrap();

    assert_eq!(names.len(), 3);

    // Find each user in the results (order not guaranteed)
    let user1 = names
        .iter()
        .find(|n| n.id.as_ref() == "macro|user1@test.com")
        .expect("user1 should be present");
    assert_eq!(user1.first_name.as_deref(), Some("John"));
    assert_eq!(user1.last_name.as_deref(), Some("Doe"));

    let user2 = names
        .iter()
        .find(|n| n.id.as_ref() == "macro|user2@test.com")
        .expect("user2 should be present");
    assert_eq!(user2.first_name, None);
    assert_eq!(user2.last_name, None);

    let user3 = names
        .iter()
        .find(|n| n.id.as_ref() == "macro|user3@test.com")
        .expect("user3 should be present");
    assert_eq!(user3.first_name.as_deref(), Some("Jane"));
    assert_eq!(user3.last_name.as_deref(), Some("Smith"));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("users"))
)]
async fn test_get_user_names_with_nonexistent_ids(pool: Pool<sqlx::Postgres>) {
    let ids = vec![
        MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap(),
        MacroUserIdStr::parse_from_str("macro|nonexistent@test.com").unwrap(),
    ];

    let names = get_names_for_ids(&pool, &ids).await.unwrap();

    // Should only return the one that exists
    assert_eq!(names.len(), 1);
    assert_eq!(names[0].id.as_ref(), "macro|user1@test.com");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("users"))
)]
async fn test_get_user_names_empty_input(pool: Pool<sqlx::Postgres>) {
    let ids: Vec<MacroUserIdStr<'_>> = vec![];

    let names = get_names_for_ids(&pool, &ids).await.unwrap();

    assert!(names.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("users"))
)]
async fn test_get_user_names_all_nonexistent(pool: Pool<sqlx::Postgres>) {
    let ids = vec![
        MacroUserIdStr::parse_from_str("macro|fake1@test.com").unwrap(),
        MacroUserIdStr::parse_from_str("macro|fake2@test.com").unwrap(),
    ];

    let names = get_names_for_ids(&pool, &ids).await.unwrap();

    assert!(names.is_empty());
}
