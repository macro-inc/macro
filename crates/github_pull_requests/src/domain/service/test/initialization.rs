use super::*;
use crate::domain::models::{
    GithubPullRequestLabel, GithubPullRequestReview, GithubPullRequestReviewState,
};

fn rich_source() -> serde_json::Value {
    EnrichedGithubPullRequest {
        repository_id: Some(99),
        author_id: Some(7),
        author_login: Some("author".into()),
        draft: Some(true),
        labels: Some(vec![GithubPullRequestLabel {
            name: "important".into(),
            color: None,
        }]),
        participant_github_user_ids: Some(vec!["7".into()]),
        reviews: Some(vec![GithubPullRequestReview {
            reviewer_github_user_id: "8".into(),
            reviewer_login: None,
            state: GithubPullRequestReviewState::Approved,
            submitted_at: Some(Utc::now()),
        }]),
        ..pull_request(GithubPullRequestStatus::Open)
    }
    .foreign_entity_metadata(None)
    .unwrap()
}

fn sparse_source() -> serde_json::Value {
    EnrichedGithubPullRequest {
        name: None,
        participant_github_user_ids: Some(vec!["9".into()]),
        ..pull_request(GithubPullRequestStatus::Open)
    }
    .foreign_entity_metadata(None)
    .unwrap()
}

fn assert_rich_fields(row: &GithubPullRequestRow, title: Option<&str>) {
    assert_eq!(row.repository_id, Some(99));
    assert_eq!(row.title.as_deref(), title);
    assert_eq!(row.author_github_user_id.as_deref(), Some("7"));
    assert_eq!(row.author_login.as_deref(), Some("author"));
    assert!(row.draft);
    assert_eq!(row.labels[0].name, "important");
    assert_eq!(row.participant_github_user_ids, vec!["42", "7", "9"]);
    assert_eq!(row.reviews[0].state, GithubPullRequestReviewState::Approved);
    assert_eq!(
        row.review_decision,
        Some(GithubPullRequestReviewDecision::Approved)
    );
}

#[tokio::test]
async fn upsert_recovers_a_missing_row_from_all_loaded_sources() {
    let mut rich = stored_record(&team(), rich_source());
    rich.updated_at -= chrono::Duration::hours(2);
    let mut sparse = stored_record(&user(), sparse_source());
    sparse.updated_at -= chrono::Duration::hours(1);
    // The later sparse source must not discard the earlier source's richer fields.
    let foreign_entities = StubForeignEntityService::with_records(vec![sparse, rich]);
    let rows = StubPullRequestRows::default();
    service(&foreign_entities, &rows)
        .upsert_pull_request(UpsertGithubPullRequest {
            pull_request: EnrichedGithubPullRequest {
                name: None,
                participant_github_user_ids: Some(vec!["42".into()]),
                ..pull_request(GithubPullRequestStatus::Closed)
            },
            stored_for: user(),
        })
        .await
        .unwrap();
    let stored = rows.rows();
    assert_eq!(stored.len(), 1);
    assert_rich_fields(&stored[0], Some("Add pull request storage"));
    assert_eq!(stored[0].status, Some(GithubPullRequestStatus::Closed));
}

#[tokio::test]
async fn successful_refresh_recovers_a_missing_row_from_every_source() {
    let rich = stored_record(&team(), rich_source());
    let sparse = stored_record(&user(), sparse_source());
    let foreign_entities = StubForeignEntityService::with_records(vec![rich, sparse]);
    let rows = StubPullRequestRows::default();
    let refreshed = service(&foreign_entities, &rows)
        .refresh_pull_request(&EnrichedGithubPullRequest {
            name: None,
            participant_github_user_ids: Some(vec!["42".into()]),
            ..pull_request(GithubPullRequestStatus::Closed)
        })
        .await
        .unwrap();
    assert_eq!(refreshed.len(), 2);
    let stored = rows.rows();
    assert_eq!(stored.len(), 1);
    assert_rich_fields(&stored[0], Some("Add pull request storage"));
    assert_eq!(stored[0].status, Some(GithubPullRequestStatus::Closed));
}

#[test]
fn initialization_filters_key_and_number_and_orders_sources() {
    let mut older = stored_record(&team(), rich_source());
    older.updated_at -= chrono::Duration::hours(2);
    let mut newer = stored_record(&user(), sparse_source());
    newer.updated_at -= chrono::Duration::hours(1);
    newer.metadata["labels"] = serde_json::json!([]);
    let mut wrong_record_key = stored_record(&user(), rich_source());
    wrong_record_key.foreign_entity_id = "wrong/app/pull/7".into();
    let mut wrong_metadata_key = stored_record(&user(), rich_source());
    wrong_metadata_key.metadata["githubKey"] = serde_json::json!("wrong/app/pull/7");
    let mut wrong_number = stored_record(&user(), rich_source());
    wrong_number.metadata["number"] = serde_json::json!(8);
    let records = [
        newer,
        wrong_record_key,
        wrong_metadata_key,
        wrong_number,
        older,
    ];
    let row = super::super::initialization_row(&records, GITHUB_KEY, 7).unwrap();
    assert_eq!(row.title.as_deref(), Some("Add pull request storage"));
    assert!(row.labels.is_empty());
    assert_eq!(row.participant_github_user_ids, vec!["7", "9"]);
}
