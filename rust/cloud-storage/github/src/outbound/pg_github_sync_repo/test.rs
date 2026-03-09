use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

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
