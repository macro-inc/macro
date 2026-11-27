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

#[tokio::test]
async fn detail_people_lookup_collects_every_author_once_and_guards_personal_sources() {
    use crate::domain::models::GithubPullRequestUser;

    let metadata = serde_json::json!({
        "githubKey":GITHUB_KEY, "owner":"macro", "repo":"app", "number":7,
        "url":"https://github.com/macro/app/pull/7", "displayName":"PR",
        "authorId":1,
        "assignees":[{"githubUserId":"2"}],
        "requestedReviewers":[{"githubUserId":"3"}],
        "reviews":[{"reviewerGithubUserId":"4", "state":"approved"}],
        "comments":[{"id":10,"body":"Review", "authorId":5, "source":"review_comment"},
                    {"id":11,"body":"Reply", "authorId":1, "source":"issue_comment"}]
    });
    let record = stored_record(&team(), metadata.clone());
    let foreign_entities = StubForeignEntityService::with_records(vec![record.clone()]);
    let rows = StubPullRequestRows::default();
    let service = service(&foreign_entities, &rows);
    let result = service
        .get_pull_request(view_receipt(&record))
        .await
        .unwrap();
    assert!(result.linked_macro_users.is_empty());
    assert_eq!(
        rows.people_requests.lock().unwrap().as_slice(),
        &[(
            vec!["1".into(), "2".into(), "3".into(), "4".into(), "5".into()],
            team()
        )]
    );

    let outsider_record = stored_record(&SourceId::user("macro|outside@example.com"), metadata);
    foreign_entities
        .state
        .lock()
        .unwrap()
        .records
        .push(outsider_record.clone());
    assert!(
        service
            .get_pull_request(view_receipt(&outsider_record))
            .await
            .unwrap()
            .linked_macro_users
            .is_empty()
    );
    assert_eq!(rows.people_requests.lock().unwrap().len(), 1);

    // The typed row wins over stale record metadata when choosing people to resolve.
    let mut typed = GithubPullRequestRow::from_metadata(&record.metadata).unwrap();
    typed.assignees = vec![GithubPullRequestUser {
        github_user_id: "6".into(),
        login: None,
    }];
    rows.rows.lock().unwrap().push(typed);
    service
        .get_pull_request(view_receipt(&record))
        .await
        .unwrap();
    assert_eq!(
        rows.people_requests.lock().unwrap()[1].0,
        vec!["1", "3", "4", "5", "6"]
    );
}
