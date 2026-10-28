use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::PgGithubPullRequestRepo;
use crate::domain::{
    models::{
        GitRef, GithubPullRequestLabel, GithubPullRequestReview, GithubPullRequestReviewDecision,
        GithubPullRequestReviewState, GithubPullRequestRow, GithubPullRequestStatus,
        GithubPullRequestUser,
    },
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
        participant_github_user_ids: vec!["42".to_string(), "8".to_string()],
        github_updated_at: None,
        assignees: Vec::new(),
        labels: Vec::new(),
        reviews: Vec::new(),
        review_decision: Some(GithubPullRequestReviewDecision::ReviewRequired),
        base: None,
        head: None,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn upsert_stores_a_row_found_by_repository_and_number(pool: PgPool) {
    let repo = PgGithubPullRequestRepo::new(pool.clone());

    repo.upsert_row(&(&row("macro/app/pull/7", Some(99)).into()))
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

    repo.upsert_row(&(&row("macro/app/pull/7", None)).into())
        .await
        .expect("upsert should succeed");
    assert_eq!(
        stored_row(&pool, "macro/app/pull/7").await,
        Some((None, "app".to_string(), Some("open".to_string())))
    );

    repo.upsert_row(&(&row("macro/app/pull/7", Some(99)).into()))
        .await
        .expect("upsert should succeed");
    repo.upsert_row(
        &(&GithubPullRequestRow {
            status: Some(GithubPullRequestStatus::Merged),
            ..row("macro/app/pull/7", None)
        })
            .into(),
    )
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
    repo.upsert_row(&(&row("macro/app/pull/7", Some(99)).into()))
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

    repo.upsert_row(
        &(&GithubPullRequestRow {
            number: 8,
            ..row("macro/app/pull/8", Some(99))
        })
            .into(),
    )
    .await
    .unwrap();
    repo.upsert_row(
        &(&GithubPullRequestRow {
            number: 9,
            ..row("macro/renamed/pull/8", None)
        })
            .into(),
    )
    .await
    .unwrap();
    repo.rename_row("macro/app/pull/8", "macro/renamed/pull/8")
        .await
        .expect("rename onto an existing row should succeed");

    assert_eq!(stored_row(&pool, "macro/app/pull/8").await, None);
    assert!(stored_row(&pool, "macro/renamed/pull/8").await.is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn upsert_stores_assignees_labels_and_reviews(pool: PgPool) {
    let repo = PgGithubPullRequestRepo::new(pool.clone());

    repo.upsert_row(
        &(&GithubPullRequestRow {
            assignees: vec![GithubPullRequestUser {
                github_user_id: "7".to_string(),
                login: Some("hubot".to_string()),
            }],
            labels: vec![GithubPullRequestLabel {
                name: "bug".to_string(),
                color: Some("d73a4a".to_string()),
            }],
            reviews: vec![GithubPullRequestReview {
                reviewer_github_user_id: "8".to_string(),
                reviewer_login: Some("monalisa".to_string()),
                state: GithubPullRequestReviewState::Approved,
                submitted_at: None,
            }],
            review_decision: Some(GithubPullRequestReviewDecision::Approved),
            ..row("macro/app/pull/7", Some(99))
        })
            .into(),
    )
    .await
    .expect("upsert should succeed");

    let stored: (serde_json::Value, serde_json::Value, serde_json::Value, Option<String>) =
        sqlx::query_as(
            "SELECT assignees, labels, reviews, review_decision FROM github_pull_request WHERE github_key = $1",
        )
        .bind("macro/app/pull/7")
        .fetch_one(&pool)
        .await
        .expect("row lookup should succeed");

    assert_eq!(
        stored.0,
        serde_json::json!([{ "githubUserId": "7", "login": "hubot" }])
    );
    assert_eq!(
        stored.1,
        serde_json::json!([{ "name": "bug", "color": "d73a4a" }])
    );
    assert_eq!(
        stored.2,
        serde_json::json!([{
            "reviewerGithubUserId": "8",
            "reviewerLogin": "monalisa",
            "state": "approved"
        }])
    );
    assert_eq!(stored.3.as_deref(), Some("approved"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_sparse_writes_merge_on_missing_row(pool: PgPool) {
    let repo = PgGithubPullRequestRepo::new(pool.clone());
    let base = row("macro/app/pull/7", Some(99));
    let title = crate::domain::models::GithubPullRequestWrite {
        title: Some("independent title".into()),
        ..(&base).into()
    };
    let mut title = title;
    title.draft = None;
    title.assignees = None;
    title.labels = None;
    title.requested_reviewer_github_user_ids = None;
    title.participant_github_user_ids = None;
    title.reviews = None;
    let mut other = crate::domain::models::GithubPullRequestWrite::from(&base);
    other.title = None;
    other.status = None;
    other.draft = Some(true);
    other.assignees = Some(vec![GithubPullRequestUser {
        github_user_id: "7".into(),
        login: None,
    }]);
    let (first, second) = tokio::join!(repo.upsert_row(&title), repo.upsert_row(&other));
    first.unwrap();
    second.unwrap();
    let stored = sqlx::query!(
        "SELECT title, draft, assignees, requested_reviewer_github_user_ids FROM github_pull_request WHERE github_key = $1",
        base.github_key,
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(stored.title.as_deref(), Some("independent title"));
    assert!(stored.draft);
    assert_eq!(stored.assignees.as_array().unwrap().len(), 1);
    assert_eq!(stored.requested_reviewer_github_user_ids, vec!["8"]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sparse_update_preserves_rich_row_and_supplied_empty_collections_replace_it(pool: PgPool) {
    let repo = PgGithubPullRequestRepo::new(pool.clone());
    let mut original = row("macro/app/pull/7", Some(99));
    original.draft = true;
    original.assignees = vec![GithubPullRequestUser {
        github_user_id: "7".into(),
        login: None,
    }];
    original.labels = vec![GithubPullRequestLabel {
        name: "bug".into(),
        color: None,
    }];
    original.reviews = vec![GithubPullRequestReview {
        reviewer_github_user_id: "8".into(),
        reviewer_login: None,
        state: GithubPullRequestReviewState::Approved,
        submitted_at: None,
    }];
    repo.upsert_row(&(&original).into()).await.unwrap();
    let sparse = crate::domain::models::GithubPullRequestWrite::from_metadata(&serde_json::json!({
        "githubKey":"macro/app/pull/7", "owner":"macro", "repo":"app", "number":7,
        "url":"https://github.com/macro/app/pull/7", "displayName":"PR", "status":"closed",
        "participantGithubUserIds":["9"],
        "reviews":[{"reviewerGithubUserId":"8", "state":"commented"}]
    }))
    .unwrap();
    repo.upsert_row(&sparse).await.unwrap();
    let stored = sqlx::query!(
        "SELECT draft, assignees, labels, requested_reviewer_github_user_ids, participant_github_user_ids, reviews, review_decision FROM github_pull_request WHERE github_key = $1",
        original.github_key,
    ).fetch_one(&pool).await.unwrap();
    assert!(stored.draft);
    assert_eq!(stored.assignees.as_array().unwrap().len(), 1);
    assert_eq!(stored.labels.as_array().unwrap().len(), 1);
    assert_eq!(stored.requested_reviewer_github_user_ids, vec!["8"]);
    assert!(
        stored
            .participant_github_user_ids
            .contains(&"9".to_string())
    );
    assert_eq!(stored.reviews[0]["state"], "approved");
    assert_eq!(stored.review_decision.as_deref(), Some("approved"));
    repo.upsert_row(&crate::domain::models::GithubPullRequestWrite {
        draft: Some(false),
        assignees: Some(vec![]),
        labels: Some(vec![]),
        requested_reviewer_github_user_ids: Some(vec![]),
        ..sparse
    })
    .await
    .unwrap();
    let stored = sqlx::query!(
        "SELECT draft, assignees, labels, requested_reviewer_github_user_ids, review_decision FROM github_pull_request WHERE github_key = $1",
        original.github_key,
    ).fetch_one(&pool).await.unwrap();
    assert!(!stored.draft);
    assert_eq!(stored.assignees, serde_json::json!([]));
    assert_eq!(stored.labels, serde_json::json!([]));
    assert!(stored.requested_reviewer_github_user_ids.is_empty());
    assert_eq!(stored.review_decision.as_deref(), Some("approved"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lookup_reads_back_the_stored_row(pool: PgPool) {
    let repo = PgGithubPullRequestRepo::new(pool);
    let stored = GithubPullRequestRow {
        draft: true,
        assignees: vec![GithubPullRequestUser {
            github_user_id: "7".to_string(),
            login: Some("hubot".to_string()),
        }],
        labels: vec![GithubPullRequestLabel {
            name: "bug".to_string(),
            color: Some("d73a4a".to_string()),
        }],
        reviews: vec![GithubPullRequestReview {
            reviewer_github_user_id: "8".to_string(),
            reviewer_login: None,
            state: GithubPullRequestReviewState::ChangesRequested,
            submitted_at: None,
        }],
        review_decision: Some(GithubPullRequestReviewDecision::ChangesRequested),
        base: Some(GitRef {
            name: Some("main".to_string()),
            sha: Some("base-sha".to_string()),
        }),
        head: Some(GitRef {
            name: Some("feature".to_string()),
            sha: Some("head-sha".to_string()),
        }),
        ..row("macro/app/pull/7", Some(99))
    };
    repo.upsert_row(&(&stored).into())
        .await
        .expect("upsert should succeed");

    assert_eq!(
        repo.pull_request_row("macro/app/pull/7").await.unwrap(),
        Some(stored)
    );
    assert_eq!(
        repo.pull_request_row("macro/app/pull/8").await.unwrap(),
        None
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn partial_git_refs_replace_name_and_sha_together(pool: PgPool) {
    let repo = PgGithubPullRequestRepo::new(pool);
    let original = GithubPullRequestRow {
        base: Some(GitRef {
            name: Some("main".to_string()),
            sha: Some("old-base-sha".to_string()),
        }),
        head: Some(GitRef {
            name: Some("feature".to_string()),
            sha: Some("old-head-sha".to_string()),
        }),
        ..row("macro/app/pull/7", Some(99))
    };
    for partial in [
        Some(GitRef {
            name: Some("new-branch".to_string()),
            sha: None,
        }),
        Some(GitRef {
            name: None,
            sha: Some("new-sha".to_string()),
        }),
        Some(GitRef {
            name: None,
            sha: None,
        }),
        None,
    ] {
        for update_base in [true, false] {
            repo.upsert_row(&(&original).into()).await.unwrap();
            let mut incoming = row("macro/app/pull/7", Some(99));
            let mut expected = original.clone();
            let expected_ref = match &partial {
                Some(git_ref) if git_ref.name.is_some() || git_ref.sha.is_some() => {
                    Some(git_ref.clone())
                }
                Some(_) => None,
                None if update_base => original.base.clone(),
                None => original.head.clone(),
            };
            if update_base {
                incoming.base = partial.clone();
                expected.base = expected_ref;
            } else {
                incoming.head = partial.clone();
                expected.head = expected_ref;
            }
            repo.upsert_row(&(&incoming).into()).await.unwrap();

            assert_eq!(
                repo.pull_request_row("macro/app/pull/7").await.unwrap(),
                Some(expected),
                "update_base={update_base}, partial={partial:?}",
            );
        }
    }
}
