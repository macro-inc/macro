use super::*;

#[test]
fn sparse_typed_updates_keep_omissions_and_replace_supplied_empty_values() {
    let original = GithubPullRequestRow {
        draft: true,
        assignees: vec![GithubPullRequestUser {
            github_user_id: "7".into(),
            login: None,
        }],
        labels: vec![GithubPullRequestLabel {
            name: "bug".into(),
            color: None,
        }],
        reviews: vec![GithubPullRequestReview {
            reviewer_github_user_id: "8".into(),
            reviewer_login: None,
            state: GithubPullRequestReviewState::Approved,
            submitted_at: None,
        }],
        ..GithubPullRequestRow::from_metadata(&serde_json::json!({
            "githubKey":"macro/app/pull/7", "owner":"macro", "repo":"app", "number":7,
            "url":"https://github.com/macro/app/pull/7", "displayName":"PR",
            "requestedReviewerGithubUserIds":["8"], "participantGithubUserIds":["7"]
        }))
        .unwrap()
    };
    let sparse = GithubPullRequestWrite::from_metadata(&serde_json::json!({
        "githubKey":"macro/app/pull/7", "owner":"macro", "repo":"app", "number":7,
        "url":"https://github.com/macro/app/pull/7", "displayName":"PR", "status":"closed",
        "participantGithubUserIds":["9"],
        "reviews":[{"reviewerGithubUserId":"8", "state":"commented"}]
    }))
    .unwrap();
    let merged = sparse.merge(Some(original));
    assert!(merged.draft);
    assert_eq!(merged.assignees.len(), 1);
    assert_eq!(merged.labels.len(), 1);
    assert_eq!(merged.participant_github_user_ids, vec!["7", "9"]);
    assert_eq!(
        merged.reviews[0].state,
        GithubPullRequestReviewState::Approved
    );
    assert_eq!(
        merged.review_decision,
        Some(GithubPullRequestReviewDecision::Approved)
    );
    let supplied = GithubPullRequestWrite {
        draft: Some(false),
        assignees: Some(vec![]),
        labels: Some(vec![]),
        requested_reviewer_github_user_ids: Some(vec![]),
        ..sparse
    };
    let merged = supplied.merge(Some(merged));
    assert!(!merged.draft);
    assert!(merged.assignees.is_empty());
    assert!(merged.labels.is_empty());
    assert!(merged.requested_reviewer_github_user_ids.is_empty());
    assert_eq!(
        merged.review_decision,
        Some(GithubPullRequestReviewDecision::Approved)
    );
}

#[test]
fn existing_typed_row_ignores_the_entire_fallback() {
    let base = GithubPullRequestWrite::from_metadata(&serde_json::json!({
        "githubKey":"macro/app/pull/7", "owner":"macro", "repo":"app", "number":7,
        "url":"https://github.com/macro/app/pull/7", "displayName":"PR",
        "participantGithubUserIds":["7"],
        "reviews":[{"reviewerGithubUserId":"8", "state":"approved"}]
    }))
    .unwrap();
    let existing = GithubPullRequestWrite {
        title: Some("existing".into()),
        ..base.clone()
    }
    .merge(None);
    let fallback = GithubPullRequestWrite {
        title: Some("fallback".into()),
        status: Some(GithubPullRequestStatus::Closed),
        participant_github_user_ids: Some(vec!["9".into()]),
        reviews: Some(vec![review(
            "10",
            GithubPullRequestReviewState::ChangesRequested,
            1,
        )]),
        ..base.clone()
    }
    .merge(None);
    let incoming = GithubPullRequestWrite {
        title: None,
        status: None,
        participant_github_user_ids: None,
        reviews: None,
        initial_row: Some(fallback),
        ..base
    };
    let merged = incoming.merge(Some(existing.clone()));
    assert_eq!(merged, existing);
    assert_eq!(merged.participant_github_user_ids, vec!["7"]);
    assert_eq!(merged.reviews.len(), 1);
    assert_eq!(
        merged.review_decision,
        Some(GithubPullRequestReviewDecision::Approved)
    );
}

#[test]
fn mismatched_fallback_key_or_number_is_rejected() {
    let write = GithubPullRequestWrite::from_metadata(&serde_json::json!({
        "githubKey":"macro/app/pull/7", "owner":"macro", "repo":"app", "number":7,
        "url":"https://github.com/macro/app/pull/7", "displayName":"PR"
    }))
    .unwrap();
    let fallback = GithubPullRequestWrite {
        title: Some("wrong row".into()),
        ..write.clone()
    }
    .merge(None);
    for invalid in [
        GithubPullRequestRow {
            github_key: "other/app/pull/7".into(),
            ..fallback.clone()
        },
        GithubPullRequestRow {
            number: 8,
            ..fallback.clone()
        },
    ] {
        let merged = GithubPullRequestWrite {
            initial_row: Some(invalid),
            ..write.clone()
        }
        .merge(None);
        assert_eq!(merged, write.merge(None));
        assert_eq!(merged.title, None);
    }
}

#[test]
fn sparse_git_refs_replace_pairs_and_omitted_refs_keep_both_components() {
    let mut reference = EnrichedGithubPullRequest::from_reference(pull_request_reference());
    reference.base = Some(GitRef {
        name: Some("main".into()),
        sha: Some("base-sha".into()),
    });
    reference.head = Some(GitRef {
        name: Some("feature".into()),
        sha: Some("head-sha".into()),
    });
    let original = GithubPullRequestWrite::from_enriched(&reference)
        .unwrap()
        .merge(None);

    for partial in [
        Some(GitRef {
            name: Some("new-branch".into()),
            sha: None,
        }),
        Some(GitRef {
            name: None,
            sha: Some("new-sha".into()),
        }),
        Some(GitRef {
            name: None,
            sha: None,
        }),
        None,
    ] {
        for update_base in [true, false] {
            let mut sparse = EnrichedGithubPullRequest::from_reference(pull_request_reference());
            if update_base {
                sparse.base = partial.clone();
            } else {
                sparse.head = partial.clone();
            }
            let mut write = GithubPullRequestWrite::from_enriched(&sparse).unwrap();
            let actual = write.merge(Some(original.clone()));
            let mut expected = original.clone();
            if let Some(partial) = &partial {
                if update_base {
                    expected.base = Some(partial.clone());
                } else {
                    expected.head = Some(partial.clone());
                }
            }
            assert_eq!(actual, expected);
            write.initial_row = Some(original.clone());
            assert_eq!(write.merge(None), expected);
        }
    }
}

#[test]
fn detail_metadata_survives_sparse_refresh_and_clears_review_requests() {
    let mut stored = EnrichedGithubPullRequest::from_reference(pull_request_reference());
    stored.github_created_at = Some(utc_datetime("2026-11-01T10:00:00Z"));
    stored.default_branch = Some("main".to_string());
    stored.requested_reviewers = Some(vec![GithubPullRequestUser {
        github_user_id: "42".to_string(),
        login: Some("reviewer".to_string()),
    }]);
    stored.requested_reviewer_github_user_ids = Some(vec!["42".to_string()]);
    let metadata = stored.foreign_entity_metadata(None).unwrap();
    let sparse = EnrichedGithubPullRequest::from_reference(pull_request_reference());
    let merged = sparse.foreign_entity_metadata(Some(&metadata)).unwrap();
    let row = GithubPullRequestWrite::from_enriched(&sparse)
        .unwrap()
        .merge(GithubPullRequestRow::from_metadata(&metadata));
    let record = stored_record(&stored);
    let response = StoredGithubPullRequest::from_record(&record, Some(row.clone())).unwrap();
    assert_eq!(response.github_created_at, stored.github_created_at);
    assert_eq!(response.default_branch, stored.default_branch);
    assert_eq!(
        response.requested_reviewers,
        stored.requested_reviewers.clone().unwrap()
    );
    assert_eq!(
        GithubPullRequestRow::from_metadata(&merged),
        Some(row.clone())
    );

    let mut cleared = sparse;
    cleared.requested_reviewers = Some(vec![]);
    cleared.requested_reviewer_github_user_ids = Some(vec![]);
    let cleared_metadata = cleared.foreign_entity_metadata(Some(&merged)).unwrap();
    let cleared_row = GithubPullRequestWrite::from_enriched(&cleared)
        .unwrap()
        .merge(Some(row));
    assert!(cleared_row.requested_reviewers.is_empty());
    assert!(cleared_row.requested_reviewer_github_user_ids.is_empty());
    assert_eq!(
        GithubPullRequestRow::from_metadata(&cleared_metadata),
        Some(cleared_row)
    );
}
