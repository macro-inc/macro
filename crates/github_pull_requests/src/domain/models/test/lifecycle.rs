use super::*;

#[test]
fn closing_details_survive_sparse_refresh_and_clear_on_reopen() {
    let mut closed = EnrichedGithubPullRequest::from_reference(pull_request_reference());
    closed.status = Some(GithubPullRequestStatus::Merged);
    closed.merged_by = Some(GithubPullRequestUser {
        github_user_id: "7".to_string(),
        login: Some("merger".to_string()),
    });
    closed.closed_by = Some(GithubPullRequestUser {
        github_user_id: "8".to_string(),
        login: Some("closer".to_string()),
    });
    closed.merged_at = Some(utc_datetime("2026-11-01T12:00:00Z"));
    closed.closed_at = closed.merged_at;
    let stored = closed.foreign_entity_metadata(None).unwrap();
    let record = ForeignEntity {
        id: uuid::Uuid::nil(),
        foreign_entity_id: closed.github_key.clone(),
        foreign_entity_source: GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE.to_string(),
        metadata: stored.clone(),
        stored_for_id: "viewer".to_string(),
        stored_for_auth_entity: "user".to_string(),
        created_at: utc_datetime("2026-11-01T12:00:00Z"),
        updated_at: utc_datetime("2026-11-01T12:00:00Z"),
    };
    let detail = StoredGithubPullRequest::from_record(&record, None).unwrap();
    assert_eq!(detail.merged_by, closed.merged_by);
    assert_eq!(detail.closed_by, closed.closed_by);
    assert_eq!(detail.merged_at, closed.merged_at);
    assert_eq!(detail.closed_at, closed.closed_at);

    let sparse = EnrichedGithubPullRequest::from_reference(pull_request_reference());
    let retained = sparse.foreign_entity_metadata(Some(&stored)).unwrap();
    assert_eq!(retained["mergedBy"]["githubUserId"], "7");
    assert_eq!(retained["closedBy"]["githubUserId"], "8");
    assert_eq!(retained["mergedAt"], "2026-11-01T12:00:00Z");
    assert_eq!(retained["closedAt"], "2026-11-01T12:00:00Z");

    let mut reopened = sparse.clone();
    reopened.status = Some(GithubPullRequestStatus::Open);
    let cleared = reopened.foreign_entity_metadata(Some(&retained)).unwrap();
    let refreshed = sparse.foreign_entity_metadata(Some(&cleared)).unwrap();
    for field in ["mergedBy", "closedBy", "mergedAt", "closedAt"] {
        assert!(cleared[field].is_null());
        assert!(refreshed[field].is_null());
    }
}
