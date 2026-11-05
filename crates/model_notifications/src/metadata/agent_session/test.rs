use super::*;
use crate::NotifEvent;
use notification::domain::models::apple::{Alert, AlertDictionary};

fn uid(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(value).unwrap().into_owned()
}

fn agent_session_ref() -> AgentSessionNotificationRef {
    AgentSessionNotificationRef {
        session_id: Uuid::parse_str("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").unwrap(),
        session_name: "Fix the flaky test".to_string(),
        bot_id: Uuid::parse_str("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb").unwrap(),
        bot_name: "Macro Coder".to_string(),
        parent: Some(AgentSessionOriginParent {
            kind: "channel".to_string(),
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc".to_string(),
        }),
        channel_id: Some(Uuid::parse_str("cccccccc-cccc-4ccc-8ccc-cccccccccccc").unwrap()),
        thread_id: Some(Uuid::parse_str("dddddddd-dddd-4ddd-8ddd-dddddddddddd").unwrap()),
        announcement_message_id: None,
    }
}

#[test]
fn agent_session_settled_serializes_flat_and_formats() {
    let metadata = AgentSessionSettledMetadata {
        session: agent_session_ref(),
        turn: 3,
        actor: Some(uid("macro|asker@example.com")),
        stop_reason: "end_turn".to_string(),
        excerpt: Some("  Done.\nAll   tests pass. ".to_string()),
    };

    let value = serde_json::to_value(&metadata).unwrap();
    assert_eq!(value["sessionId"], "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    assert_eq!(value["botName"], "Macro Coder");
    assert_eq!(value["threadId"], "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    assert!(value.get("announcementMessageId").is_none());
    assert_eq!(value["turn"], 3);
    assert_eq!(value["actor"], "macro|asker@example.com");
    let parsed: AgentSessionSettledMetadata = serde_json::from_value(value).unwrap();
    assert_eq!(parsed, metadata);

    assert_eq!(
        metadata.format_title(None).unwrap(),
        "Macro Coder finished · Fix the flaky test"
    );
    assert_eq!(metadata.format_body(None).unwrap(), "Done. All tests pass.");

    let event: NotifEvent = serde_json::from_value(serde_json::json!({
        "tag": "agent_session_settled",
        "content": serde_json::to_value(&metadata).unwrap(),
    }))
    .unwrap();
    assert!(matches!(event, NotifEvent::AgentSessionSettled(_)));
}

#[test]
fn agent_session_settled_without_prose_says_where_to_look() {
    let metadata = AgentSessionSettledMetadata {
        session: agent_session_ref(),
        turn: 0,
        actor: None,
        stop_reason: "end_turn".to_string(),
        excerpt: Some("   ".to_string()),
    };
    assert_eq!(
        metadata.format_body(None).unwrap(),
        "Open the session to see what it did."
    );
}

#[test]
fn agent_session_settled_push_groups_with_the_thread_and_collapses_per_session() {
    let metadata = AgentSessionSettledMetadata {
        session: agent_session_ref(),
        turn: 0,
        actor: None,
        stop_reason: "end_turn".to_string(),
        excerpt: Some("Done.".to_string()),
    };
    let entity = EntityType::Channel.with_entity_str("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    let notification_id = Uuid::parse_str("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee").unwrap();

    let apns = metadata.as_apns(None, &entity, notification_id).unwrap();
    assert_eq!(
        apns.aps.thread_id.as_deref(),
        Some("dddddddd-dddd-4ddd-8ddd-dddddddddddd")
    );
    assert!(apns.aps.interruption_level.is_none());
    assert!(matches!(
        apns.aps.alert,
        Some(Alert::Dictionary(AlertDictionary { title: Some(ref title), body: Some(ref body), .. }))
            if title == "Macro Coder finished · Fix the flaky test" && body == "Done."
    ));
    assert_eq!(apns.push_notification_data.notification_id, notification_id);

    let next_turn = AgentSessionSettledMetadata {
        turn: 1,
        ..metadata.clone()
    };
    assert_eq!(
        metadata.collapse_key(&entity).into_hashed().as_ref(),
        next_turn.collapse_key(&entity).into_hashed().as_ref(),
        "one alert per session"
    );
}

#[test]
fn agent_session_waiting_for_input_is_time_sensitive() {
    let metadata = AgentSessionWaitingForInputMetadata {
        session: agent_session_ref(),
        turn: 2,
        question: "Which database should I migrate first?".to_string(),
    };
    let entity = EntityType::Channel.with_entity_str("cccccccc-cccc-4ccc-8ccc-cccccccccccc");

    assert_eq!(
        metadata.format_title(None).unwrap(),
        "Macro Coder needs an answer · Fix the flaky test"
    );
    assert_eq!(
        metadata.format_body(None).unwrap(),
        "Which database should I migrate first?"
    );
    let apns = metadata.as_apns(None, &entity, Uuid::nil()).unwrap();
    assert!(matches!(
        apns.aps.interruption_level,
        Some(InterruptionLevel::TimeSensitive)
    ));
}

#[test]
fn agent_session_mentioned_names_the_author_and_collapses_per_prompt() {
    let metadata = AgentSessionMentionedMetadata {
        session: agent_session_ref(),
        mentioned_by: Some(uid("macro|wolf@macro.com")),
        action_id: Uuid::parse_str("ffffffff-ffff-4fff-8fff-ffffffffffff").unwrap(),
    };
    let entity = EntityType::Channel.with_entity_str("cccccccc-cccc-4ccc-8ccc-cccccccccccc");

    assert_eq!(
        metadata.format_title(None).unwrap(),
        "wolf mentioned you in Fix the flaky test"
    );
    let anonymous = AgentSessionMentionedMetadata {
        mentioned_by: None,
        ..metadata.clone()
    };
    assert_eq!(
        anonymous.format_title(None).unwrap(),
        "You were mentioned in Fix the flaky test"
    );

    let other_prompt = AgentSessionMentionedMetadata {
        action_id: Uuid::parse_str("00000000-0000-4000-8000-000000000001").unwrap(),
        ..metadata.clone()
    };
    assert_ne!(
        metadata.collapse_key(&entity).into_hashed().as_ref(),
        other_prompt.collapse_key(&entity).into_hashed().as_ref(),
        "each prompt that names you is its own alert"
    );
}

#[test]
fn agent_excerpt_flattens_whitespace_and_truncates() {
    assert_eq!(agent_excerpt("a\n\n  b\tc"), "a b c");
    let long = "x".repeat(400);
    let excerpt = agent_excerpt(&long);
    assert_eq!(excerpt.chars().count(), AGENT_EXCERPT_MAX_CHARS);
    assert!(excerpt.ends_with('…'));
}

#[test]
fn agent_session_alerts_show_mentions_by_name() {
    let settled = AgentSessionSettledMetadata {
        session: agent_session_ref(),
        turn: 0,
        actor: None,
        stop_reason: "end_turn".to_string(),
        excerpt: Some(
            r#"The most recent one was <m-user-mention>{"userId":"macro|user@example.com","email":"user@example.com"}</m-user-mention>, posted in <m-document-mention>{"documentId":"0195c94f-3b0c-79f0-8558-e5e509ac9dd8","documentName":"the request","blockName":"channel","blockParams":{}}</m-document-mention>; it returns Option<String>."#
                .to_string(),
        ),
    };
    assert_eq!(
        settled.format_body(None).unwrap(),
        "The most recent one was user@example.com, posted in the request; it returns Option<String>."
    );

    let waiting = AgentSessionWaitingForInputMetadata {
        session: agent_session_ref(),
        turn: 0,
        question: r#"Should I ask <m-user-mention>{"userId":"macro|user@example.com","email":"user@example.com"}</m-user-mention>?"#.to_string(),
    };
    assert_eq!(
        waiting.format_body(None).unwrap(),
        "Should I ask user@example.com?"
    );
}

#[test]
fn agent_session_settled_with_only_hidden_tags_says_where_to_look() {
    let metadata = AgentSessionSettledMetadata {
        session: agent_session_ref(),
        turn: 0,
        actor: None,
        stop_reason: "end_turn".to_string(),
        excerpt: Some(r#"<m-await>{"text":"thinking"}</m-await>"#.to_string()),
    };
    assert_eq!(
        metadata.format_body(None).unwrap(),
        "Open the session to see what it did."
    );
}

#[test]
fn agent_session_settled_tells_a_failed_or_stopped_turn_from_a_finished_one() {
    let failed = AgentSessionSettledMetadata {
        session: agent_session_ref(),
        turn: 1,
        actor: None,
        stop_reason: "error".to_string(),
        excerpt: None,
    };
    assert_eq!(
        failed.format_title(None).unwrap(),
        "Macro Coder ran into an error · Fix the flaky test"
    );
    assert_eq!(
        failed.format_body(None).unwrap(),
        "Open the session to see what went wrong."
    );

    let stopped = AgentSessionSettledMetadata {
        stop_reason: "cancelled".to_string(),
        excerpt: Some("I updated two of the three files.".to_string()),
        ..failed.clone()
    };
    assert_eq!(
        stopped.format_title(None).unwrap(),
        "Macro Coder was stopped · Fix the flaky test"
    );
    assert_eq!(
        stopped.format_body(None).unwrap(),
        "I updated two of the three files."
    );

    let unnamed = AgentSessionSettledMetadata {
        session: AgentSessionNotificationRef {
            session_name: String::new(),
            ..agent_session_ref()
        },
        ..failed
    };
    assert_eq!(
        unnamed.format_title(None).unwrap(),
        "Macro Coder ran into an error"
    );
}
