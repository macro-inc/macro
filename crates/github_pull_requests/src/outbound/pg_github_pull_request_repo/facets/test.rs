use foreign_entity::{
    domain::{
        models::{CreateForeignEntity, SourceId},
        ports::ForeignEntityRepository,
    },
    outbound::pg_foreign_entity_repo::PgForeignEntityRepo,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use super::super::PgGithubPullRequestRepo;
use crate::domain::{
    models::{
        GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE, GithubLabelFacet, GithubPullRequestFacets,
        GithubPullRequestLabel, GithubPullRequestRow, GithubPullRequestStatus,
        GithubPullRequestUser, GithubRepositoryFacet, GithubUserFacet,
    },
    ports::{GithubPullRequestFacetRepository, GithubPullRequestRepository},
};

const USER: &str = "macro|user@example.com";
const TEAM: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

async fn store_for(pool: &PgPool, github_key: &str, stored_for_id: &str, auth_entity: &str) {
    PgForeignEntityRepo::new(pool.clone())
        .create_foreign_entity(
            Uuid::now_v7(),
            CreateForeignEntity {
                foreign_entity_id: github_key.to_string(),
                foreign_entity_source: GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE.to_string(),
                metadata: json!({}),
                stored_for_id: stored_for_id.to_string(),
                stored_for_auth_entity: auth_entity.to_string(),
            },
        )
        .await
        .expect("record should be stored");
}

fn row(github_key: &str, repository_id: Option<i64>, number: i64) -> GithubPullRequestRow {
    GithubPullRequestRow {
        github_key: github_key.to_string(),
        repository_id,
        number,
        owner: "macro".to_string(),
        repo: "app".to_string(),
        title: None,
        status: Some(GithubPullRequestStatus::Open),
        draft: false,
        author_github_user_id: Some("42".to_string()),
        author_login: Some("octocat".to_string()),
        requested_reviewer_github_user_ids: Vec::new(),
        participant_github_user_ids: Vec::new(),
        github_updated_at: None,
        assignees: Vec::new(),
        labels: Vec::new(),
        reviews: Vec::new(),
        review_decision: None,
        base: None,
        head: None,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn facets_count_each_visible_pull_request_once_by_repository_and_author(pool: PgPool) {
    let repo = PgGithubPullRequestRepo::new(pool.clone());

    store_for(&pool, "macro/app/pull/7", USER, "user").await;
    store_for(&pool, "macro/app/pull/7", TEAM, "team").await;
    repo.upsert_row(&(&row("macro/app/pull/7", Some(99), 7)).into())
        .await
        .unwrap();

    store_for(&pool, "macro/renamed/pull/8", TEAM, "team").await;
    repo.upsert_row(
        &(&GithubPullRequestRow {
            repo: "renamed".to_string(),
            author_github_user_id: Some("7".to_string()),
            author_login: None,
            github_updated_at: Some(chrono::Utc::now()),
            ..row("macro/renamed/pull/8", Some(99), 8)
        })
            .into(),
    )
    .await
    .unwrap();

    store_for(&pool, "macro/app/pull/9", USER, "user").await;
    repo.upsert_row(
        &(&GithubPullRequestRow {
            author_github_user_id: None,
            author_login: None,
            ..row("macro/app/pull/9", None, 9)
        })
            .into(),
    )
    .await
    .unwrap();

    store_for(
        &pool,
        "macro/other/pull/1",
        "macro|other@example.com",
        "user",
    )
    .await;
    repo.upsert_row(&(&row("macro/other/pull/1", Some(100), 1)).into())
        .await
        .unwrap();

    let facets = repo
        .github_pull_request_facets(vec![SourceId::user(USER), SourceId::new(TEAM, "team")])
        .await
        .expect("facets should load");

    assert_eq!(
        facets,
        GithubPullRequestFacets {
            repositories: vec![GithubRepositoryFacet {
                repository_id: "99".to_string(),
                repository: "macro/renamed".to_string(),
                count: 2,
            }],
            authors: vec![
                GithubUserFacet {
                    github_user_id: "42".to_string(),
                    login: Some("octocat".to_string()),
                    count: 1,
                },
                GithubUserFacet {
                    github_user_id: "7".to_string(),
                    login: None,
                    count: 1,
                },
            ],
            assignees: Vec::new(),
            labels: Vec::new(),
        }
    );
}

fn assignee(github_user_id: &str, login: &str) -> GithubPullRequestUser {
    GithubPullRequestUser {
        github_user_id: github_user_id.to_string(),
        login: Some(login.to_string()),
    }
}

fn label(name: &str, color: &str) -> GithubPullRequestLabel {
    GithubPullRequestLabel {
        name: name.to_string(),
        color: Some(color.to_string()),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn facets_count_assignees_and_labels_once_per_visible_pull_request(pool: PgPool) {
    let repo = PgGithubPullRequestRepo::new(pool.clone());

    store_for(&pool, "macro/app/pull/7", USER, "user").await;
    store_for(&pool, "macro/app/pull/7", TEAM, "team").await;
    repo.upsert_row(
        &(&GithubPullRequestRow {
            assignees: vec![assignee("42", "octocat"), assignee("7", "hubot")],
            labels: vec![label("bug", "000000")],
            ..row("macro/app/pull/7", Some(99), 7)
        })
            .into(),
    )
    .await
    .unwrap();

    store_for(&pool, "macro/app/pull/8", USER, "user").await;
    repo.upsert_row(
        &(&GithubPullRequestRow {
            assignees: vec![assignee("42", "octocat-renamed")],
            labels: vec![label("bug", "d73a4a"), label("docs", "0075ca")],
            github_updated_at: Some(chrono::Utc::now()),
            ..row("macro/app/pull/8", Some(99), 8)
        })
            .into(),
    )
    .await
    .unwrap();

    store_for(
        &pool,
        "macro/other/pull/1",
        "macro|other@example.com",
        "user",
    )
    .await;
    repo.upsert_row(
        &(&GithubPullRequestRow {
            assignees: vec![assignee("9", "invisible")],
            labels: vec![label("secret", "ffffff")],
            ..row("macro/other/pull/1", Some(100), 1)
        })
            .into(),
    )
    .await
    .unwrap();

    let facets = repo
        .github_pull_request_facets(vec![SourceId::user(USER), SourceId::new(TEAM, "team")])
        .await
        .expect("facets should load");

    assert_eq!(
        facets.assignees,
        vec![
            GithubUserFacet {
                github_user_id: "42".to_string(),
                login: Some("octocat-renamed".to_string()),
                count: 2,
            },
            GithubUserFacet {
                github_user_id: "7".to_string(),
                login: Some("hubot".to_string()),
                count: 1,
            },
        ]
    );
    assert_eq!(
        facets.labels,
        vec![
            GithubLabelFacet {
                name: "bug".to_string(),
                color: Some("d73a4a".to_string()),
                count: 2,
            },
            GithubLabelFacet {
                name: "docs".to_string(),
                color: Some("0075ca".to_string()),
                count: 1,
            },
        ]
    );
}
async fn set_synced_at(pool: &PgPool, github_key: &str, timestamp: &str) {
    let timestamp = chrono::DateTime::parse_from_rfc3339(timestamp)
        .unwrap()
        .with_timezone(&chrono::Utc);
    sqlx::query!(
        "UPDATE github_pull_request SET updated_at = $2 WHERE github_key = $1",
        github_key,
        timestamp,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn facet_names_follow_sync_time_instead_of_pull_request_update_time(pool: PgPool) {
    let repo = PgGithubPullRequestRepo::new(pool.clone());
    for (key, number, repository, login, github_updated_at, synced_at) in [
        (
            "macro/app/pull/1",
            1,
            "app",
            "old-login",
            "2026-05-02T00:00:00Z",
            "2026-05-03T00:00:00Z",
        ),
        (
            "macro/renamed/pull/2",
            2,
            "renamed",
            "new-login",
            "2026-05-01T00:00:00Z",
            "2026-05-04T00:00:00Z",
        ),
    ] {
        store_for(&pool, key, USER, "user").await;
        let mut pull_request = row(key, Some(99), number);
        pull_request.repo = repository.to_string();
        pull_request.author_login = Some(login.to_string());
        pull_request.github_updated_at = Some(
            chrono::DateTime::parse_from_rfc3339(github_updated_at)
                .unwrap()
                .with_timezone(&chrono::Utc),
        );
        repo.upsert_row(&(&pull_request).into()).await.unwrap();
        set_synced_at(&pool, key, synced_at).await;
    }

    let facets = repo
        .github_pull_request_facets(vec![SourceId::user(USER)])
        .await
        .unwrap();
    assert_eq!(facets.repositories[0].repository, "macro/renamed");
    assert_eq!(facets.authors[0].login.as_deref(), Some("new-login"));
    assert_eq!(facets.repositories[0].count, 2);
    assert_eq!(facets.authors[0].count, 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn assignee_logins_and_label_colors_follow_sync_time(pool: PgPool) {
    let repo = PgGithubPullRequestRepo::new(pool.clone());
    for (key, number, login, color, github_updated_at, synced_at) in [
        (
            "macro/app/pull/1",
            1,
            "old-login",
            "000000",
            "2026-05-02T00:00:00Z",
            "2026-05-03T00:00:00Z",
        ),
        (
            "macro/app/pull/2",
            2,
            "new-login",
            "ffffff",
            "2026-05-01T00:00:00Z",
            "2026-05-04T00:00:00Z",
        ),
    ] {
        store_for(&pool, key, USER, "user").await;
        let mut pull_request = row(key, Some(99), number);
        pull_request.assignees = vec![assignee("42", login)];
        pull_request.labels = vec![label("bug", color)];
        pull_request.github_updated_at = Some(
            chrono::DateTime::parse_from_rfc3339(github_updated_at)
                .unwrap()
                .with_timezone(&chrono::Utc),
        );
        repo.upsert_row(&(&pull_request).into()).await.unwrap();
        set_synced_at(&pool, key, synced_at).await;
    }

    let facets = repo
        .github_pull_request_facets(vec![SourceId::user(USER)])
        .await
        .unwrap();
    assert_eq!(facets.assignees[0].login.as_deref(), Some("new-login"));
    assert_eq!(facets.labels[0].color.as_deref(), Some("ffffff"));
    assert_eq!(facets.assignees[0].count, 2);
    assert_eq!(facets.labels[0].count, 2);
}
