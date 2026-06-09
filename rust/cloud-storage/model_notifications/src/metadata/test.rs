use super::*;

fn uid(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(value).unwrap().into_owned()
}

fn utc_datetime(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .unwrap()
        .with_timezone(&Utc)
}

fn github_pr_event() -> GithubPrEvent {
    GithubPrEvent {
        foreign_entity_id: Uuid::parse_str("11111111-1111-4111-8111-111111111111").unwrap(),
        github_key: "macro/app/pull/42".to_string(),
        owner: "macro".to_string(),
        repo: "app".to_string(),
        number: 42,
        url: "https://github.com/macro/app/pull/42".to_string(),
        display_name: "macro/app#42".to_string(),
        title: "Add GitHub PR notifications".to_string(),
        status: GithubPrEventStatus::Merged,
        action: GithubPrEventAction::Closed,
        previous_status: Some(GithubPrEventStatus::Open),
        sender_github_login: Some("octocat".to_string()),
        sender_github_user_id: Some("12345".to_string()),
        sender_github_avatar_url: Some(
            "https://avatars.githubusercontent.com/u/12345?v=4".to_string(),
        ),
        head_branch: Some("feature/github-pr-notifications".to_string()),
        base_branch: Some("main".to_string()),
        merged_at: Some(utc_datetime("2026-05-25T18:54:21Z")),
    }
}

#[test]
fn github_pr_event_serializes_with_camel_case_fields_and_lowercase_enums() {
    let event = github_pr_event();

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
fn github_pr_event_tagged_content_serializes_with_type_name() {
    let event = github_pr_event();
    let foreign_entity_id = event.foreign_entity_id.to_string();

    let value =
        serde_json::to_value(notification::domain::models::TaggedContent::new(event)).unwrap();

    assert_eq!(value["tag"], "github_pr_event");
    assert_eq!(
        value["content"]["foreignEntityId"],
        serde_json::json!(foreign_entity_id)
    );
}

#[test]
fn github_pr_event_formats_title_and_body() {
    let event = github_pr_event();

    let title = event
        .format_title(Some(uid("macro|pr.sender@macro.com")))
        .unwrap();
    let body = event.format_body(None).unwrap();

    assert_eq!(title, "pr.sender merged a pull request");
    assert_eq!(body, "macro/app#42: Add GitHub PR notifications");
}

#[test]
fn github_pr_event_title_falls_back_to_display_name() {
    assert_eq!(
        GithubPrEvent::title_or_display_name(None, "macro/app#42"),
        "macro/app#42"
    );
    assert_eq!(
        GithubPrEvent::title_or_display_name(Some(String::new()), "macro/app#42"),
        "macro/app#42"
    );
    assert_eq!(
        GithubPrEvent::title_or_display_name(
            Some("Add GitHub PR notifications".to_string()),
            "macro/app#42"
        ),
        "Add GitHub PR notifications"
    );

    let mut event = github_pr_event();
    event.title = GithubPrEvent::title_or_display_name(None, &event.display_name);

    assert_eq!(event.format_body(None).unwrap(), "macro/app#42");
}

#[test]
fn github_pr_event_notif_event_deserializes_and_renders_in_app() {
    let expected = github_pr_event();
    let value = serde_json::json!({
        "tag": "github_pr_event",
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

    let crate::NotifEvent::GithubPrEvent(actual) = event else {
        panic!("expected github_pr_event variant");
    };
    assert_eq!(actual, expected);
}

#[test]
fn channel_reply_title_uses_reply_sender_from_metadata() {
    let notification = ChannelReplyMetadata {
        thread_id: Uuid::nil().to_string(),
        message_id: Uuid::nil().to_string(),
        user_id: uid("macro|reply.sender@macro.com"),
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
