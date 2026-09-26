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
