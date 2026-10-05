use super::*;
use crate::domain::models::{GithubPullRequestReview, GithubPullRequestReviewState};

#[tokio::test]
async fn partial_refresh_preserves_approval_from_the_failed_record() {
    for failed_record_first in [true, false] {
        let approved = EnrichedGithubPullRequest {
            reviews: Some(vec![GithubPullRequestReview {
                reviewer_github_user_id: "8".to_string(),
                reviewer_login: None,
                state: GithubPullRequestReviewState::Approved,
                submitted_at: Some(Utc::now()),
            }]),
            ..pull_request(GithubPullRequestStatus::Open)
        }
        .foreign_entity_metadata(None)
        .unwrap();
        let original_row = GithubPullRequestRow::from_metadata(&approved).unwrap();
        assert_eq!(
            original_row.review_decision,
            Some(GithubPullRequestReviewDecision::Approved)
        );
        let failed = stored_record(&team(), approved);
        let successful = stored_record(&user(), serde_json::json!({ "status": "open" }));
        let records = if failed_record_first {
            vec![failed.clone(), successful.clone()]
        } else {
            vec![successful.clone(), failed.clone()]
        };
        let foreign_entities = StubForeignEntityService::with_records(records);
        foreign_entities.state.lock().unwrap().failing_patches = vec![failed.id];
        let rows = StubPullRequestRows::default();
        rows.rows.lock().unwrap().push(original_row.clone());
        let service = service(&foreign_entities, &rows);

        assert!(
            service
                .refresh_pull_request(&pull_request(GithubPullRequestStatus::Closed))
                .await
                .is_err()
        );

        assert_eq!(foreign_entities.patches().len(), 2);
        let updated = foreign_entities
            .records()
            .into_iter()
            .find(|record| record.id == successful.id)
            .unwrap();
        assert_eq!(updated.metadata["status"], "closed");
        assert_eq!(rows.rows(), vec![original_row]);
    }
}

#[tokio::test]
async fn partial_refresh_defers_a_new_typed_row_until_retry_succeeds() {
    let failed = stored_record(&team(), serde_json::json!({ "status": "open" }));
    let successful = stored_record(&user(), serde_json::json!({ "status": "open" }));
    let foreign_entities = StubForeignEntityService::with_records(vec![failed.clone(), successful]);
    foreign_entities.state.lock().unwrap().failing_patches = vec![failed.id];
    let rows = StubPullRequestRows::default();
    let service = service(&foreign_entities, &rows);
    let update = pull_request(GithubPullRequestStatus::Closed);

    assert!(service.refresh_pull_request(&update).await.is_err());
    assert!(rows.rows().is_empty());
    assert_eq!(foreign_entities.patches().len(), 2);

    foreign_entities
        .state
        .lock()
        .unwrap()
        .failing_patches
        .clear();
    assert_eq!(
        service.refresh_pull_request(&update).await.unwrap().len(),
        2
    );
    assert_eq!(rows.rows().len(), 1);
    assert_eq!(rows.rows()[0].status, Some(GithubPullRequestStatus::Closed));
}
