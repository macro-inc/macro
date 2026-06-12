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
        merged_at,
        additions: 42,
        deletions: 12,
        comments: None,
        checks: None,
        participant_github_user_ids: None,
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
            number: reference.number,
            url: reference.url,
            display_name: reference.display_name,
            name: Some("Add pull request enrichment".to_string()),
            status: Some(GithubPullRequestStatus::Merged),
            additions: Some(42),
            deletions: Some(12),
            comments: Some(vec![pull_request_comment()]),
            checks: Some(vec![pull_request_check_run()]),
            participant_github_user_ids: None,
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
    assert_eq!(enriched.comments, None);
    assert_eq!(enriched.checks, None);

    let enriched_json = serde_json::to_value(&enriched).unwrap();
    assert!(enriched_json.get("comments").is_none());
    assert!(enriched_json.get("checks").is_none());
}

#[test]
fn pull_request_enrichment_copies_details_fields() {
    let reference = pull_request_reference();
    let comments = vec![pull_request_comment()];
    let checks = vec![pull_request_check_run()];
    let details = GithubPullRequestDetails {
        title: "Add pull request enrichment".to_string(),
        state: "closed".to_string(),
        merged_at: Some(utc_datetime("2026-05-25T18:54:21Z")),
        additions: 42,
        deletions: 12,
        comments: Some(comments.clone()),
        checks: Some(checks.clone()),
        participant_github_user_ids: Some(vec!["42".to_string(), "583231".to_string()]),
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
        merged_at: Some(utc_datetime("2026-05-25T18:54:21Z")),
        additions: 42,
        deletions: 12,
        comments: Some(vec![pull_request_comment()]),
        checks: Some(vec![pull_request_check_run()]),
        participant_github_user_ids: None,
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
        merged_at: None,
        additions: 42,
        deletions: 12,
        comments: Some(comments.clone()),
        checks: Some(checks.clone()),
        participant_github_user_ids: None,
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

// ---------------------------------------------------------------------------
// MacroTaskId::from_short_uuid
// ---------------------------------------------------------------------------

#[test]
fn from_short_uuid_valid() {
    let task_id = MacroTaskId::from_short_uuid("2BuyvtY3ae").unwrap();
    assert_eq!(task_id.short_uuid, "2BuyvtY3ae");
}

#[test]
fn from_short_uuid_rejects_empty() {
    assert!(MacroTaskId::from_short_uuid("").is_none());
}

#[test]
fn from_short_uuid_rejects_invalid_chars() {
    // 'O', 'I', 'l', '0' are not in Flickr base58
    assert!(MacroTaskId::from_short_uuid("OOOOO").is_none());
    assert!(MacroTaskId::from_short_uuid("IIIlll").is_none());
    assert!(MacroTaskId::from_short_uuid("000abc").is_none());
}

#[test]
fn from_short_uuid_rejects_too_long() {
    let long = "a".repeat(25);
    assert!(MacroTaskId::from_short_uuid(&long).is_none());
}

// ---------------------------------------------------------------------------
// MacroTaskId::from_uuid / to_uuid roundtrip
// ---------------------------------------------------------------------------

#[test]
fn roundtrip_uuid_conversion() {
    let uuid = uuid::Uuid::parse_str("0d0dc589-f301-43f1-8b11-4ab448ca4bb4").unwrap();
    let task_id = MacroTaskId::from_uuid(&uuid);
    assert_eq!(task_id.short_uuid, "2BuyvtY3aeEvHx4uG8iD51");

    let recovered = task_id.to_uuid().unwrap();
    assert_eq!(uuid, recovered);
}

#[test]
fn to_task_id_string() {
    let task_id = MacroTaskId::from_short_uuid("2BuyvtY3ae").unwrap();
    assert_eq!(task_id.to_task_id_string(), "MACRO-2BuyvtY3ae");
}

#[test]
fn display_impl() {
    let task_id = MacroTaskId::from_short_uuid("abc123").unwrap();
    assert_eq!(format!("{task_id}"), "MACRO-abc123");
}

// ---------------------------------------------------------------------------
// MacroTaskId::extract_from_text
// ---------------------------------------------------------------------------

#[test]
fn extract_case_insensitive() {
    let text = "fixes MACRO-2BuyvtY3ae and also macro-abc123 and Macro-XYZ";
    let ids = MacroTaskId::extract_from_text(text);
    assert_eq!(ids.len(), 3);
    assert_eq!(ids[0].short_uuid, "2BuyvtY3ae");
    assert_eq!(ids[1].short_uuid, "abc123");
    // "XYZ" is valid base58
    assert_eq!(ids[2].short_uuid, "XYZ");
}

#[test]
fn extract_deduplicates() {
    let text = "MACRO-abc123 and macro-abc123 again MACRO-abc123";
    let ids = MacroTaskId::extract_from_text(text);
    // Same short UUID captured, only first occurrence kept
    assert_eq!(ids.len(), 1);
    assert_eq!(ids[0].short_uuid, "abc123");
}

#[test]
fn extract_no_match() {
    let text = "no task ids here, just MACR-123 or MACRO- or MACRO";
    let ids = MacroTaskId::extract_from_text(text);
    assert!(ids.is_empty());
}

#[test]
fn extract_ignores_invalid_base58_chars() {
    // '0', 'O', 'I', 'l' are not in Flickr base58
    // "MACRO-000abc" -> regex captures "000abc" but from_short_uuid rejects it
    let text = "MACRO-000abc";
    let ids = MacroTaskId::extract_from_text(text);
    assert!(ids.is_empty());
}

#[test]
fn extract_from_branch_name() {
    let text = "feature/macro-2BuyvtY3ae";
    let ids = MacroTaskId::extract_from_text(text);
    assert_eq!(ids.len(), 1);
    assert_eq!(ids[0].short_uuid, "2BuyvtY3ae");
}

#[test]
fn extract_multiple_in_sentence() {
    let text = "closes MACRO-aaa111 and MACRO-bbb222";
    let ids = MacroTaskId::extract_from_text(text);
    assert_eq!(ids.len(), 2);
    assert_eq!(ids[0].short_uuid, "aaa111");
    assert_eq!(ids[1].short_uuid, "bbb222");
}

// ---------------------------------------------------------------------------
// TeamTaskReference::extract_from_text
// ---------------------------------------------------------------------------

#[test]
fn extract_team_task_reference_from_branch_name() {
    let refs = TeamTaskReference::extract_from_text("whutch/eng-123-fix-the-thing");
    assert_eq!(refs, vec![TeamTaskReference::new("eng", 123).unwrap()]);
}

#[test]
fn extract_team_task_reference_case_insensitive_and_dedupes() {
    let refs = TeamTaskReference::extract_from_text("ENG-123 eng-123 platform_api-7");
    assert_eq!(refs.len(), 2);
    assert_eq!(refs[0], TeamTaskReference::new("eng", 123).unwrap());
    assert_eq!(refs[1], TeamTaskReference::new("platform_api", 7).unwrap());
}

#[test]
fn extract_team_task_reference_rejects_invalid_numbers() {
    let refs = TeamTaskReference::extract_from_text("eng-0 eng-abc eng-999999999999999999999");
    assert!(refs.is_empty());
}

// ---------------------------------------------------------------------------
// ValidatedGithubWebhookEvent::pull_number / repo_owner / repo_name / installation_id
// ---------------------------------------------------------------------------

#[test]
fn pull_number_from_pull_request() {
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "pull_request": { "number": 42 }
        }),
    );
    assert_eq!(event.pull_number(), Some(42));
}

#[test]
fn pull_number_from_issue() {
    let event = ValidatedGithubWebhookEvent::new(
        "issue_comment".to_string(),
        serde_json::json!({
            "issue": { "number": 99 }
        }),
    );
    assert_eq!(event.pull_number(), Some(99));
}

#[test]
fn pull_number_prefers_pull_request_over_issue() {
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "pull_request": { "number": 1 },
            "issue": { "number": 2 }
        }),
    );
    assert_eq!(event.pull_number(), Some(1));
}

#[test]
fn pull_number_missing() {
    let event =
        ValidatedGithubWebhookEvent::new("ping".to_string(), serde_json::json!({"zen": "hello"}));
    assert_eq!(event.pull_number(), None);
}

#[test]
fn repo_owner_present() {
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "repository": { "owner": { "login": "my-org" }, "name": "my-repo" }
        }),
    );
    assert_eq!(event.repo_owner(), Some("my-org"));
}

#[test]
fn repo_owner_missing() {
    let event = ValidatedGithubWebhookEvent::new("pull_request".to_string(), serde_json::json!({}));
    assert_eq!(event.repo_owner(), None);
}

#[test]
fn repo_name_present() {
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "repository": { "name": "cool-repo", "owner": { "login": "x" } }
        }),
    );
    assert_eq!(event.repo_name(), Some("cool-repo"));
}

#[test]
fn repo_name_missing() {
    let event = ValidatedGithubWebhookEvent::new("pull_request".to_string(), serde_json::json!({}));
    assert_eq!(event.repo_name(), None);
}

#[test]
fn installation_id_present() {
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "installation": { "id": 12345 }
        }),
    );
    assert_eq!(event.installation_id(), Some(12345));
}

#[test]
fn installation_id_missing() {
    let event = ValidatedGithubWebhookEvent::new("pull_request".to_string(), serde_json::json!({}));
    assert_eq!(event.installation_id(), None);
}

// ---------------------------------------------------------------------------
// GithubWebhookEventType::from_event_header
// ---------------------------------------------------------------------------

#[test]
fn event_type_from_known_headers() {
    assert_eq!(
        GithubWebhookEventType::from_event_header("pull_request"),
        GithubWebhookEventType::PullRequest
    );
    assert_eq!(
        GithubWebhookEventType::from_event_header("issue_comment"),
        GithubWebhookEventType::IssueComment
    );
    assert_eq!(
        GithubWebhookEventType::from_event_header("pull_request_review"),
        GithubWebhookEventType::PullRequestReview
    );
    assert_eq!(
        GithubWebhookEventType::from_event_header("pull_request_review_comment"),
        GithubWebhookEventType::PullRequestReviewComment
    );
}

#[test]
fn event_type_unknown() {
    assert_eq!(
        GithubWebhookEventType::from_event_header("ping"),
        GithubWebhookEventType::Unknown("ping".to_string())
    );
    assert_eq!(
        GithubWebhookEventType::from_event_header("push"),
        GithubWebhookEventType::Unknown("push".to_string())
    );
}

// ---------------------------------------------------------------------------
// ValidatedGithubWebhookEvent::extract_searchable_text
// ---------------------------------------------------------------------------

#[test]
fn extract_text_pull_request() {
    let payload = serde_json::json!({
        "action": "opened",
        "pull_request": {
            "title": "fixes MACRO-abc123",
            "body": "This PR closes MACRO-def456",
            "head": {
                "ref": "feature/macro-ghi789"
            }
        }
    });
    let event = ValidatedGithubWebhookEvent::new("pull_request".to_string(), payload);
    let texts = event.extract_searchable_text();
    assert_eq!(texts.len(), 3);
    assert_eq!(texts[0], "fixes MACRO-abc123");
    assert_eq!(texts[1], "This PR closes MACRO-def456");
    assert_eq!(texts[2], "feature/macro-ghi789");
}

#[test]
fn extract_text_pull_request_null_body() {
    let payload = serde_json::json!({
        "action": "opened",
        "pull_request": {
            "title": "some title",
            "body": null,
            "head": {
                "ref": "main"
            }
        }
    });
    let event = ValidatedGithubWebhookEvent::new("pull_request".to_string(), payload);
    let texts = event.extract_searchable_text();
    assert_eq!(texts.len(), 2);
    assert_eq!(texts[0], "some title");
    assert_eq!(texts[1], "main");
}

#[test]
fn extract_text_issue_comment() {
    let payload = serde_json::json!({
        "action": "created",
        "comment": {
            "body": "See MACRO-abc123 for details"
        }
    });
    let event = ValidatedGithubWebhookEvent::new("issue_comment".to_string(), payload);
    let texts = event.extract_searchable_text();
    assert_eq!(texts.len(), 1);
    assert_eq!(texts[0], "See MACRO-abc123 for details");
}

#[test]
fn extract_text_pull_request_review() {
    let payload = serde_json::json!({
        "action": "submitted",
        "review": {
            "body": "Looks good, relates to MACRO-xyz789"
        }
    });
    let event = ValidatedGithubWebhookEvent::new("pull_request_review".to_string(), payload);
    let texts = event.extract_searchable_text();
    assert_eq!(texts.len(), 1);
    assert_eq!(texts[0], "Looks good, relates to MACRO-xyz789");
}

#[test]
fn extract_text_pull_request_review_comment() {
    let payload = serde_json::json!({
        "action": "created",
        "comment": {
            "body": "This line relates to MACRO-abc123"
        }
    });
    let event =
        ValidatedGithubWebhookEvent::new("pull_request_review_comment".to_string(), payload);
    let texts = event.extract_searchable_text();
    assert_eq!(texts.len(), 1);
    assert_eq!(texts[0], "This line relates to MACRO-abc123");
}

#[test]
fn extract_text_unknown_event() {
    let payload = serde_json::json!({"zen": "Keep it logically awesome."});
    let event = ValidatedGithubWebhookEvent::new("ping".to_string(), payload);
    let texts = event.extract_searchable_text();
    assert!(texts.is_empty());
}

// ---------------------------------------------------------------------------
// ValidatedGithubWebhookEvent::extract_pr_context_text
// ---------------------------------------------------------------------------

#[test]
fn pr_context_empty_for_pull_request_event() {
    let payload = serde_json::json!({
        "action": "opened",
        "pull_request": {
            "title": "fixes MACRO-abc123",
            "body": "body text",
            "head": { "ref": "feature/macro-abc123" }
        }
    });
    let event = ValidatedGithubWebhookEvent::new("pull_request".to_string(), payload);
    assert!(event.extract_pr_context_text().is_empty());
}

#[test]
fn pr_context_from_issue_comment() {
    let payload = serde_json::json!({
        "action": "created",
        "issue": {
            "title": "PR title with MACRO-abc123",
            "body": "PR body with MACRO-def456",
            "pull_request": {},
            "head": { "ref": "feature/macro-ghi789" }
        },
        "comment": {
            "body": "Fixes MACRO-abc123"
        }
    });
    let event = ValidatedGithubWebhookEvent::new("issue_comment".to_string(), payload);
    let texts = event.extract_pr_context_text();
    assert_eq!(texts.len(), 3);
    assert_eq!(texts[0], "PR title with MACRO-abc123");
    assert_eq!(texts[1], "PR body with MACRO-def456");
    assert_eq!(texts[2], "feature/macro-ghi789");
}

#[test]
fn pr_context_from_review() {
    let payload = serde_json::json!({
        "action": "submitted",
        "pull_request": {
            "title": "MACRO-abc123 fix",
            "body": null,
            "head": { "ref": "main" }
        },
        "review": {
            "body": "Relates to MACRO-abc123"
        }
    });
    let event = ValidatedGithubWebhookEvent::new("pull_request_review".to_string(), payload);
    let texts = event.extract_pr_context_text();
    assert_eq!(texts.len(), 2);
    assert_eq!(texts[0], "MACRO-abc123 fix");
    assert_eq!(texts[1], "main");
}

#[test]
fn pr_context_from_review_comment() {
    let payload = serde_json::json!({
        "action": "created",
        "pull_request": {
            "title": "MACRO-abc123 fix",
            "body": "details",
            "head": { "ref": "feature/macro-abc123" }
        },
        "comment": {
            "body": "This line relates to MACRO-abc123"
        }
    });
    let event =
        ValidatedGithubWebhookEvent::new("pull_request_review_comment".to_string(), payload);
    let texts = event.extract_pr_context_text();
    assert_eq!(texts.len(), 3);
    assert_eq!(texts[0], "MACRO-abc123 fix");
    assert_eq!(texts[1], "details");
    assert_eq!(texts[2], "feature/macro-abc123");
}

#[test]
fn pr_context_empty_for_unknown_event() {
    let payload = serde_json::json!({"zen": "Keep it logically awesome."});
    let event = ValidatedGithubWebhookEvent::new("ping".to_string(), payload);
    assert!(event.extract_pr_context_text().is_empty());
}

// ---------------------------------------------------------------------------
// extract_github_mentions
// ---------------------------------------------------------------------------

#[test]
fn github_mentions_extracts_unique_lowercased_logins() {
    let mentions = extract_github_mentions(
        "@Alice please review, cc @bob-smith and @alice again.\n@carol99: thoughts?",
    );
    assert_eq!(mentions, vec!["alice", "bob-smith", "carol99"]);
}

#[test]
fn github_mentions_ignores_emails_and_bare_at_signs() {
    let mentions = extract_github_mentions("contact me at alice@example.com or @ (nothing)");
    assert!(mentions.is_empty());
}

#[test]
fn github_mentions_matches_at_start_and_after_punctuation() {
    let mentions = extract_github_mentions("@lead-dev: see (@helper) and [@docs-team]");
    assert_eq!(mentions, vec!["docs-team", "helper", "lead-dev"]);
}

#[test]
fn github_mentions_does_not_capture_trailing_hyphen() {
    let mentions = extract_github_mentions("ping @user- and @-nobody");
    assert_eq!(mentions, vec!["user"]);
}
