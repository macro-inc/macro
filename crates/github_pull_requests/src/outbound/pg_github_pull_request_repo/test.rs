use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::PgGithubPullRequestRepo;
use crate::domain::{
    models::{GithubPullRequestRow, GithubPullRequestStatus},
    ports::GithubPullRequestRepository,
};

async fn stored_row(
    pool: &PgPool,
    github_key: &str,
) -> Option<(Option<i64>, String, Option<String>)> {
    sqlx::query_as(
        r#"
        SELECT repository_id, repo, status
        FROM github_pull_request
        WHERE github_key = $1
        "#,
    )
    .bind(github_key)
    .fetch_optional(pool)
    .await
    .expect("row lookup should succeed")
}

fn row(github_key: &str, repository_id: Option<i64>) -> GithubPullRequestRow {
    GithubPullRequestRow {
        github_key: github_key.to_string(),
        repository_id,
        number: 7,
        owner: "macro".to_string(),
        repo: "app".to_string(),
        title: Some("Add pull request storage".to_string()),
        status: Some(GithubPullRequestStatus::Open),
        draft: false,
        author_github_user_id: Some("42".to_string()),
        author_login: Some("octocat".to_string()),
        requested_reviewer_github_user_ids: vec!["8".to_string()],
        participant_github_user_ids: vec!["8".to_string(), "42".to_string()],
        github_updated_at: None,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn upsert_stores_a_row_found_by_repository_and_number(pool: PgPool) {
    let repo = PgGithubPullRequestRepo::new(pool.clone());

    repo.upsert_row(&row("macro/app/pull/7", Some(99)))
        .await
        .expect("upsert should succeed");

    assert_eq!(
        repo.github_key_for(99, 7).await.unwrap(),
        Some("macro/app/pull/7".to_string())
    );
    assert_eq!(repo.github_key_for(99, 8).await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn upsert_without_a_repository_id_keeps_the_one_the_row_has(pool: PgPool) {
    let repo = PgGithubPullRequestRepo::new(pool.clone());

    repo.upsert_row(&row("macro/app/pull/7", None))
        .await
        .expect("upsert should succeed");
    assert_eq!(
        stored_row(&pool, "macro/app/pull/7").await,
        Some((None, "app".to_string(), Some("open".to_string())))
    );

    repo.upsert_row(&row("macro/app/pull/7", Some(99)))
        .await
        .expect("upsert should succeed");
    repo.upsert_row(&GithubPullRequestRow {
        status: Some(GithubPullRequestStatus::Merged),
        ..row("macro/app/pull/7", None)
    })
    .await
    .expect("upsert should succeed");

    assert_eq!(
        stored_row(&pool, "macro/app/pull/7").await,
        Some((Some(99), "app".to_string(), Some("merged".to_string())))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rename_moves_the_row_or_drops_it_when_the_new_key_has_one(pool: PgPool) {
    let repo = PgGithubPullRequestRepo::new(pool.clone());
    repo.upsert_row(&row("macro/app/pull/7", Some(99)))
        .await
        .unwrap();

    repo.rename_row("macro/app/pull/7", "macro/renamed/pull/7")
        .await
        .expect("rename should succeed");
    assert_eq!(stored_row(&pool, "macro/app/pull/7").await, None);
    assert_eq!(
        repo.github_key_for(99, 7).await.unwrap(),
        Some("macro/renamed/pull/7".to_string())
    );

    repo.upsert_row(&GithubPullRequestRow {
        number: 8,
        ..row("macro/app/pull/8", Some(99))
    })
    .await
    .unwrap();
    repo.upsert_row(&GithubPullRequestRow {
        number: 9,
        ..row("macro/renamed/pull/8", None)
    })
    .await
    .unwrap();
    repo.rename_row("macro/app/pull/8", "macro/renamed/pull/8")
        .await
        .expect("rename onto an existing row should succeed");

    assert_eq!(stored_row(&pool, "macro/app/pull/8").await, None);
    assert!(stored_row(&pool, "macro/renamed/pull/8").await.is_some());
}
