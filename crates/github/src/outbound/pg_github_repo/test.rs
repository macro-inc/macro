use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::{Pool, Postgres};

use crate::domain::models::GithubLink;
use crate::domain::ports::GithubRepo;
use crate::outbound::pg_github_repo::PgGithubRepo;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_test_data"))
)]
async fn test_get_github_link_by_user_id(pool: Pool<Postgres>) {
    let repo = PgGithubRepo::new(pool);

    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com")
        .unwrap()
        .into_owned();
    let link = repo.get_github_link_by_user_id(&user_id.0).await.unwrap();

    assert_eq!(link.macro_id.as_ref(), "macro|user@user.com");
    assert_eq!(link.github_username, "testuser");
    assert_eq!(link.github_user_id, "12345");
    assert_eq!(
        link.fusionauth_user_id.to_string(),
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_test_data"))
)]
async fn test_get_github_link_by_user_id_not_found(pool: Pool<Postgres>) {
    let repo = PgGithubRepo::new(pool);

    let user_id = MacroUserIdStr::parse_from_str("macro|nonexistent@user.com")
        .unwrap()
        .into_owned();
    let result = repo.get_github_link_by_user_id(&user_id.0).await;

    assert!(matches!(result, Err(sqlx::Error::RowNotFound)));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_test_data"))
)]
async fn test_get_github_link_by_github_user_id(pool: Pool<Postgres>) {
    let repo = PgGithubRepo::new(pool);

    let link = repo
        .get_github_link_by_github_user_id("12345")
        .await
        .unwrap();

    assert_eq!(link.macro_id.as_ref(), "macro|user@user.com");
    assert_eq!(link.github_username, "testuser");
    assert_eq!(link.github_user_id, "12345");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_test_data"))
)]
async fn test_get_github_link_by_github_user_id_not_found(pool: Pool<Postgres>) {
    let repo = PgGithubRepo::new(pool);

    let result = repo.get_github_link_by_github_user_id("99999").await;

    assert!(matches!(result, Err(sqlx::Error::RowNotFound)));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_test_data"))
)]
async fn test_get_github_link_by_id(pool: Pool<Postgres>) {
    let repo = PgGithubRepo::new(pool);

    let id = uuid::Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap();
    let link = repo.get_github_link_by_id(&id).await.unwrap();

    assert_eq!(link.macro_id.as_ref(), "macro|user@user.com");
    assert_eq!(link.github_username, "testuser");
    assert_eq!(link.github_user_id, "12345");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_test_data"))
)]
async fn test_get_github_link_by_id_not_found(pool: Pool<Postgres>) {
    let repo = PgGithubRepo::new(pool);

    let id = uuid::Uuid::parse_str("dddddddd-dddd-dddd-dddd-dddddddddddd").unwrap();
    let result = repo.get_github_link_by_id(&id).await;

    assert!(matches!(result, Err(sqlx::Error::RowNotFound)));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_insert_test_data"))
)]
async fn test_insert_github_link(pool: Pool<Postgres>) {
    let repo = PgGithubRepo::new(pool.clone());

    let now = chrono::Utc::now();
    let link = GithubLink {
        id: uuid::Uuid::parse_str("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee").unwrap(),
        macro_id: MacroUserIdStr::parse_from_str("macro|new@user.com")
            .unwrap()
            .into_owned(),
        fusionauth_user_id: uuid::Uuid::parse_str("ffffffff-ffff-ffff-ffff-ffffffffffff").unwrap(),
        github_username: "newuser".to_string(),
        github_user_id: "67890".to_string(),
        created_at: now,
        updated_at: now,
    };

    repo.insert_github_link(&link).await.unwrap();

    // Verify it was inserted by reading it back
    let fetched = repo.get_github_link_by_id(&link.id).await.unwrap();
    assert_eq!(fetched.macro_id.as_ref(), "macro|new@user.com");
    assert_eq!(fetched.github_username, "newuser");
    assert_eq!(fetched.github_user_id, "67890");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_test_data"))
)]
async fn test_insert_github_link_shared_github_user_id_succeeds(pool: Pool<Postgres>) {
    let repo = PgGithubRepo::new(pool);

    let now = chrono::Utc::now();
    let id = uuid::Uuid::new_v4();
    let link = GithubLink {
        id,
        // Different macro user than the fixture owner of github_user_id 12345.
        macro_id: MacroUserIdStr::parse_from_str("macro|sharer@user.com")
            .unwrap()
            .into_owned(),
        fusionauth_user_id: uuid::Uuid::new_v4(),
        github_username: "shareruser".to_string(),
        github_user_id: "12345".to_string(), // same github account as fixture
        created_at: now,
        updated_at: now,
    };

    // A different macro user may now link the same github_user_id, since the
    // unique constraint is on (macro_id, github_user_id) rather than github_user_id.
    let result = repo.insert_github_link(&link).await;
    assert!(result.is_ok());

    // Confirm the row was actually persisted.
    let fetched = repo.get_github_link_by_id(&id).await.unwrap();
    assert_eq!(fetched.macro_id.as_ref(), "macro|sharer@user.com");
    assert_eq!(fetched.github_user_id, "12345");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_test_data"))
)]
async fn test_insert_github_link_duplicate_macro_and_github_user_id_fails(pool: Pool<Postgres>) {
    let repo = PgGithubRepo::new(pool);

    let now = chrono::Utc::now();
    let link = GithubLink {
        id: uuid::Uuid::new_v4(),
        // Existing fixture user who already owns github_user_id 12345.
        macro_id: MacroUserIdStr::parse_from_str("macro|user@user.com")
            .unwrap()
            .into_owned(),
        fusionauth_user_id: uuid::Uuid::new_v4(),
        github_username: "testuser".to_string(),
        github_user_id: "12345".to_string(), // same (macro_id, github_user_id) as fixture
        created_at: now,
        updated_at: now,
    };

    // Re-using the same (macro_id, github_user_id) pair must violate the
    // composite unique constraint.
    let result = repo.insert_github_link(&link).await;
    assert!(result.is_err());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_test_data"))
)]
async fn test_get_github_link_by_github_user_id_returns_owner(pool: Pool<Postgres>) {
    let repo = PgGithubRepo::new(pool);

    // Insert a second link for github_user_id 12345 belonging to a different
    // macro user, with a created_at strictly later than the fixture row
    // (aaaa..., default/earlier timestamp) so the owner is unambiguous.
    let later = chrono::Utc::now() + chrono::Duration::days(1);
    let sharer_link = GithubLink {
        id: uuid::Uuid::new_v4(),
        macro_id: MacroUserIdStr::parse_from_str("macro|sharer@user.com")
            .unwrap()
            .into_owned(),
        fusionauth_user_id: uuid::Uuid::new_v4(),
        github_username: "shareruser".to_string(),
        github_user_id: "12345".to_string(),
        created_at: later,
        updated_at: later,
    };
    repo.insert_github_link(&sharer_link).await.unwrap();

    // The owner is the earliest-created row (the fixture row), not the sharer.
    let link = repo
        .get_github_link_by_github_user_id("12345")
        .await
        .unwrap();

    assert_eq!(link.macro_id.as_ref(), "macro|user@user.com");
    assert_eq!(link.github_username, "testuser");
    assert_eq!(link.github_user_id, "12345");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_test_data"))
)]
async fn test_count_github_links_by_github_user_id(pool: Pool<Postgres>) {
    let repo = PgGithubRepo::new(pool);

    // The fixture has a single row for github_user_id 12345.
    let count = repo
        .count_github_links_by_github_user_id("12345")
        .await
        .unwrap();
    assert_eq!(count, 1);

    // Add a second link for the same github account under a different macro user.
    let now = chrono::Utc::now();
    let sharer_link = GithubLink {
        id: uuid::Uuid::new_v4(),
        macro_id: MacroUserIdStr::parse_from_str("macro|sharer@user.com")
            .unwrap()
            .into_owned(),
        fusionauth_user_id: uuid::Uuid::new_v4(),
        github_username: "shareruser".to_string(),
        github_user_id: "12345".to_string(),
        created_at: now,
        updated_at: now,
    };
    repo.insert_github_link(&sharer_link).await.unwrap();

    let count = repo
        .count_github_links_by_github_user_id("12345")
        .await
        .unwrap();
    assert_eq!(count, 2);

    // An absent github_user_id has no links.
    let count = repo
        .count_github_links_by_github_user_id("99999")
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_test_data"))
)]
async fn test_delete_in_progress_user_link(pool: Pool<Postgres>) {
    let repo = PgGithubRepo::new(pool.clone());

    let id = uuid::Uuid::parse_str("cccccccc-cccc-cccc-cccc-cccccccccccc").unwrap();

    repo.delete_in_progress_user_link(&id).await.unwrap();

    // Verify it was deleted
    let row = sqlx::query!("SELECT id FROM in_progress_user_link WHERE id = $1", id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(row.is_none());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_test_data"))
)]
async fn test_delete_github_link(pool: Pool<Postgres>) {
    let repo = PgGithubRepo::new(pool.clone());

    let id = uuid::Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap();

    repo.delete_github_link(&id).await.unwrap();

    // Verify it was deleted
    let row = sqlx::query!("SELECT id FROM github_links WHERE id = $1", id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(row.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_delete_in_progress_user_link_nonexistent(pool: Pool<Postgres>) {
    let repo = PgGithubRepo::new(pool);

    let id = uuid::Uuid::parse_str("dddddddd-dddd-dddd-dddd-dddddddddddd").unwrap();

    // Deleting a nonexistent row should not error (DELETE affects 0 rows)
    repo.delete_in_progress_user_link(&id).await.unwrap();
}
