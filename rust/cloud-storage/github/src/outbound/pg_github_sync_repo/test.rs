use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::domain::models::{GithubKey, MacroTaskId};
use crate::domain::ports::GithubSyncRepo;
use crate::outbound::pg_github_sync_repo::PgGithubSyncRepo;

// ---------------------------------------------------------------------------
// get_task_ids
// ---------------------------------------------------------------------------

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_sync_test_data"))
)]
async fn test_get_task_ids(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let key = GithubKey::new("my-org", "my-repo", 1);
    let task_ids = repo.get_task_ids(key).await.unwrap();

    assert_eq!(task_ids.len(), 2);
    let shorts: Vec<&str> = task_ids.iter().map(|t| t.short_uuid.as_str()).collect();
    assert!(shorts.contains(&"s61deeZUHehUjkNT8rxB3S"));
    assert!(shorts.contains(&"bMv3eymKvu18qsQyrpt1VH"));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_sync_test_data"))
)]
async fn test_get_task_ids_different_pr(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let key = GithubKey::new("my-org", "other-repo", 42);
    let task_ids = repo.get_task_ids(key).await.unwrap();

    assert_eq!(task_ids.len(), 1);
    assert_eq!(task_ids[0].short_uuid, "xdyzHm2ZVGr6UAkaeBCUxZ");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_get_task_ids_empty(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let key = GithubKey::new("no-org", "no-repo", 999);
    let task_ids = repo.get_task_ids(key).await.unwrap();

    assert!(task_ids.is_empty());
}

// ---------------------------------------------------------------------------
// upsert_task_ids
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_upsert_task_ids_inserts_new(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let key = GithubKey::new("org", "repo", 10);
    let tasks = vec![
        MacroTaskId::from_short_uuid("xoyQ8nrV6PNZFmpsWYMdyC").unwrap(),
        MacroTaskId::from_short_uuid("2ZbZ7wJQfEMWyBSycKYTYr").unwrap(),
    ];

    repo.upsert_task_ids(key.clone(), &tasks).await.unwrap();

    let fetched = repo.get_task_ids(key).await.unwrap();
    assert_eq!(fetched.len(), 2);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_sync_test_data"))
)]
async fn test_upsert_task_ids_ignores_duplicates(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let key = GithubKey::new("my-org", "my-repo", 1);
    let tasks = vec![
        MacroTaskId::from_short_uuid("s61deeZUHehUjkNT8rxB3S").unwrap(), // already exists
        MacroTaskId::from_short_uuid("xoyQ8nrV6PNZFmpsWYMdyC").unwrap(),
    ];

    repo.upsert_task_ids(key.clone(), &tasks).await.unwrap();

    let fetched = repo.get_task_ids(key).await.unwrap();
    assert_eq!(fetched.len(), 3); // s61dee.., bMv3e.. (existing) + xoyQ8..
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_upsert_task_ids_empty_list(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let key = GithubKey::new("org", "repo", 1);
    repo.upsert_task_ids(key.clone(), &[]).await.unwrap();

    let fetched = repo.get_task_ids(key).await.unwrap();
    assert!(fetched.is_empty());
}

// ---------------------------------------------------------------------------
// filter_duplicate_tasks
// ---------------------------------------------------------------------------

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_sync_test_data"))
)]
async fn test_filter_duplicate_tasks_removes_existing(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let key = GithubKey::new("my-org", "my-repo", 1);
    let candidates = vec![
        MacroTaskId::from_short_uuid("s61deeZUHehUjkNT8rxB3S").unwrap(), // exists
        MacroTaskId::from_short_uuid("bMv3eymKvu18qsQyrpt1VH").unwrap(), // exists
        MacroTaskId::from_short_uuid("xoyQ8nrV6PNZFmpsWYMdyC").unwrap(),
    ];

    let new_only = repo.filter_duplicate_tasks(key, &candidates).await.unwrap();

    assert_eq!(new_only.len(), 1);
    assert_eq!(new_only[0].short_uuid, "xoyQ8nrV6PNZFmpsWYMdyC");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_sync_test_data"))
)]
async fn test_filter_duplicate_tasks_all_new(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let key = GithubKey::new("my-org", "my-repo", 1);
    let candidates = vec![
        MacroTaskId::from_short_uuid("xoyQ8nrV6PNZFmpsWYMdyC").unwrap(),
        MacroTaskId::from_short_uuid("2ZbZ7wJQfEMWyBSycKYTYr").unwrap(),
    ];

    let new_only = repo.filter_duplicate_tasks(key, &candidates).await.unwrap();

    assert_eq!(new_only.len(), 2);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_sync_test_data"))
)]
async fn test_filter_duplicate_tasks_all_existing(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let key = GithubKey::new("my-org", "my-repo", 1);
    let candidates = vec![
        MacroTaskId::from_short_uuid("s61deeZUHehUjkNT8rxB3S").unwrap(),
        MacroTaskId::from_short_uuid("bMv3eymKvu18qsQyrpt1VH").unwrap(),
    ];

    let new_only = repo.filter_duplicate_tasks(key, &candidates).await.unwrap();

    assert!(new_only.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_filter_duplicate_tasks_empty_input(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let key = GithubKey::new("org", "repo", 1);
    let new_only = repo.filter_duplicate_tasks(key, &[]).await.unwrap();

    assert!(new_only.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_sync_test_data"))
)]
async fn test_filter_duplicate_tasks_different_key_not_filtered(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    // s61dee.. exists for my-org/my-repo/pull/1, but not for this key
    let key = GithubKey::new("my-org", "other-repo", 42);
    let candidates = vec![MacroTaskId::from_short_uuid("s61deeZUHehUjkNT8rxB3S").unwrap()];

    let new_only = repo.filter_duplicate_tasks(key, &candidates).await.unwrap();

    assert_eq!(new_only.len(), 1);
    assert_eq!(new_only[0].short_uuid, "s61deeZUHehUjkNT8rxB3S");
}

// ---------------------------------------------------------------------------
// get_macro_id_by_github_user_id
// ---------------------------------------------------------------------------

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_installation_test_data"))
)]
async fn test_get_macro_id_by_github_user_id_found(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let macro_id = repo.get_macro_id_by_github_user_id("12345").await.unwrap();

    assert_eq!(macro_id.as_deref(), Some("macro|user@user.com"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_get_macro_id_by_github_user_id_not_found(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let macro_id = repo.get_macro_id_by_github_user_id("99999").await.unwrap();

    assert!(macro_id.is_none());
}

// ---------------------------------------------------------------------------
// get_user_team_ids
// ---------------------------------------------------------------------------

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_installation_test_data"))
)]
async fn test_get_user_team_ids(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let team_ids = repo.get_user_team_ids("macro|user@user.com").await.unwrap();
    assert_eq!(team_ids.len(), 1);
    assert_eq!(
        team_ids[0],
        "dddddddd-dddd-dddd-dddd-dddddddddddd"
            .parse::<Uuid>()
            .unwrap()
    );

    let team_ids2 = repo
        .get_user_team_ids("macro|user2@user.com")
        .await
        .unwrap();
    assert_eq!(team_ids2.len(), 1);
    assert_eq!(
        team_ids2[0],
        "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
            .parse::<Uuid>()
            .unwrap()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_get_user_team_ids_no_teams(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let team_ids = repo
        .get_user_team_ids("macro|nobody@test.com")
        .await
        .unwrap();

    assert!(team_ids.is_empty());
}

// ---------------------------------------------------------------------------
// insert_installation_team_associations
// ---------------------------------------------------------------------------

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_installation_test_data"))
)]
async fn test_insert_installation_team_associations(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool.clone());

    let team_ids: Vec<Uuid> = vec![
        "dddddddd-dddd-dddd-dddd-dddddddddddd".parse().unwrap(),
        "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee".parse().unwrap(),
    ];

    repo.insert_installation_team_associations("123456", &team_ids, "macro|user@user.com")
        .await
        .unwrap();

    let rows: Vec<(String, Uuid)> =
        sqlx::query_as("SELECT id, team_id FROM github_app_installation_team ORDER BY team_id")
            .fetch_all(&pool)
            .await
            .unwrap();

    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|r| r.0 == "123456"));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_installation_test_data"))
)]
async fn test_insert_installation_team_associations_idempotent(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool.clone());

    let team_ids: Vec<Uuid> = vec!["dddddddd-dddd-dddd-dddd-dddddddddddd".parse().unwrap()];

    repo.insert_installation_team_associations("123456", &team_ids, "macro|user@user.com")
        .await
        .unwrap();
    // Insert again — should not error
    repo.insert_installation_team_associations("123456", &team_ids, "macro|user@user.com")
        .await
        .unwrap();

    let count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM github_app_installation_team WHERE id = '123456'")
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(count.0, 1);
}
