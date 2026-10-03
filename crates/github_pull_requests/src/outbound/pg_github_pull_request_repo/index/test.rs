use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::{Value, json};
use sqlx::PgPool;

use super::super::PgGithubPullRequestRepo;
use crate::domain::ports::GithubPullRequestIndexRepository;

async fn insert_record(
    pool: &PgPool,
    key: &str,
    source: &str,
    stored_for_id: &str,
    metadata: Value,
    minutes_ago: i32,
) {
    sqlx::query(
        r#"
        INSERT INTO foreign_entity (
            id, foreign_entity_id, foreign_entity_source, metadata, stored_for_id,
            stored_for_auth_entity, updated_at
        )
        VALUES (gen_random_uuid(), $1, $2, $3, $4, 'user', NOW() - make_interval(mins => $5::int))
        "#,
    )
    .bind(key)
    .bind(source)
    .bind(metadata)
    .bind(stored_for_id)
    .bind(minutes_ago)
    .execute(pool)
    .await
    .expect("record should be inserted");
}

fn sorted(mut metadata: Vec<Value>) -> Vec<Value> {
    metadata.sort_by_key(|value| value.to_string());
    metadata
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn latest_metadata_covers_each_pull_request_in_the_repository_once(pool: PgPool) {
    let user = "macro|user@example.com";
    let team = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    insert_record(
        &pool,
        "Macro-Inc/App/pull/1",
        "github_pull_request",
        user,
        json!({ "n": 1 }),
        0,
    )
    .await;
    insert_record(
        &pool,
        "macro-inc/app/pull/2",
        "github_pull_request",
        user,
        json!({ "n": "older" }),
        10,
    )
    .await;
    insert_record(
        &pool,
        "macro-inc/app/pull/2",
        "github_pull_request",
        team,
        json!({ "n": "newer" }),
        1,
    )
    .await;
    insert_record(
        &pool,
        "macro-inc/app-web/pull/3",
        "github_pull_request",
        user,
        json!({ "n": 3 }),
        0,
    )
    .await;
    insert_record(
        &pool,
        "macro-inc/app/pull/4",
        "linear_issue",
        user,
        json!({ "n": 4 }),
        0,
    )
    .await;

    let metadata = PgGithubPullRequestRepo::new(pool)
        .latest_pull_request_metadata("macro-inc", "app")
        .await
        .expect("records should load");

    assert_eq!(
        sorted(metadata),
        sorted(vec![json!({ "n": 1 }), json!({ "n": "newer" })])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn repository_names_match_literally(pool: PgPool) {
    let user = "macro|user@example.com";
    insert_record(
        &pool,
        "macro-inc/appXrepo/pull/1",
        "github_pull_request",
        user,
        json!({ "n": 1 }),
        0,
    )
    .await;
    insert_record(
        &pool,
        "macro-inc/app_repo/pull/2",
        "github_pull_request",
        user,
        json!({ "n": 2 }),
        0,
    )
    .await;

    let metadata = PgGithubPullRequestRepo::new(pool)
        .latest_pull_request_metadata("macro-inc", "app_repo")
        .await
        .expect("records should load");

    assert_eq!(metadata, vec![json!({ "n": 2 })]);
}
