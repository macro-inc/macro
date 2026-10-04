mod sparse;
use super::*;

#[test]
fn test_github_key() {
    let key = GithubKey::new("rust-lang", "rust", 12345);
    assert_eq!(key.as_ref(), "rust-lang/rust/pull/12345");
    assert_eq!(key.to_string(), "rust-lang/rust/pull/12345");
}

fn pull_request_reference() -> GithubPullRequestRef {
    GithubPullRequestRef {
        github_key: "macro/app/pull/7".to_string(),
        owner: "macro".to_string(),
        repo: "app".to_string(),
        number: 7,
        url: "https://github.com/macro/app/pull/7".to_string(),
        display_name: "macro/app#7".to_string(),
    }
}

fn pull_request_details(
    state: &str,
    merged_at: Option<chrono::DateTime<chrono::Utc>>,
) -> GithubPullRequestDetails {
    GithubPullRequestDetails {
        title: "Add pull request enrichment".to_string(),
        state: state.to_string(),
        repository_id: None,
        merged_at,
        additions: 42,
        deletions: 12,
        author_login: Some("octocat".to_string()),
        author_id: Some(583231),
        description: Some("Enrich pull requests with GitHub data".to_string()),
        comments: None,
        checks: None,
        participant_github_user_ids: None,
        draft: None,
        requested_reviewer_github_user_ids: None,
        github_updated_at: None,
        assignees: None,
        labels: None,
        reviews: None,
        base: None,
        head: None,
    }
}

fn utc_datetime(value: &str) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::parse_from_rfc3339(value)
        .unwrap()
        .with_timezone(&chrono::Utc)
}

fn pull_request_comment() -> GithubPullRequestComment {
    GithubPullRequestComment {
        id: 101,
        body: "Looks good to me".to_string(),
        author_id: None,
        author_login: Some("octocat".to_string()),
        author_association: Some("MEMBER".to_string()),
        url: Some("https://github.com/macro/app/pull/7#issuecomment-101".to_string()),
        created_at: Some(utc_datetime("2026-05-25T18:54:21Z")),
        updated_at: Some(utc_datetime("2026-05-25T19:00:00Z")),
        source: "issue_comment".to_string(),
        in_reply_to_id: None,
        pull_request_review_id: None,
        path: None,
        line: None,
        original_line: None,
    }
}

fn pull_request_check_run() -> GithubPullRequestCheckRun {
    GithubPullRequestCheckRun {
        id: 202,
        name: "ci".to_string(),
        status: "completed".to_string(),
        conclusion: Some("success".to_string()),
        url: Some("https://github.com/macro/app/actions/runs/202".to_string()),
        started_at: Some(utc_datetime("2026-05-25T18:55:00Z")),
        completed_at: Some(utc_datetime("2026-05-25T18:59:00Z")),
    }
}

#[test]
fn pull_request_status_maps_open_pr() {
    let details = pull_request_details("open", None);

    assert_eq!(details.status(), GithubPullRequestStatus::Open);
}

#[test]
fn pull_request_status_maps_closed_unmerged_pr() {
    let details = pull_request_details("closed", None);

    assert_eq!(details.status(), GithubPullRequestStatus::Closed);
}

#[test]
fn pull_request_status_maps_closed_merged_pr() {
    let merged_at = utc_datetime("2026-05-25T18:54:21Z");
    let details = pull_request_details("closed", Some(merged_at));

    assert_eq!(details.status(), GithubPullRequestStatus::Merged);
}

#[test]
fn pull_request_details_deserializes_github_comment_count() {
    let details_json = serde_json::json!({
        "title": "Add pull request enrichment",
        "state": "open",
        "merged_at": null,
        "additions": 42,
        "deletions": 12,
        "comments": 3
    });

    let details: GithubPullRequestDetails = serde_json::from_value(details_json).unwrap();

    assert_eq!(details.comments, None);
    assert_eq!(details.checks, None);
}

#[test]
fn pull_request_proxy_request_serializes_with_only_pull_requests() {
    let reference = pull_request_reference();
    let request = EnrichGithubPullRequestsProxyRequest {
        pull_requests: vec![reference],
    };

    let request_json = serde_json::to_value(&request).unwrap();

    assert_eq!(
        request_json,
        serde_json::json!({
            "pullRequests": [
                {
                    "githubKey": "macro/app/pull/7",
                    "owner": "macro",
                    "repo": "app",
                    "number": 7,
                    "url": "https://github.com/macro/app/pull/7",
                    "displayName": "macro/app#7"
                }
            ]
        })
    );
    assert!(request_json.get("macroUserId").is_none());

    let decoded_request: EnrichGithubPullRequestsProxyRequest =
        serde_json::from_value(request_json).unwrap();
    assert_eq!(decoded_request, request);
}

#[test]
fn pull_request_response_serializes_with_camel_case_fields() {
    let reference = pull_request_reference();
    let response = EnrichGithubPullRequestsResponse {
        pull_requests: vec![EnrichedGithubPullRequest {
            github_key: reference.github_key,
            owner: reference.owner,
            repo: reference.repo,
            repository_id: None,
            number: reference.number,
            url: reference.url,
            display_name: reference.display_name,
            name: Some("Add pull request enrichment".to_string()),
            status: Some(GithubPullRequestStatus::Merged),
            additions: Some(42),
            deletions: Some(12),
            author_login: Some("octocat".to_string()),
            author_id: Some(583231),
            description: Some("Enrich pull requests with GitHub data".to_string()),
            comments: Some(vec![pull_request_comment()]),
            checks: Some(vec![pull_request_check_run()]),
            participant_github_user_ids: None,
            draft: None,
            requested_reviewer_github_user_ids: None,
            github_updated_at: None,
            assignees: None,
            labels: None,
            reviews: None,
            base: None,
            head: None,
        }],
    };

    let response_json = serde_json::to_value(&response).unwrap();

    assert_eq!(
        response_json,
        serde_json::json!({
            "pullRequests": [
                {
                    "githubKey": "macro/app/pull/7",
                    "owner": "macro",
                    "repo": "app",
                    "number": 7,
                    "url": "https://github.com/macro/app/pull/7",
                    "displayName": "macro/app#7",
                    "name": "Add pull request enrichment",
                    "status": "merged",
                    "additions": 42,
                    "deletions": 12,
                    "authorLogin": "octocat",
                    "authorId": 583231,
                    "description": "Enrich pull requests with GitHub data",
                    "comments": [
                        {
                            "id": 101,
                            "body": "Looks good to me",
                            "authorLogin": "octocat",
                            "authorAssociation": "MEMBER",
                            "url": "https://github.com/macro/app/pull/7#issuecomment-101",
                            "createdAt": "2026-05-25T18:54:21Z",
                            "updatedAt": "2026-05-25T19:00:00Z",
                            "source": "issue_comment"
                        }
                    ],
                    "checks": [
                        {
                            "id": 202,
                            "name": "ci",
                            "status": "completed",
                            "conclusion": "success",
                            "url": "https://github.com/macro/app/actions/runs/202",
                            "startedAt": "2026-05-25T18:55:00Z",
                            "completedAt": "2026-05-25T18:59:00Z"
                        }
                    ]
                }
            ]
        })
    );

    let decoded_response: EnrichGithubPullRequestsResponse =
        serde_json::from_value(response_json).unwrap();
    assert_eq!(decoded_response, response);
}

#[test]
fn pull_request_response_deserializes_without_comments_and_checks() {
    let response_json = serde_json::json!({
        "pullRequests": [
            {
                "githubKey": "macro/app/pull/7",
                "owner": "macro",
                "repo": "app",
                "number": 7,
                "url": "https://github.com/macro/app/pull/7",
                "displayName": "macro/app#7",
                "name": "Add pull request enrichment",
                "status": "open",
                "additions": 42,
                "deletions": 12
            }
        ]
    });

    let decoded_response: EnrichGithubPullRequestsResponse =
        serde_json::from_value(response_json).unwrap();
    let pull_request = decoded_response.pull_requests.first().unwrap();

    assert_eq!(pull_request.comments, None);
    assert_eq!(pull_request.checks, None);
}

#[test]
fn pull_request_enrichment_preserves_reference_fields() {
    let reference = pull_request_reference();
    let enriched = EnrichedGithubPullRequest::from_reference(reference.clone());

    assert_eq!(enriched.github_key, reference.github_key);
    assert_eq!(enriched.owner, reference.owner);
    assert_eq!(enriched.repo, reference.repo);
    assert_eq!(enriched.number, reference.number);
    assert_eq!(enriched.url, reference.url);
    assert_eq!(enriched.display_name, reference.display_name);
    assert_eq!(enriched.name, None);
    assert_eq!(enriched.status, None);
    assert_eq!(enriched.additions, None);
    assert_eq!(enriched.deletions, None);
    assert_eq!(enriched.author_login, None);
    assert_eq!(enriched.author_id, None);
    assert_eq!(enriched.description, None);
    assert_eq!(enriched.comments, None);
    assert_eq!(enriched.checks, None);

    let enriched_json = serde_json::to_value(&enriched).unwrap();
    assert!(enriched_json.get("comments").is_none());
    assert!(enriched_json.get("checks").is_none());
    assert!(enriched_json.get("authorLogin").is_none());
    assert!(enriched_json.get("authorId").is_none());
    assert!(enriched_json.get("description").is_none());
}

#[test]
fn pull_request_enrichment_copies_details_fields() {
    let reference = pull_request_reference();
    let comments = vec![pull_request_comment()];
    let checks = vec![pull_request_check_run()];
    let details = GithubPullRequestDetails {
        title: "Add pull request enrichment".to_string(),
        state: "closed".to_string(),
        repository_id: None,
        merged_at: Some(utc_datetime("2026-05-25T18:54:21Z")),
        additions: 42,
        deletions: 12,
        author_login: Some("octocat".to_string()),
        author_id: Some(583231),
        description: Some("Enrich pull requests with GitHub data".to_string()),
        comments: Some(comments.clone()),
        checks: Some(checks.clone()),
        participant_github_user_ids: Some(vec!["42".to_string(), "583231".to_string()]),
        draft: None,
        requested_reviewer_github_user_ids: None,
        github_updated_at: None,
        assignees: None,
        labels: None,
        reviews: None,
        base: None,
        head: None,
    };

    let enriched = EnrichedGithubPullRequest::from_details(reference.clone(), details);

    assert_eq!(enriched.github_key, reference.github_key);
    assert_eq!(enriched.owner, reference.owner);
    assert_eq!(enriched.repo, reference.repo);
    assert_eq!(enriched.number, reference.number);
    assert_eq!(enriched.url, reference.url);
    assert_eq!(enriched.display_name, reference.display_name);
    assert_eq!(
        enriched.name,
        Some("Add pull request enrichment".to_string())
    );
    assert_eq!(enriched.status, Some(GithubPullRequestStatus::Merged));
    assert_eq!(enriched.additions, Some(42));
    assert_eq!(enriched.deletions, Some(12));
    assert_eq!(enriched.author_login, Some("octocat".to_string()));
    assert_eq!(enriched.author_id, Some(583231));
    assert_eq!(
        enriched.description,
        Some("Enrich pull requests with GitHub data".to_string())
    );
    assert_eq!(enriched.comments, Some(comments));
    assert_eq!(enriched.checks, Some(checks));
    assert_eq!(
        enriched.participant_github_user_ids,
        Some(vec!["42".to_string(), "583231".to_string()])
    );
}

#[test]
fn pull_request_foreign_entity_metadata_serializes_enriched_pull_request() {
    assert_eq!(
        GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
        "github_pull_request"
    );

    let reference = pull_request_reference();
    let details = GithubPullRequestDetails {
        title: "Add pull request enrichment".to_string(),
        state: "closed".to_string(),
        repository_id: None,
        merged_at: Some(utc_datetime("2026-05-25T18:54:21Z")),
        additions: 42,
        deletions: 12,
        author_login: Some("octocat".to_string()),
        author_id: Some(583231),
        description: Some("Enrich pull requests with GitHub data".to_string()),
        comments: Some(vec![pull_request_comment()]),
        checks: Some(vec![pull_request_check_run()]),
        participant_github_user_ids: None,
        draft: None,
        requested_reviewer_github_user_ids: None,
        github_updated_at: None,
        assignees: None,
        labels: None,
        reviews: None,
        base: None,
        head: None,
    };
    let enriched = EnrichedGithubPullRequest::from_details(reference, details);

    let metadata = enriched.foreign_entity_metadata(None).unwrap();

    assert_eq!(
        metadata,
        serde_json::json!({
            "githubKey": "macro/app/pull/7",
            "owner": "macro",
            "repo": "app",
            "number": 7,
            "url": "https://github.com/macro/app/pull/7",
            "displayName": "macro/app#7",
            "name": "Add pull request enrichment",
            "status": "merged",
            "additions": 42,
            "deletions": 12,
            "authorLogin": "octocat",
            "authorId": 583231,
            "description": "Enrich pull requests with GitHub data",
            "comments": [
                {
                    "id": 101,
                    "body": "Looks good to me",
                    "authorLogin": "octocat",
                    "authorAssociation": "MEMBER",
                    "url": "https://github.com/macro/app/pull/7#issuecomment-101",
                    "createdAt": "2026-05-25T18:54:21Z",
                    "updatedAt": "2026-05-25T19:00:00Z",
                    "source": "issue_comment"
                }
            ],
            "checks": [
                {
                    "id": 202,
                    "name": "ci",
                    "status": "completed",
                    "conclusion": "success",
                    "url": "https://github.com/macro/app/actions/runs/202",
                    "startedAt": "2026-05-25T18:55:00Z",
                    "completedAt": "2026-05-25T18:59:00Z"
                }
            ]
        })
    );
}

#[test]
fn pull_request_foreign_entity_metadata_preserves_existing_arrays_when_refresh_omits_them() {
    let enriched = EnrichedGithubPullRequest::from_details(
        pull_request_reference(),
        pull_request_details("open", None),
    );
    let existing_metadata = serde_json::json!({
        "comments": [
            {
                "id": 303,
                "body": "Existing comment"
            }
        ],
        "checks": [
            {
                "id": 404,
                "name": "existing-ci"
            }
        ]
    });

    let metadata = enriched
        .foreign_entity_metadata(Some(&existing_metadata))
        .unwrap();

    assert_eq!(
        metadata,
        serde_json::json!({
            "githubKey": "macro/app/pull/7",
            "owner": "macro",
            "repo": "app",
            "number": 7,
            "url": "https://github.com/macro/app/pull/7",
            "displayName": "macro/app#7",
            "name": "Add pull request enrichment",
            "status": "open",
            "additions": 42,
            "deletions": 12,
            "authorLogin": "octocat",
            "authorId": 583231,
            "description": "Enrich pull requests with GitHub data",
            "comments": [
                {
                    "id": 303,
                    "body": "Existing comment"
                }
            ],
            "checks": [
                {
                    "id": 404,
                    "name": "existing-ci"
                }
            ]
        })
    );
}

#[test]
fn pull_request_foreign_entity_metadata_keeps_fresh_arrays() {
    let comments = vec![pull_request_comment()];
    let checks = vec![pull_request_check_run()];
    let details = GithubPullRequestDetails {
        title: "Add pull request enrichment".to_string(),
        state: "open".to_string(),
        repository_id: None,
        merged_at: None,
        additions: 42,
        deletions: 12,
        author_login: None,
        author_id: None,
        description: None,
        comments: Some(comments.clone()),
        checks: Some(checks.clone()),
        participant_github_user_ids: None,
        draft: None,
        requested_reviewer_github_user_ids: None,
        github_updated_at: None,
        assignees: None,
        labels: None,
        reviews: None,
        base: None,
        head: None,
    };
    let enriched = EnrichedGithubPullRequest::from_details(pull_request_reference(), details);
    let existing_metadata = serde_json::json!({
        "comments": [{ "id": 303, "body": "Existing comment" }],
        "checks": [{ "id": 404, "name": "existing-ci" }]
    });
    let fresh_comments = serde_json::to_value(&comments).unwrap();
    let fresh_checks = serde_json::to_value(&checks).unwrap();

    let metadata = enriched
        .foreign_entity_metadata(Some(&existing_metadata))
        .unwrap();

    assert_eq!(metadata.get("comments"), Some(&fresh_comments));
    assert_eq!(metadata.get("checks"), Some(&fresh_checks));
}

#[test]
fn pull_request_foreign_entity_metadata_carries_existing_author_and_description_forward() {
    let mut details = pull_request_details("open", None);
    details.author_login = None;
    details.author_id = None;
    details.description = None;
    let enriched = EnrichedGithubPullRequest::from_details(pull_request_reference(), details);
    let existing_metadata = serde_json::json!({
        "authorLogin": "octocat",
        "authorId": 583231,
        "description": "Existing description"
    });

    let metadata = enriched
        .foreign_entity_metadata(Some(&existing_metadata))
        .unwrap();

    assert_eq!(
        metadata.get("authorLogin"),
        Some(&serde_json::json!("octocat"))
    );
    assert_eq!(metadata.get("authorId"), Some(&serde_json::json!(583231)));
    assert_eq!(
        metadata.get("description"),
        Some(&serde_json::json!("Existing description"))
    );
}

#[test]
fn pull_request_foreign_entity_metadata_keeps_fresh_author_and_description() {
    let enriched = EnrichedGithubPullRequest::from_details(
        pull_request_reference(),
        pull_request_details("open", None),
    );
    let existing_metadata = serde_json::json!({
        "authorLogin": "stale-login",
        "authorId": 1,
        "description": "Stale description"
    });

    let metadata = enriched
        .foreign_entity_metadata(Some(&existing_metadata))
        .unwrap();

    assert_eq!(
        metadata.get("authorLogin"),
        Some(&serde_json::json!("octocat"))
    );
    assert_eq!(metadata.get("authorId"), Some(&serde_json::json!(583231)));
    assert_eq!(
        metadata.get("description"),
        Some(&serde_json::json!("Enrich pull requests with GitHub data"))
    );
}

#[test]
fn pull_request_foreign_entity_metadata_unions_participants_with_existing() {
    let mut details = pull_request_details("open", None);
    details.participant_github_user_ids = Some(vec!["42".to_string(), "99".to_string()]);
    let enriched = EnrichedGithubPullRequest::from_details(pull_request_reference(), details);
    let existing_metadata = serde_json::json!({
        "participantGithubUserIds": ["7", "42"]
    });

    let metadata = enriched
        .foreign_entity_metadata(Some(&existing_metadata))
        .unwrap();

    assert_eq!(
        metadata.get("participantGithubUserIds"),
        Some(&serde_json::json!(["42", "7", "99"]))
    );
}

#[test]
fn pull_request_foreign_entity_metadata_carries_existing_participants_forward() {
    let enriched = EnrichedGithubPullRequest::from_details(
        pull_request_reference(),
        pull_request_details("open", None),
    );
    let existing_metadata = serde_json::json!({
        "participantGithubUserIds": ["7"]
    });

    let metadata = enriched
        .foreign_entity_metadata(Some(&existing_metadata))
        .unwrap();

    assert_eq!(
        metadata.get("participantGithubUserIds"),
        Some(&serde_json::json!(["7"]))
    );
}

fn review(
    reviewer: &str,
    state: GithubPullRequestReviewState,
    minute: u32,
) -> GithubPullRequestReview {
    GithubPullRequestReview {
        reviewer_github_user_id: reviewer.to_string(),
        reviewer_login: None,
        state,
        submitted_at: Some(
            chrono::DateTime::parse_from_rfc3339(&format!("2026-09-26T12:{minute:02}:00Z"))
                .unwrap()
                .with_timezone(&chrono::Utc),
        ),
    }
}

#[test]
fn decisions_outrank_comments_in_both_orders() {
    use GithubPullRequestReviewState::{Approved, ChangesRequested, Commented, Dismissed};

    for state in [Approved, ChangesRequested, Dismissed] {
        for (decision_minute, comment_minute) in [(1, 2), (2, 1)] {
            let decision = review("8", state, decision_minute);
            let comment = review("8", Commented, comment_minute);
            for reviews in [
                [decision.clone(), comment.clone()],
                [comment.clone(), decision.clone()],
            ] {
                assert_eq!(latest_reviews(reviews), vec![decision.clone()]);
            }
        }
    }
}

#[test]
fn decisions_outrank_comments_with_missing_timestamps() {
    use GithubPullRequestReviewState::{Approved, ChangesRequested, Commented, Dismissed};

    for state in [Approved, ChangesRequested, Dismissed] {
        for (decision_missing_time, comment_missing_time) in
            [(true, false), (false, true), (true, true)]
        {
            let mut decision = review("8", state, 1);
            let mut comment = review("8", Commented, 2);
            if decision_missing_time {
                decision.submitted_at = None;
            }
            if comment_missing_time {
                comment.submitted_at = None;
            }
            for reviews in [
                [decision.clone(), comment.clone()],
                [comment.clone(), decision.clone()],
            ] {
                assert_eq!(latest_reviews(reviews), vec![decision.clone()]);
            }
        }
    }
}

#[test]
fn decisions_keep_timestamp_ordering_in_both_orders() {
    use GithubPullRequestReviewState::{Approved, ChangesRequested, Dismissed};

    for (earlier, later) in [
        (Approved, ChangesRequested),
        (ChangesRequested, Dismissed),
        (Dismissed, Approved),
    ] {
        let earlier = review("8", earlier, 1);
        let later = review("8", later, 2);
        for reviews in [
            [earlier.clone(), later.clone()],
            [later.clone(), earlier.clone()],
        ] {
            assert_eq!(latest_reviews(reviews), vec![later.clone()]);
        }
    }
}

#[test]
fn timed_decisions_outrank_untimed_decisions_in_both_orders() {
    use GithubPullRequestReviewState::{Approved, ChangesRequested, Dismissed};

    for (untimed, timed) in [
        (Approved, ChangesRequested),
        (ChangesRequested, Dismissed),
        (Dismissed, Approved),
    ] {
        let mut untimed = review("8", untimed, 1);
        untimed.submitted_at = None;
        let timed = review("8", timed, 2);
        for reviews in [
            [untimed.clone(), timed.clone()],
            [timed.clone(), untimed.clone()],
        ] {
            assert_eq!(latest_reviews(reviews), vec![timed.clone()]);
        }
    }
}

#[test]
fn a_later_comment_does_not_replace_an_approval() {
    let latest = latest_reviews([
        review("8", GithubPullRequestReviewState::Approved, 1),
        review("8", GithubPullRequestReviewState::Commented, 2),
        review("9", GithubPullRequestReviewState::Commented, 1),
        review("9", GithubPullRequestReviewState::ChangesRequested, 2),
    ]);

    assert_eq!(
        latest.iter().map(|review| review.state).collect::<Vec<_>>(),
        vec![
            GithubPullRequestReviewState::Approved,
            GithubPullRequestReviewState::ChangesRequested,
        ]
    );
}

#[test]
fn a_dismissal_replaces_an_approval() {
    let latest = latest_reviews([
        review("8", GithubPullRequestReviewState::Approved, 1),
        review("8", GithubPullRequestReviewState::Dismissed, 1),
    ]);

    assert_eq!(latest[0].state, GithubPullRequestReviewState::Dismissed);
}

#[test]
fn review_decision_prefers_changes_requested_then_approval_then_requests() {
    use GithubPullRequestReviewState::{Approved, ChangesRequested, Commented};
    let requested = vec!["10".to_string()];

    assert_eq!(
        GithubPullRequestReviewDecision::derive(
            &[review("8", Approved, 1), review("9", ChangesRequested, 1)],
            &requested
        ),
        Some(GithubPullRequestReviewDecision::ChangesRequested)
    );
    assert_eq!(
        GithubPullRequestReviewDecision::derive(&[review("8", Approved, 1)], &requested),
        Some(GithubPullRequestReviewDecision::Approved)
    );
    assert_eq!(
        GithubPullRequestReviewDecision::derive(&[review("8", Commented, 1)], &requested),
        Some(GithubPullRequestReviewDecision::ReviewRequired)
    );
    assert_eq!(
        GithubPullRequestReviewDecision::derive(&[review("8", Commented, 1)], &[]),
        None
    );
}

#[test]
fn stored_reviews_merge_per_reviewer() {
    let mut existing = EnrichedGithubPullRequest::from_reference(pull_request_reference());
    existing.reviews = Some(vec![
        review("8", GithubPullRequestReviewState::Approved, 1),
        review("9", GithubPullRequestReviewState::Commented, 1),
    ]);
    let existing = existing.foreign_entity_metadata(None).unwrap();
    let mut incoming = EnrichedGithubPullRequest::from_reference(pull_request_reference());
    incoming.reviews = Some(vec![review(
        "9",
        GithubPullRequestReviewState::ChangesRequested,
        2,
    )]);

    let merged = incoming.foreign_entity_metadata(Some(&existing)).unwrap();
    let row = GithubPullRequestRow::from_metadata(&merged).unwrap();

    assert_eq!(
        row.reviews
            .iter()
            .map(|review| (review.reviewer_github_user_id.as_str(), review.state))
            .collect::<Vec<_>>(),
        vec![
            ("8", GithubPullRequestReviewState::Approved),
            ("9", GithubPullRequestReviewState::ChangesRequested),
        ]
    );
    assert_eq!(
        row.review_decision,
        Some(GithubPullRequestReviewDecision::ChangesRequested)
    );
}

#[test]
fn stored_comments_do_not_hide_incoming_review_decisions() {
    use GithubPullRequestReviewState::{Approved, ChangesRequested, Commented, Dismissed};

    for (state, expected_decision) in [
        (Approved, Some(GithubPullRequestReviewDecision::Approved)),
        (
            ChangesRequested,
            Some(GithubPullRequestReviewDecision::ChangesRequested),
        ),
        (Dismissed, None),
    ] {
        let decision = review("8", state, 1);
        let comment = review("8", Commented, 2);
        for (stored, incoming) in [
            (comment.clone(), decision.clone()),
            (decision.clone(), comment.clone()),
        ] {
            let mut existing = EnrichedGithubPullRequest::from_reference(pull_request_reference());
            existing.reviews = Some(vec![stored]);
            let existing = existing.foreign_entity_metadata(None).unwrap();
            let mut updated = EnrichedGithubPullRequest::from_reference(pull_request_reference());
            updated.reviews = Some(vec![incoming]);

            let metadata = updated.foreign_entity_metadata(Some(&existing)).unwrap();
            let row = GithubPullRequestRow::from_metadata(&metadata).unwrap();

            assert_eq!(row.reviews, vec![decision.clone()]);
            assert_eq!(row.review_decision, expected_decision);
        }
    }
}

fn stored_record(pull_request: &EnrichedGithubPullRequest) -> ForeignEntity {
    ForeignEntity {
        id: uuid::Uuid::nil(),
        foreign_entity_id: pull_request.github_key.clone(),
        foreign_entity_source: GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE.to_string(),
        metadata: pull_request.foreign_entity_metadata(None).unwrap(),
        stored_for_id: "macro|viewer@example.com".to_string(),
        stored_for_auth_entity: "user".to_string(),
        created_at: utc_datetime("2026-05-25T18:54:21Z"),
        updated_at: utc_datetime("2026-05-25T18:54:21Z"),
    }
}

#[test]
fn stored_response_falls_back_to_record_status_without_overriding_a_known_row_status() {
    let mut pull_request = EnrichedGithubPullRequest::from_reference(pull_request_reference());
    pull_request.status = Some(GithubPullRequestStatus::Open);
    let record = stored_record(&pull_request);
    let mut row = GithubPullRequestRow::from_metadata(&record.metadata).unwrap();
    row.status = None;
    assert_eq!(
        StoredGithubPullRequest::from_record(&record, Some(row.clone()))
            .unwrap()
            .status,
        Some(GithubPullRequestStatus::Open)
    );
    row.status = Some(GithubPullRequestStatus::Merged);
    assert_eq!(
        StoredGithubPullRequest::from_record(&record, Some(row))
            .unwrap()
            .status,
        Some(GithubPullRequestStatus::Merged)
    );
}

#[test]
fn stored_response_url_follows_the_row_repository_identity() {
    let record = stored_record(&EnrichedGithubPullRequest::from_reference(
        pull_request_reference(),
    ));
    let mut row = GithubPullRequestRow::from_metadata(&record.metadata).unwrap();
    row.owner = "current-owner".to_string();
    row.repo = "renamed".to_string();
    row.github_key = "current-owner/renamed/pull/7".to_string();
    let response = StoredGithubPullRequest::from_record(&record, Some(row)).unwrap();
    assert_eq!(
        response.url,
        "https://github.com/current-owner/renamed/pull/7"
    );
    assert_eq!(response.github_key, "current-owner/renamed/pull/7");
    assert_eq!(
        record.metadata["url"],
        "https://github.com/macro/app/pull/7"
    );
}

#[test]
fn stored_response_without_a_row_uses_the_record_identity_and_status() {
    let mut pull_request = EnrichedGithubPullRequest::from_reference(pull_request_reference());
    pull_request.status = Some(GithubPullRequestStatus::Closed);
    let response =
        StoredGithubPullRequest::from_record(&stored_record(&pull_request), None).unwrap();
    assert_eq!(response.url, pull_request.url);
    assert_eq!(response.status, Some(GithubPullRequestStatus::Closed));
}

#[test]
fn stored_comment_author_ids_intentionally_remain_json_integers() {
    let mut pull_request = EnrichedGithubPullRequest::from_reference(pull_request_reference());
    pull_request.author_id = Some(583231);
    let mut comment = pull_request_comment();
    comment.author_id = Some(583231);
    pull_request.comments = Some(vec![comment]);
    let response =
        StoredGithubPullRequest::from_record(&stored_record(&pull_request), None).unwrap();
    let wire = serde_json::to_value(response).unwrap();
    assert_eq!(wire["authorGithubUserId"], "583231");
    assert_eq!(wire["comments"][0]["authorId"], serde_json::json!(583231));
}
#[test]
fn stored_refs_carry_forward_when_a_write_omits_them() {
    let mut stored = EnrichedGithubPullRequest::from_reference(pull_request_reference());
    stored.base = Some(GitRef {
        name: Some("main".to_string()),
        sha: Some("base-sha".to_string()),
    });
    stored.head = Some(GitRef {
        name: Some("feature".to_string()),
        sha: Some("head-sha".to_string()),
    });
    let existing = stored.foreign_entity_metadata(None).unwrap();

    let merged = EnrichedGithubPullRequest::from_reference(pull_request_reference())
        .foreign_entity_metadata(Some(&existing))
        .unwrap();
    let row = GithubPullRequestRow::from_metadata(&merged).unwrap();

    assert_eq!(
        row.base.and_then(|base| base.sha).as_deref(),
        Some("base-sha")
    );
    assert_eq!(
        row.head.and_then(|head| head.name).as_deref(),
        Some("feature")
    );
}
