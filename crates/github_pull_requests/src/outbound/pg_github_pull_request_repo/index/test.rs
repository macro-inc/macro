use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::{super::PgGithubPullRequestRepo, SOURCE_PAGE_SIZE};
use crate::domain::{
    models::{GithubPullRequestRow, GithubPullRequestWrite, PullRequestIndexOutcome},
    ports::{GithubPullRequestIndexRepository, GithubPullRequestRepository},
};

async fn insert_record(pool: &PgPool, key: &str, source: &str, metadata: Value) {
    sqlx::query!(
        r#"INSERT INTO foreign_entity (id, foreign_entity_id, foreign_entity_source, metadata,
            stored_for_id, stored_for_auth_entity)
           VALUES ($1, $2, $3, $4, 'macro|test@example.com', 'user')"#,
        Uuid::now_v7(),
        key,
        source,
        metadata,
    )
    .execute(pool)
    .await
    .unwrap();
}

fn row(key: &str, repository_id: Option<i64>) -> GithubPullRequestRow {
    let parts: Vec<_> = key.split('/').collect();
    GithubPullRequestRow::from_metadata(&json!({
        "githubKey": key, "owner": parts[0], "repo": parts[1],
        "number": parts[3].parse::<u64>().unwrap(), "repositoryId": repository_id,
        "url": format!("https://github.com/{key}"), "displayName": "PR",
        "name": "seed title", "status": "open", "draft": true,
        "labels": [{"name":"bug"}], "base": {"name":"main", "sha":"base"},
        "head": {"name":"feature", "sha":"head"}
    }))
    .unwrap()
}

async fn snapshot(pool: &PgPool) -> Vec<Value> {
    sqlx::query_scalar!(
        r#"SELECT to_jsonb(pr) AS "snapshot!: serde_json::Value"
           FROM github_pull_request pr ORDER BY github_key"#
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn candidates_retain_older_cross_source_and_case_variant_metadata(pool: PgPool) {
    for (key, source, metadata) in [
        (
            "Macro-Inc/App/pull/1",
            "github_pull_request",
            json!({"n":1}),
        ),
        (
            "macro-inc/app/pull/2",
            "github_pull_request",
            json!({"n":"rich"}),
        ),
        (
            "MACRO-INC/APP/pull/2",
            "github_pull_request",
            json!({"n":"sparse"}),
        ),
        (
            "macro-inc/app/pull/2",
            "github_pull_request",
            json!({"n":"another-source"}),
        ),
        (
            "macro-inc/app-web/pull/3",
            "github_pull_request",
            json!({"n":3}),
        ),
        ("macro-inc/app/pull/4", "linear_issue", json!({"n":4})),
    ] {
        insert_record(&pool, key, source, metadata).await;
    }
    let records = PgGithubPullRequestRepo::new(pool)
        .pull_request_index_records("macro-inc", "app")
        .await
        .unwrap();
    assert_eq!(records.len(), 4);
    assert!(records.windows(2).all(|pair| pair[0].id < pair[1].id));
    assert!(
        records
            .iter()
            .all(|record| record.source == "github_pull_request")
    );
    let mut metadata: Vec<_> = records
        .into_iter()
        .map(|record| record.metadata.to_string())
        .collect();
    metadata.sort();
    let mut expected: Vec<_> = [
        json!({"n":1}),
        json!({"n":"rich"}),
        json!({"n":"sparse"}),
        json!({"n":"another-source"}),
    ]
    .into_iter()
    .map(|value| value.to_string())
    .collect();
    expected.sort();
    assert_eq!(metadata, expected);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn repository_boundaries_and_metacharacters_match_literally(pool: PgPool) {
    for key in [
        "macro-inc/appXrepo/pull/1",
        "macro-inc/app_repo/pull/2",
        "macro-inc/app_repo-extra/pull/3",
    ] {
        insert_record(&pool, key, "github_pull_request", json!({})).await;
    }
    let records = PgGithubPullRequestRepo::new(pool)
        .pull_request_index_records("macro-inc", "app_repo")
        .await
        .unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].github_key, "macro-inc/app_repo/pull/2");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn candidate_scan_reads_past_a_sql_page_without_duplicates(pool: PgPool) {
    let ids: Vec<_> = (0..SOURCE_PAGE_SIZE + 3).map(|_| Uuid::now_v7()).collect();
    sqlx::query!(
        r#"INSERT INTO foreign_entity (id, foreign_entity_id, foreign_entity_source, metadata,
            stored_for_id, stored_for_auth_entity)
           SELECT id, 'macro/app/pull/7', 'github_pull_request', '{}'::jsonb, 'user', 'user'
           FROM unnest($1::uuid[]) AS id"#,
        &ids,
    )
    .execute(&pool)
    .await
    .unwrap();
    let records = PgGithubPullRequestRepo::new(pool)
        .pull_request_index_records("macro", "app")
        .await
        .unwrap();
    assert_eq!(records.len(), ids.len());
    assert!(records.windows(2).all(|pair| pair[0].id < pair[1].id));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn initialization_and_retries_never_rewrite_existing_columns_or_timestamps(pool: PgPool) {
    let repo = PgGithubPullRequestRepo::new(pool.clone());
    let original = row("Macro/App/pull/7", Some(99));
    assert_eq!(
        repo.initialize_indexed_row(&original).await.unwrap(),
        PullRequestIndexOutcome::Inserted
    );
    let before = snapshot(&pool).await;
    let mut stale = row("macro/app/pull/7", Some(99));
    stale.title = Some("stale title".into());
    stale.labels.clear();
    assert_eq!(
        repo.initialize_indexed_row(&stale).await.unwrap(),
        PullRequestIndexOutcome::AlreadyPresent
    );
    assert_eq!(snapshot(&pool).await, before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn conflicting_keys_unverified_rows_and_real_renames_remain_untouched(pool: PgPool) {
    let repo = PgGithubPullRequestRepo::new(pool.clone());
    let original = row("Macro/App/pull/7", Some(99));
    repo.initialize_indexed_row(&original).await.unwrap();
    let before = snapshot(&pool).await;
    for candidate in [
        row("macro/app/pull/7", Some(100)),
        row("macro/renamed/pull/7", Some(99)),
    ] {
        assert_eq!(
            repo.initialize_indexed_row(&candidate).await.unwrap(),
            PullRequestIndexOutcome::IdentityConflict
        );
        assert_eq!(snapshot(&pool).await, before);
    }
    let legacy = row("macro/app/pull/8", None);
    repo.upsert_row(&GithubPullRequestWrite::from(&legacy))
        .await
        .unwrap();
    let before = snapshot(&pool).await;
    assert_eq!(
        repo.initialize_indexed_row(&row("macro/app/pull/8", Some(99)))
            .await
            .unwrap(),
        PullRequestIndexOutcome::IdentityConflict
    );
    assert_eq!(snapshot(&pool).await, before);
    assert!(
        repo.initialize_indexed_row(&row("macro/app/pull/9", None))
            .await
            .is_err()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn initialization_winning_after_empty_rename_lookup_allows_case_only_live_update(
    pool: PgPool,
) {
    let repo = PgGithubPullRequestRepo::new(pool.clone());
    assert_eq!(repo.github_key_for(99, 7).await.unwrap(), None);
    repo.initialize_indexed_row(&row("Macro/App/pull/7", Some(99)))
        .await
        .unwrap();
    let mut update = GithubPullRequestWrite::from_metadata(&json!({
        "githubKey":"macro/app/pull/7", "owner":"macro", "repo":"app", "number":7,
        "repositoryId":99, "url":"https://github.com/macro/app/pull/7", "displayName":"PR",
        "status":"closed", "name":"live title"
    }))
    .unwrap();
    repo.upsert_row(&update).await.unwrap();
    let stored = repo
        .pull_request_row("Macro/App/pull/7")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.title.as_deref(), Some("live title"));
    assert_eq!(stored.github_key, "Macro/App/pull/7");
    assert_eq!(stored.labels.len(), 1);
    assert_eq!(snapshot(&pool).await.len(), 1);
    let before = snapshot(&pool).await;
    update.repository_id = Some(100);
    assert!(repo.upsert_row(&update).await.is_err());
    update.github_key = "Macro/App/pull/7".into();
    assert!(repo.upsert_row(&update).await.is_err());
    update.repository_id = Some(99);
    update.github_key = "macro/renamed/pull/7".into();
    update.repo = "renamed".into();
    assert!(repo.upsert_row(&update).await.is_err());
    assert_eq!(snapshot(&pool).await, before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn live_first_initialization_preserves_live_values_and_timestamps(pool: PgPool) {
    let repo = PgGithubPullRequestRepo::new(pool.clone());
    let mut live = row("macro/app/pull/7", Some(99));
    live.title = Some("live title".into());
    repo.upsert_row(&GithubPullRequestWrite::from(&live))
        .await
        .unwrap();
    let before = snapshot(&pool).await;
    assert_eq!(
        repo.initialize_indexed_row(&row("Macro/App/pull/7", Some(99)))
            .await
            .unwrap(),
        PullRequestIndexOutcome::AlreadyPresent
    );
    assert_eq!(snapshot(&pool).await, before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn normalized_lock_serializes_initialization_and_live_updates(pool: PgPool) {
    use std::time::Duration;
    let repo = PgGithubPullRequestRepo::new(pool.clone());
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query!(
        "SELECT pg_advisory_xact_lock(hashtextextended(lower($1), 0))",
        "macro/app/pull/7"
    )
    .execute(&mut *blocker)
    .await
    .unwrap();
    let initialize_repo = repo.clone();
    let mut initialize = tokio::spawn(async move {
        initialize_repo
            .initialize_indexed_row(&row("Macro/App/pull/7", Some(99)))
            .await
    });
    assert!(
        tokio::time::timeout(Duration::from_millis(100), &mut initialize)
            .await
            .is_err()
    );
    let mut live_row = row("macro/app/pull/7", Some(99));
    live_row.title = Some("live title".into());
    let update_repo = repo.clone();
    let mut update = tokio::spawn(async move {
        update_repo
            .upsert_row(&GithubPullRequestWrite::from(&live_row))
            .await
    });
    assert!(
        tokio::time::timeout(Duration::from_millis(100), &mut update)
            .await
            .is_err()
    );
    blocker.commit().await.unwrap();
    initialize.await.unwrap().unwrap();
    update.await.unwrap().unwrap();
    assert_eq!(snapshot(&pool).await.len(), 1);
    let key = repo.github_key_for(99, 7).await.unwrap().unwrap();
    assert_eq!(
        repo.pull_request_row(&key)
            .await
            .unwrap()
            .unwrap()
            .title
            .as_deref(),
        Some("live title")
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn simultaneous_case_variant_initializations_insert_once(pool: PgPool) {
    let repo = PgGithubPullRequestRepo::new(pool.clone());
    let other = repo.clone();
    let first = row("Macro/App/pull/7", Some(99));
    let second = row("macro/app/pull/7", Some(99));
    let (left, right) = tokio::join!(
        repo.initialize_indexed_row(&first),
        other.initialize_indexed_row(&second)
    );
    let outcomes = [left.unwrap(), right.unwrap()];
    assert_eq!(
        outcomes
            .iter()
            .filter(|outcome| **outcome == PullRequestIndexOutcome::Inserted)
            .count(),
        1
    );
    assert_eq!(
        outcomes
            .iter()
            .filter(|outcome| **outcome == PullRequestIndexOutcome::AlreadyPresent)
            .count(),
        1
    );
    assert_eq!(snapshot(&pool).await.len(), 1);
}
