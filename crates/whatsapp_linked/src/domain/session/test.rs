use super::*;
use crate::domain::models::Identity;
use chrono::Utc;

fn message(kind: MessageKind, sender: &str, target: Option<&str>) -> InboundEvent {
    InboundEvent {
        event_id: Uuid::from_u128(1),
        group_jid: "120363000000000001@g.us".into(),
        chat_alternate_jid: None,
        source_at: Utc::now(),
        observed_at: Utc::now(),
        kind: InboundKind::Message(Message {
            source_id: "3EB0A1".into(),
            sender: Identity {
                jid: sender.into(),
                alternate_jid: Some("42@lid".into()),
                display_name: None,
            },
            kind,
            text: "hello".into(),
            history: false,
            from_me: false,
            revision: 1,
            target: target.map(|jid| Target {
                source_id: "3EB0A0".into(),
                sender_jid: jid.into(),
            }),
            media: vec![],
            mentions: vec![],
            forwarded: false,
            view_once: false,
            rich: None,
        }),
    }
}

#[test]
fn only_the_verified_author_edits_or_deletes() {
    let author = "15550000001@s.whatsapp.net";
    validate_event(&message(MessageKind::Edit, author, Some(author))).unwrap();
    validate_event(&message(MessageKind::Delete, author, Some("42@lid"))).unwrap();
    assert!(matches!(
        validate_event(&message(
            MessageKind::Delete,
            author,
            Some("15550000009@s.whatsapp.net")
        ))
        .unwrap_err()
        .current_context(),
        ExternalChatError::Forbidden
    ));
    // Anyone may react to anyone's message.
    validate_event(&message(
        MessageKind::Reaction,
        author,
        Some("15550000009@s.whatsapp.net"),
    ))
    .unwrap();
}

#[test]
fn malformed_events_are_rejected_before_storage() {
    let author = "15550000001@s.whatsapp.net";
    assert!(validate_event(&message(MessageKind::Reaction, author, None)).is_err());
    assert!(validate_event(&message(MessageKind::Text, "alice", None)).is_err());
    let mut broadcast = message(MessageKind::Text, author, None);
    broadcast.group_jid = "status@broadcast".into();
    assert!(validate_event(&broadcast).is_err());
    // A direct chat is a person; only it has another address.
    let mut direct = message(MessageKind::Text, author, None);
    direct.group_jid = "15550000002@s.whatsapp.net".into();
    direct.chat_alternate_jid = Some("99@lid".into());
    assert!(validate_event(&direct).is_ok());
    direct.chat_alternate_jid = Some("120363000000000001@g.us".into());
    assert!(validate_event(&direct).is_err());
    let mut group_with_alternate = message(MessageKind::Text, author, None);
    group_with_alternate.chat_alternate_jid = Some("99@lid".into());
    assert!(validate_event(&group_with_alternate).is_err());
    let mut huge = message(MessageKind::Text, author, None);
    if let InboundKind::Message(m) = &mut huge.kind {
        m.text = "x".repeat(INBOUND_TEXT_LIMIT_BYTES + 1);
    }
    assert!(validate_event(&huge).is_err());
}

fn system_line(sender: &str) -> InboundEvent {
    let mut event = message(MessageKind::System, sender, None);
    if let InboundKind::Message(m) = &mut event.kind {
        m.sender.alternate_jid = None;
        m.rich = Some(RichContent::System(
            external_chat::domain::rich::SystemLine {
                action: external_chat::domain::rich::SystemAction::SubjectChanged,
                participants: vec![],
                value: Some("Launch".into()),
                call: None,
                by_whatsapp: true,
            },
        ));
    }
    event
}

#[test]
fn only_a_system_line_may_come_from_the_group_itself_and_content_must_fit_the_kind() {
    let group = "120363000000000001@g.us";
    validate_event(&system_line(group)).unwrap();
    assert!(
        validate_event(&message(MessageKind::Text, group, None)).is_err(),
        "a message is always from a person"
    );
    let mut no_line = system_line(group);
    if let InboundKind::Message(m) = &mut no_line.kind {
        m.rich = None;
    }
    assert!(validate_event(&no_line).is_err());
    let mut text_with_rich = system_line("15550000001@s.whatsapp.net");
    if let InboundKind::Message(m) = &mut text_with_rich.kind {
        m.kind = MessageKind::Text;
    }
    assert!(validate_event(&text_with_rich).is_err());
    assert!(
        validate_event(&message(
            MessageKind::PollVote,
            "15550000001@s.whatsapp.net",
            None
        ))
        .is_err(),
        "a vote names its poll"
    );
}
