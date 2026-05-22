use super::*;

#[test]
fn test_github_key() {
    let key = GithubKey::new("rust-lang", "rust", 12345);
    assert_eq!(key.as_ref(), "rust-lang/rust/pull/12345");
    assert_eq!(key.to_string(), "rust-lang/rust/pull/12345");
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
