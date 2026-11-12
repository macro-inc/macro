use super::*;
use slack_client::realtime::Event;

#[test]
fn a_thread_reply_from_another_organization_becomes_a_threaded_message_with_mentions() {
    let Event::Known(event) = Event::parse(serde_json::json!({
        "type": "message",
        "channel": "C0123ABCDE",
        "user": "U0EXTERNAL",
        "user_team": "T0PARTNER1",
        "text": "hi <@U0OWNER12|ana>, see <#C0123ABCDE> and <@U0OWNER12>",
        "ts": "1700000100.000200",
        "thread_ts": "1700000000.000100",
        "client_msg_id": "4f2c1d9e-0000-4000-8000-000000000001",
        "user_profile": {"display_name": "", "real_name": "Ben Partner"},
        "files": [{"id": "F0FILE1234", "name": "plan.pdf", "mimetype": "application/pdf", "size": 2048}]
    })) else {
        panic!("a known event");
    };
    assert_eq!(
        inbound_changes(&event),
        vec![InboundChange::Message {
            conversation_id: "C0123ABCDE".to_owned(),
            origin: IngestOrigin::Live,
            message: InboundMessage {
                ts: "1700000100.000200".to_owned(),
                sent_at: DateTime::from_timestamp(1_700_000_100, 200_000).unwrap(),
                sender: Sender::User {
                    slack_user_id: "U0EXTERNAL".to_owned(),
                    team_id: Some("T0PARTNER1".to_owned()),
                    display_name: Some("Ben Partner".to_owned()),
                },
                body: "hi <@U0OWNER12|ana>, see <#C0123ABCDE> and <@U0OWNER12>".to_owned(),
                mentions: vec!["U0OWNER12".to_owned()],
                thread_ts: Some("1700000000.000100".to_owned()),
                broadcast: false,
                system: false,
                files: vec![InboundFile {
                    file_id: "F0FILE1234".to_owned(),
                    filename: "plan.pdf".to_owned(),
                    mime: Some("application/pdf".to_owned()),
                    size: Some(2048),
                    width: None,
                    height: None,
                    duration_seconds: None,
                }],
                edited_ts: None,
                client_msg_id: Some("4f2c1d9e-0000-4000-8000-000000000001".to_owned()),
            },
        }]
    );
}

#[test]
fn edits_deletes_reactions_and_marks_map_to_their_changes() {
    let changes: Vec<InboundChange> = [
        serde_json::json!({
            "type": "message", "subtype": "message_changed", "channel": "C0123ABCDE",
            "ts": "1700000200.000000",
            "message": {"type": "message", "user": "U0EXTERNAL", "text": "fixed",
                "ts": "1700000100.000200", "edited": {"user": "U0EXTERNAL", "ts": "1700000200.000000"}}
        }),
        serde_json::json!({
            "type": "message", "subtype": "message_deleted", "channel": "C0123ABCDE",
            "ts": "1700000300.000000", "deleted_ts": "1700000100.000200"
        }),
        serde_json::json!({
            "type": "reaction_removed", "user": "U0OWNER12", "reaction": "tada",
            "item": {"type": "message", "channel": "C0123ABCDE", "ts": "1700000100.000200"},
            "event_ts": "1700000400.000000"
        }),
        serde_json::json!({"type": "channel_marked", "channel": "C0123ABCDE", "ts": "1700000100.000200"}),
    ]
    .into_iter()
    .flat_map(|raw| match Event::parse(raw) {
        Event::Known(event) => inbound_changes(&event),
        other => panic!("not a known event: {other:?}"),
    })
    .collect();
    assert_eq!(changes.len(), 4);
    assert!(matches!(&changes[0], InboundChange::Edited { message, .. }
        if message.body == "fixed" && message.edited_ts.as_deref() == Some("1700000200.000000")));
    assert_eq!(
        changes[1],
        InboundChange::Deleted {
            conversation_id: "C0123ABCDE".to_owned(),
            ts: "1700000100.000200".to_owned(),
            at: DateTime::from_timestamp(1_700_000_300, 0).unwrap(),
        }
    );
    assert_eq!(
        changes[2],
        InboundChange::Reaction {
            conversation_id: "C0123ABCDE".to_owned(),
            ts: "1700000100.000200".to_owned(),
            slack_user_id: "U0OWNER12".to_owned(),
            name: "tada".to_owned(),
            added: false,
            event_ts: "1700000400.000000".to_owned(),
        }
    );
    assert_eq!(
        changes[3],
        InboundChange::Marked {
            conversation_id: "C0123ABCDE".to_owned(),
            thread_ts: None,
            ts: "1700000100.000200".to_owned(),
        }
    );
}

#[test]
fn only_slack_connect_conversations_enter_the_catalogue() {
    let conversation = |raw| serde_json::from_value::<Conversation>(raw).unwrap();
    let team_of = |user: &str| match user {
        "U0PARTNER1" => Some("T0PARTNER1".to_owned()),
        _ => Some("T0OWNTEAM1".to_owned()),
    };
    let shared = catalogue_conversation(
        &conversation(serde_json::json!({
            "id": "C0SHARED12", "name": "launch", "is_channel": true, "is_member": true,
            "is_ext_shared": true, "connected_team_ids": ["T0OWNTEAM1", "T0PARTNER1"],
            "topic": {"value": "Launch plans"}, "updated": 1700000000000i64
        })),
        "T0OWNTEAM1",
        team_of,
    )
    .unwrap();
    assert_eq!(shared.connected_team_ids, vec!["T0PARTNER1".to_owned()]);
    assert_eq!(shared.kind, ExternalChatKind::Group);
    assert_eq!(shared.topic.as_deref(), Some("Launch plans"));

    let external_dm = catalogue_conversation(
        &conversation(serde_json::json!({"id": "D0EXTDM123", "is_im": true, "user": "U0PARTNER1"})),
        "T0OWNTEAM1",
        team_of,
    )
    .unwrap();
    assert_eq!(external_dm.kind, ExternalChatKind::Direct);
    assert_eq!(external_dm.direct_user_id.as_deref(), Some("U0PARTNER1"));

    for internal in [
        serde_json::json!({"id": "C0INTERNAL", "name": "general", "is_channel": true, "is_member": true}),
        serde_json::json!({"id": "D0INTDM123", "is_im": true, "user": "U0COLLEAGU"}),
    ] {
        assert_eq!(
            catalogue_conversation(&conversation(internal), "T0OWNTEAM1", team_of),
            None
        );
    }
}

#[test]
fn a_blocks_only_message_is_stored_as_mrkdwn_with_its_mentions() {
    let message: Message = serde_json::from_value(serde_json::json!({
        "type": "message", "user": "U0EXTERNAL", "ts": "1700000100.000200", "text": "",
        "blocks": [{"type": "rich_text", "elements": [{"type": "rich_text_section", "elements": [
            {"type": "text", "text": "ping "},
            {"type": "user", "user_id": "U0OWNER12"}
        ]}]}]
    }))
    .unwrap();
    let stored = inbound_message(&message);
    assert_eq!(stored.body, "ping <@U0OWNER12>");
    assert_eq!(stored.mentions, vec!["U0OWNER12".to_owned()]);
}
