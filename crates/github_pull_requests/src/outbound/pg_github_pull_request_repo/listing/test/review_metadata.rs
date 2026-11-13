use super::*;
use crate::domain::{models::GithubPullRequestWrite, ports::GithubPullRequestRepository};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn listing_uses_shared_review_columns_instead_of_stale_source_metadata(pool: PgPool) {
    let foreign_repo = PgForeignEntityRepo::new(pool.clone());
    let repo = PgGithubPullRequestRepo::new(pool);
    let key = "owner/repo/pull/7";
    foreign_repo
        .create_foreign_entity(
            Uuid::now_v7(),
            CreateForeignEntity {
                foreign_entity_id: key.to_string(),
                foreign_entity_source: "github_pull_request".to_string(),
                metadata: json!({
                    "reviewDecision": "approved",
                    "requestedReviewerGithubUserIds": ["old"],
                    "reviews": []
                }),
                stored_for_id: "viewer".to_string(),
                stored_for_auth_entity: "user".to_string(),
            },
        )
        .await
        .unwrap();

    let write = GithubPullRequestWrite::from_metadata(&json!({
        "githubKey": key, "owner": "owner", "repo": "repo", "number": 7,
        "url": "https://github.com/owner/repo/pull/7", "displayName": "owner/repo#7",
        "status": "open", "requestedReviewerGithubUserIds": ["42"],
        "reviews": [
            { "reviewerGithubUserId": "43", "state": "approved", "submittedAt": "2026-11-01T10:00:00Z" },
            { "reviewerGithubUserId": "43", "state": "changes_requested", "submittedAt": "2026-11-01T11:00:00Z" }
        ]
    })).unwrap();
    repo.upsert_row(&write).await.unwrap();
    let rows = repo
        .list_pull_requests(
            None,
            vec![SourceId::new("viewer", "user")],
            50,
            list_query(SimpleSortMethod::UpdatedAt),
            None,
            GithubPullRequestSortDirection::Desc,
        )
        .await
        .unwrap();

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].metadata["reviewDecision"], "changes_requested");
    assert_eq!(
        rows[0].metadata["requestedReviewerGithubUserIds"],
        json!(["42"])
    );
    assert_eq!(rows[0].metadata["reviews"].as_array().unwrap().len(), 1);
    assert_eq!(rows[0].metadata["reviews"][0]["state"], "changes_requested");
}
