use super::*;
use crate::domain::models::Identity;
use chrono::Utc;

fn message(kind: MessageKind, sender: &str, target: Option<&str>) -> InboundEvent {
    InboundEvent {
        event_id: Uuid::from_u128(1),
        group_jid: "120363000000000001@g.us".into(),
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
        LinkedError::Forbidden
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
    let mut other_chat = message(MessageKind::Text, author, None);
    other_chat.group_jid = "15550000002@s.whatsapp.net".into();
    assert!(validate_event(&other_chat).is_err());
    let mut huge = message(MessageKind::Text, author, None);
    if let InboundKind::Message(m) = &mut huge.kind {
        m.text = "x".repeat(INBOUND_TEXT_LIMIT_BYTES + 1);
    }
    assert!(validate_event(&huge).is_err());
}
