use super::*;

fn uid(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(value).unwrap().into_owned()
}

fn utc_datetime(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .unwrap()
        .with_timezone(&Utc)
}

fn github_pr_common() -> GithubPrNotificationCommon {
    GithubPrNotificationCommon {
        foreign_entity_id: Uuid::parse_str("11111111-1111-4111-8111-111111111111").unwrap(),
        github_key: "macro/app/pull/42".to_string(),
        owner: "macro".to_string(),
        repo: "app".to_string(),
        number: 42,
        url: "https://github.com/macro/app/pull/42".to_string(),
        display_name: "macro/app#42".to_string(),
        title: "Add GitHub PR notifications".to_string(),
        sender_github_login: Some("octocat".to_string()),
        sender_github_user_id: Some("12345".to_string()),
        sender_github_avatar_url: Some(
            "https://avatars.githubusercontent.com/u/12345?v=4".to_string(),
        ),
    }
}

fn github_pr_status_changed() -> GithubPrStatusChanged {
    GithubPrStatusChanged {
        common: github_pr_common(),
        status: GithubPrEventStatus::Merged,
        action: GithubPrEventAction::Closed,
        previous_status: Some(GithubPrEventStatus::Open),
        head_branch: Some("feature/github-pr-notifications".to_string()),
        base_branch: Some("main".to_string()),
        merged_at: Some(utc_datetime("2026-05-25T18:54:21Z")),
    }
}

fn github_pr_check_run(state: GithubPrCheckRunState) -> GithubPrCheckRun {
    let conclusion = match state {
        GithubPrCheckRunState::Completed => "success",
        GithubPrCheckRunState::Failed => "failure",
    };

    GithubPrCheckRun {
        common: github_pr_common(),
        check_run_github_id: 987_654_321,
        check_name: "CI / tests".to_string(),
        check_status: "completed".to_string(),
        conclusion: conclusion.to_string(),
        state,
        check_url: "https://github.com/macro/app/runs/987654321".to_string(),
        completed_at: utc_datetime("2026-05-25T19:01:02Z"),
    }
}

#[test]
fn github_pr_status_changed_serializes_with_camel_case_fields_and_lowercase_enums() {
    let event = github_pr_status_changed();

    let value = serde_json::to_value(&event).unwrap();

    assert_eq!(
        value,
        serde_json::json!({
            "foreignEntityId": "11111111-1111-4111-8111-111111111111",
            "githubKey": "macro/app/pull/42",
            "owner": "macro",
            "repo": "app",
            "number": 42,
            "url": "https://github.com/macro/app/pull/42",
            "displayName": "macro/app#42",
            "title": "Add GitHub PR notifications",
            "status": "merged",
            "action": "closed",
            "previousStatus": "open",
            "senderGithubLogin": "octocat",
            "senderGithubUserId": "12345",
            "senderGithubAvatarUrl": "https://avatars.githubusercontent.com/u/12345?v=4",
            "headBranch": "feature/github-pr-notifications",
            "baseBranch": "main",
            "mergedAt": "2026-05-25T18:54:21Z"
        })
    );
}

#[test]
fn github_pr_status_changed_tagged_content_serializes_with_type_name() {
    let event = github_pr_status_changed();
    let foreign_entity_id = event.common.foreign_entity_id.to_string();

    let value =
        serde_json::to_value(notification::domain::models::TaggedContent::new(event)).unwrap();

    assert_eq!(value["tag"], "github_pr_status_changed");
    assert_eq!(
        value["content"]["foreignEntityId"],
        serde_json::json!(foreign_entity_id)
    );
}

#[test]
fn github_pr_status_changed_formats_title_and_body() {
    let event = github_pr_status_changed();

    let title = event
        .format_title(Some(uid("macro|pr.sender@macro.com")))
        .unwrap();
    let body = event.format_body(None).unwrap();

    assert_eq!(title, "pr.sender merged a pull request");
    assert_eq!(body, "macro/app#42: Add GitHub PR notifications");
}

#[test]
fn github_pr_status_changed_title_falls_back_to_display_name() {
    assert_eq!(
        GithubPrNotificationCommon::title_or_display_name(None, "macro/app#42"),
        "macro/app#42"
    );
    assert_eq!(
        GithubPrNotificationCommon::title_or_display_name(Some(String::new()), "macro/app#42"),
        "macro/app#42"
    );
    assert_eq!(
        GithubPrNotificationCommon::title_or_display_name(
            Some("Add GitHub PR notifications".to_string()),
            "macro/app#42"
        ),
        "Add GitHub PR notifications"
    );

    let mut event = github_pr_status_changed();
    event.common.title =
        GithubPrNotificationCommon::title_or_display_name(None, &event.common.display_name);

    assert_eq!(event.format_body(None).unwrap(), "macro/app#42");
}

#[test]
fn github_pr_status_changed_notif_event_deserializes_and_renders_in_app() {
    let expected = github_pr_status_changed();
    let value = serde_json::json!({
        "tag": "github_pr_status_changed",
        "content": serde_json::to_value(&expected).unwrap(),
    });

    let event: crate::NotifEvent = serde_json::from_value(value).unwrap();

    assert_eq!(
        event
            .format_title(Some(uid("macro|pr.sender@macro.com")))
            .unwrap(),
        "pr.sender merged a pull request"
    );
    assert_eq!(
        event.format_body(None).unwrap(),
        "macro/app#42: Add GitHub PR notifications"
    );

    let crate::NotifEvent::GithubPrStatusChanged(actual) = event else {
        panic!("expected github_pr_status_changed variant");
    };
    assert_eq!(actual, expected);
}

#[test]
fn github_pr_status_changed_deserializes_from_legacy_github_pr_event_tag() {
    let expected = github_pr_status_changed();
    let value = serde_json::json!({
        "tag": "github_pr_event",
        "content": serde_json::to_value(&expected).unwrap(),
    });

    let event: crate::NotifEvent = serde_json::from_value(value).unwrap();

    let crate::NotifEvent::GithubPrStatusChanged(actual) = event else {
        panic!("expected github_pr_status_changed variant");
    };
    assert_eq!(actual, expected);
}

#[test]
fn github_pr_check_run_serializes_with_camel_case_fields_and_lowercase_state() {
    let event = github_pr_check_run(GithubPrCheckRunState::Completed);

    let value = serde_json::to_value(&event).unwrap();

    assert_eq!(
        value,
        serde_json::json!({
            "foreignEntityId": "11111111-1111-4111-8111-111111111111",
            "githubKey": "macro/app/pull/42",
            "owner": "macro",
            "repo": "app",
            "number": 42,
            "url": "https://github.com/macro/app/pull/42",
            "displayName": "macro/app#42",
            "title": "Add GitHub PR notifications",
            "senderGithubLogin": "octocat",
            "senderGithubUserId": "12345",
            "senderGithubAvatarUrl": "https://avatars.githubusercontent.com/u/12345?v=4",
            "checkRunGithubId": 987654321,
            "checkName": "CI / tests",
            "checkStatus": "completed",
            "conclusion": "success",
            "state": "completed",
            "checkUrl": "https://github.com/macro/app/runs/987654321",
            "completedAt": "2026-05-25T19:01:02Z"
        })
    );
}

#[test]
fn github_pr_check_run_tagged_content_serializes_with_type_name() {
    let event = github_pr_check_run(GithubPrCheckRunState::Completed);
    let foreign_entity_id = event.common.foreign_entity_id.to_string();

    let value =
        serde_json::to_value(notification::domain::models::TaggedContent::new(event)).unwrap();

    assert_eq!(value["tag"], "github_pr_check_run");
    assert_eq!(value["content"]["checkRunGithubId"], 987_654_321);
    assert_eq!(
        value["content"]["foreignEntityId"],
        serde_json::json!(foreign_entity_id)
    );
}

#[test]
fn github_pr_check_run_formats_title_and_body_by_state() {
    let completed = github_pr_check_run(GithubPrCheckRunState::Completed);
    let failed = github_pr_check_run(GithubPrCheckRunState::Failed);

    assert_eq!(
        completed
            .format_title(Some(uid("macro|ignored.sender@macro.com")))
            .unwrap(),
        "CI / tests completed on a pull request"
    );
    assert_eq!(
        failed.format_title(None).unwrap(),
        "CI / tests failed on a pull request"
    );
    assert_eq!(
        completed.format_body(None).unwrap(),
        "macro/app#42: Add GitHub PR notifications"
    );
}

#[test]
fn github_pr_check_run_notif_event_deserializes_and_renders_in_app() {
    let expected = github_pr_check_run(GithubPrCheckRunState::Failed);
    let value = serde_json::json!({
        "tag": "github_pr_check_run",
        "content": serde_json::to_value(&expected).unwrap(),
    });

    let event: crate::NotifEvent = serde_json::from_value(value).unwrap();

    assert_eq!(
        event.format_title(None).unwrap(),
        "CI / tests failed on a pull request"
    );
    assert_eq!(
        event.format_body(None).unwrap(),
        "macro/app#42: Add GitHub PR notifications"
    );

    let crate::NotifEvent::GithubPrCheckRun(actual) = event else {
        panic!("expected github_pr_check_run variant");
    };
    assert_eq!(actual, expected);
}

#[test]
fn github_review_requested_serializes_flat_and_formats() {
    let notification = GithubReviewRequested {
        common: github_pr_common(),
        requested_reviewer_github_login: Some("hubot".to_string()),
        requested_reviewer_github_user_id: Some("67890".to_string()),
    };

    let value = serde_json::to_value(&notification).unwrap();
    // The flattened common fields stay at the top level of the wire shape.
    assert_eq!(value["githubKey"], "macro/app/pull/42");
    assert_eq!(value["requestedReviewerGithubLogin"], "hubot");

    let tagged = serde_json::to_value(notification::domain::models::TaggedContent::new(
        notification,
    ))
    .unwrap();
    assert_eq!(tagged["tag"], "github_review_requested");

    let notification: GithubReviewRequested =
        serde_json::from_value(tagged["content"].clone()).unwrap();
    assert_eq!(
        notification
            .format_title(Some(uid("macro|pr.sender@macro.com")))
            .unwrap(),
        "pr.sender requested your review"
    );
    assert_eq!(
        notification.format_title(None).unwrap(),
        "octocat requested your review"
    );
    assert_eq!(
        notification.format_body(None).unwrap(),
        "macro/app#42: Add GitHub PR notifications"
    );
}

#[test]
fn github_pr_comment_serializes_and_formats_with_snippet() {
    let notification = GithubPrComment {
        common: github_pr_common(),
        comment_kind: GithubPrCommentKind::Issue,
        comment_github_id: Some(555),
        comment_url: Some("https://github.com/macro/app/pull/42#issuecomment-555".to_string()),
        comment_snippet: "Looks good overall".to_string(),
    };

    let value = serde_json::to_value(&notification).unwrap();
    assert_eq!(value["commentKind"], "issue");
    assert_eq!(value["displayName"], "macro/app#42");

    assert_eq!(
        serde_json::to_value(notification::domain::models::TaggedContent::new(
            notification.clone()
        ))
        .unwrap()["tag"],
        "github_pr_comment"
    );
    assert_eq!(
        notification
            .format_title(Some(uid("macro|pr.sender@macro.com")))
            .unwrap(),
        "pr.sender commented on a pull request"
    );
    assert_eq!(
        notification.format_body(None).unwrap(),
        "macro/app#42: Looks good overall"
    );

    let empty_snippet = GithubPrComment {
        comment_snippet: String::new(),
        ..notification
    };
    assert_eq!(
        empty_snippet.format_body(None).unwrap(),
        "macro/app#42: Add GitHub PR notifications"
    );
}

#[test]
fn github_pr_mention_serializes_and_formats() {
    let notification = GithubPrMention {
        common: github_pr_common(),
        location: GithubPrMentionLocation::ReviewComment,
        comment_github_id: Some(777),
        comment_url: Some("https://github.com/macro/app/pull/42#discussion_r777".to_string()),
        text_snippet: "@dev.user can you take a look?".to_string(),
    };

    let value = serde_json::to_value(&notification).unwrap();
    assert_eq!(value["location"], "review_comment");

    assert_eq!(
        serde_json::to_value(notification::domain::models::TaggedContent::new(
            notification.clone()
        ))
        .unwrap()["tag"],
        "github_pr_mention"
    );
    assert_eq!(
        notification
            .format_title(Some(uid("macro|pr.sender@macro.com")))
            .unwrap(),
        "pr.sender mentioned you on a pull request"
    );
    assert_eq!(
        notification.format_body(None).unwrap(),
        "macro/app#42: @dev.user can you take a look?"
    );
}

#[test]
fn github_pr_review_serializes_and_formats_by_state() {
    let notification = GithubPrReview {
        common: github_pr_common(),
        review_github_id: Some(888),
        review_url: Some("https://github.com/macro/app/pull/42#pullrequestreview-888".to_string()),
        state: GithubPrReviewState::ChangesRequested,
        review_snippet: Some("Please add tests".to_string()),
    };

    let value = serde_json::to_value(&notification).unwrap();
    assert_eq!(value["state"], "changes_requested");

    assert_eq!(
        serde_json::to_value(notification::domain::models::TaggedContent::new(
            notification.clone()
        ))
        .unwrap()["tag"],
        "github_pr_review"
    );
    assert_eq!(
        notification
            .format_title(Some(uid("macro|pr.sender@macro.com")))
            .unwrap(),
        "pr.sender requested changes on your pull request"
    );
    assert_eq!(
        notification.format_body(None).unwrap(),
        "macro/app#42: Please add tests"
    );

    let approved = GithubPrReview {
        state: GithubPrReviewState::Approved,
        review_snippet: None,
        ..notification
    };
    assert_eq!(
        approved.format_title(None).unwrap(),
        "octocat approved your pull request"
    );
    assert_eq!(
        approved.format_body(None).unwrap(),
        "macro/app#42: Add GitHub PR notifications"
    );
}

#[test]
fn github_snippet_trims_and_truncates_on_char_boundary() {
    assert_eq!(
        GithubPrNotificationCommon::snippet("  hello world  "),
        "hello world"
    );

    let long = "é".repeat(400);
    let snippet = GithubPrNotificationCommon::snippet(&long);
    assert_eq!(snippet.chars().count(), 281);
    assert!(snippet.ends_with('…'));
}

#[test]
fn channel_reply_title_uses_reply_sender_from_metadata() {
    let notification = ChannelReplyMetadata {
        thread_id: Uuid::nil().to_string(),
        message_id: Uuid::nil().to_string(),
        user_id: Some(uid("macro|reply.sender@macro.com")),
        sender_display_name: None,
        message_content: "hello".to_string(),
        has_attachments: false,
        thread_parent_sender_id: None,
        common: CommonChannelMetadata {
            channel_type: ChannelType::Team,
            channel_name: "AI Team".to_string(),
        },
        sender_profile_picture_url: None,
    };

    let title = notification
        .format_title(Some(uid("macro|wrong.sender@macro.com")))
        .unwrap();

    assert_eq!(title, "Reply from reply.sender");
}

fn bot_channel_message_send() -> ChannelMessageSendMetadata {
    ChannelMessageSendMetadata {
        sender: None,
        sender_display_name: Some("Helper Bot".to_string()),
        message_content: "hello".to_string(),
        message_id: Uuid::nil().to_string(),
        has_attachments: false,
        common: CommonChannelMetadata {
            channel_type: ChannelType::Team,
            channel_name: "AI Team".to_string(),
        },
        sender_profile_picture_url: None,
    }
}

#[test]
fn channel_message_send_title_falls_back_to_bot_display_name() {
    let notification = bot_channel_message_send();

    assert_eq!(
        notification.format_title(None).unwrap(),
        "Helper Bot <AI Team>"
    );

    let dm = ChannelMessageSendMetadata {
        common: CommonChannelMetadata {
            channel_type: ChannelType::DirectMessage,
            channel_name: String::new(),
        },
        ..bot_channel_message_send()
    };
    assert_eq!(dm.format_title(None).unwrap(), "Helper Bot");
}

#[test]
fn channel_message_send_title_errors_without_any_sender() {
    let notification = ChannelMessageSendMetadata {
        sender_display_name: None,
        ..bot_channel_message_send()
    };

    assert!(notification.format_title(None).is_err());
}

#[test]
fn channel_reply_title_falls_back_to_bot_display_name() {
    let notification = ChannelReplyMetadata {
        thread_id: Uuid::nil().to_string(),
        message_id: Uuid::nil().to_string(),
        user_id: None,
        sender_display_name: Some("Helper Bot".to_string()),
        message_content: "hello".to_string(),
        has_attachments: false,
        thread_parent_sender_id: None,
        common: CommonChannelMetadata {
            channel_type: ChannelType::Team,
            channel_name: "AI Team".to_string(),
        },
        sender_profile_picture_url: None,
    };

    let title = notification.format_title(None).unwrap();

    assert_eq!(title, "Reply from Helper Bot");
}

#[test]
fn channel_mention_title_falls_back_to_bot_display_name() {
    let notification = ChannelMentionMetadata {
        message_id: Uuid::nil().to_string(),
        message_content: "hello".to_string(),
        has_attachments: false,
        thread_id: None,
        sender_display_name: Some("Helper Bot".to_string()),
        common: CommonChannelMetadata {
            channel_type: ChannelType::Public,
            channel_name: "general".to_string(),
        },
        sender_profile_picture_url: None,
    };

    let title = notification.format_title(None).unwrap();

    assert_eq!(title, "Helper Bot mentioned you in #general");
}

#[test]
fn channel_message_send_legacy_json_deserializes_with_required_sender() {
    let legacy: ChannelMessageSendMetadata = serde_json::from_value(serde_json::json!({
        "sender": "macro|user@macro.com",
        "messageId": "m1",
        "messageContent": "hi",
        "channelType": "public",
        "channelName": "general"
    }))
    .unwrap();

    assert_eq!(legacy.sender, Some(uid("macro|user@macro.com")));
    assert_eq!(legacy.sender_display_name, None);
}

#[test]
fn channel_message_send_bot_json_serializes_explicit_null_sender_and_round_trips() {
    let bot = bot_channel_message_send();

    let value = serde_json::to_value(&bot).unwrap();

    // The sender key must be present (as null) rather than skipped: older
    // notification_service binaries permanently delete stored notifications
    // whose metadata fails to deserialize with a `missing field sender` error.
    assert!(value.get("sender").is_some_and(serde_json::Value::is_null));
    assert_eq!(value["senderDisplayName"], "Helper Bot");

    let event: crate::NotifEvent = serde_json::from_value(serde_json::json!({
        "tag": "channel_message_send",
        "content": value,
    }))
    .unwrap();
    let crate::NotifEvent::ChannelMessageSend(round_trip) = event else {
        panic!("expected channel_message_send variant");
    };
    assert_eq!(round_trip.sender, None);
    assert_eq!(
        round_trip.sender_display_name.as_deref(),
        Some("Helper Bot")
    );
}
