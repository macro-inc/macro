use chrono::{DateTime, Utc};
use macro_event_broker::Event;
use serde_json::json;

use super::*;

fn user_id(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

fn timestamp() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-01-02T03:04:05Z")
        .expect("valid timestamp")
        .with_timezone(&Utc)
}

#[test]
fn message_received_wire_shape() {
    let event = Event::with_event_id(
        Uuid::nil(),
        EmailTopicEvent::MessageReceived(MessageReceivedMetadata {
            link_id: Uuid::nil(),
            owner: user_id("macro|owner@example.com"),
            message_id: Uuid::nil(),
            provider_message_id: "gmail-msg-1".to_string(),
            thread_id: Uuid::nil(),
            provider_thread_id: "gmail-thread-1".to_string(),
            is_new_thread: true,
            subject: Some("Quarterly report".to_string()),
            from_email: Some("sender@example.com".to_string()),
            from_name: Some("Sender".to_string()),
            to_emails: vec!["owner@example.com".to_string()],
            attachment_count: 2,
            is_spam_or_trash: false,
            received_at: Some(timestamp()),
        }),
    );

    let value = serde_json::to_value(&event).expect("serializable");
    assert_eq!(
        value,
        json!({
            "event_id": "00000000-0000-0000-0000-000000000000",
            "schema_version": 1,
            "event_type": "email.message_received",
            "metadata": {
                "link_id": "00000000-0000-0000-0000-000000000000",
                "owner": "macro|owner@example.com",
                "message_id": "00000000-0000-0000-0000-000000000000",
                "provider_message_id": "gmail-msg-1",
                "thread_id": "00000000-0000-0000-0000-000000000000",
                "provider_thread_id": "gmail-thread-1",
                "is_new_thread": true,
                "subject": "Quarterly report",
                "from_email": "sender@example.com",
                "from_name": "Sender",
                "to_emails": ["owner@example.com"],
                "attachment_count": 2,
                "is_spam_or_trash": false,
                "received_at": "2026-01-02T03:04:05Z",
            },
        })
    );
}

#[test]
fn thread_archived_wire_shape_with_origin() {
    let event = Event::with_event_id(
        Uuid::nil(),
        EmailTopicEvent::ThreadArchived(ThreadArchivedMetadata {
            link_id: Uuid::nil(),
            owner: user_id("macro|owner@example.com"),
            actor: None,
            thread_id: Uuid::nil(),
            archived: true,
            origin: EmailEventOrigin::ProviderSync,
        }),
    );

    let value = serde_json::to_value(&event).expect("serializable");
    assert_eq!(
        value,
        json!({
            "event_id": "00000000-0000-0000-0000-000000000000",
            "schema_version": 1,
            "event_type": "email.thread_archived",
            "metadata": {
                "link_id": "00000000-0000-0000-0000-000000000000",
                "owner": "macro|owner@example.com",
                "actor": null,
                "thread_id": "00000000-0000-0000-0000-000000000000",
                "archived": true,
                "origin": "provider_sync",
            },
        })
    );
}

#[test]
fn decode_round_trips() {
    let link_id = Uuid::new_v4();
    let original = EmailMacroEvent::message_deleted(MessageDeletedMetadata {
        link_id,
        owner: user_id("macro|owner@example.com"),
        message_id: Uuid::new_v4(),
        provider_message_id: "gmail-msg-1".to_string(),
        thread_id: Uuid::new_v4(),
    });

    let payload = serde_json::to_vec(original.event()).expect("serializable");
    let decoded = EmailMacroEvent::decode(original.key(), &payload).expect("decodable payload");

    assert_eq!(decoded.key(), link_id.to_string());
    assert_eq!(decoded.event(), original.event());
}

#[test]
fn events_are_keyed_by_link_id() {
    let link_id = Uuid::new_v4();
    let event = EmailMacroEvent::link_disconnected(LinkDisconnectedMetadata {
        link_id,
        owner: user_id("macro|owner@example.com"),
        email_address: "owner@example.com".to_string(),
        reason: LinkDisconnectReason::ManuallyDisabled,
    });
    assert_eq!(event.key(), link_id.to_string());
}

#[test]
fn event_type_strings_follow_dot_convention() {
    let link_id = Uuid::nil();
    let owner = user_id("macro|owner@example.com");
    let actor = Some(user_id("macro|actor@example.com"));

    let cases = vec![
        (
            EmailMacroEvent::link_connected(LinkConnectedMetadata {
                link_id,
                owner: owner.clone(),
                email_address: "owner@example.com".to_string(),
                provider: "GMAIL".to_string(),
                is_primary: true,
                connected_at: timestamp(),
            }),
            "email.link_connected",
        ),
        (
            EmailMacroEvent::link_disconnected(LinkDisconnectedMetadata {
                link_id,
                owner: owner.clone(),
                email_address: "owner@example.com".to_string(),
                reason: LinkDisconnectReason::AccessRevoked,
            }),
            "email.link_disconnected",
        ),
        (
            EmailMacroEvent::link_reauth_required(LinkReauthRequiredMetadata {
                link_id,
                owner: owner.clone(),
                email_address: "owner@example.com".to_string(),
                observed_at: timestamp(),
            }),
            "email.link_reauth_required",
        ),
        (
            EmailMacroEvent::message_received(MessageReceivedMetadata {
                link_id,
                owner: owner.clone(),
                message_id: Uuid::nil(),
                provider_message_id: "m".to_string(),
                thread_id: Uuid::nil(),
                provider_thread_id: "t".to_string(),
                is_new_thread: false,
                subject: None,
                from_email: None,
                from_name: None,
                to_emails: vec![],
                attachment_count: 0,
                is_spam_or_trash: false,
                received_at: None,
            }),
            "email.message_received",
        ),
        (
            EmailMacroEvent::message_sent(MessageSentMetadata {
                link_id,
                owner: owner.clone(),
                actor: actor.clone(),
                message_id: Uuid::nil(),
                provider_message_id: "m".to_string(),
                thread_id: Uuid::nil(),
                provider_thread_id: "t".to_string(),
                subject: None,
                to_emails: vec![],
                cc_emails: vec![],
                origin: EmailEventOrigin::UserAction,
                sent_at: timestamp(),
            }),
            "email.message_sent",
        ),
        (
            EmailMacroEvent::message_deleted(MessageDeletedMetadata {
                link_id,
                owner: owner.clone(),
                message_id: Uuid::nil(),
                provider_message_id: "m".to_string(),
                thread_id: Uuid::nil(),
            }),
            "email.message_deleted",
        ),
        (
            EmailMacroEvent::message_send_queued(MessageSendQueuedMetadata {
                link_id,
                owner: owner.clone(),
                actor: actor.clone(),
                message_id: Uuid::nil(),
                thread_id: Uuid::nil(),
                scheduled_send_at: timestamp(),
                is_scheduled: false,
            }),
            "email.message_send_queued",
        ),
        (
            EmailMacroEvent::message_send_cancelled(MessageSendCancelledMetadata {
                link_id,
                owner: owner.clone(),
                actor: actor.clone(),
                message_id: Uuid::nil(),
                thread_id: Uuid::nil(),
                reason: SendCancelReason::Undo,
            }),
            "email.message_send_cancelled",
        ),
        (
            EmailMacroEvent::thread_archived(ThreadArchivedMetadata {
                link_id,
                owner: owner.clone(),
                actor: actor.clone(),
                thread_id: Uuid::nil(),
                archived: true,
                origin: EmailEventOrigin::UserAction,
            }),
            "email.thread_archived",
        ),
        (
            EmailMacroEvent::thread_trashed(ThreadTrashedMetadata {
                link_id,
                owner: owner.clone(),
                actor: actor.clone(),
                thread_id: Uuid::nil(),
                trashed: true,
                origin: EmailEventOrigin::UserAction,
            }),
            "email.thread_trashed",
        ),
        (
            EmailMacroEvent::thread_read(ThreadReadMetadata {
                link_id,
                owner: owner.clone(),
                actor: actor.clone(),
                thread_id: Uuid::nil(),
                is_read: true,
                origin: EmailEventOrigin::UserAction,
            }),
            "email.thread_read",
        ),
        (
            EmailMacroEvent::thread_starred(ThreadStarredMetadata {
                link_id,
                owner: owner.clone(),
                actor: actor.clone(),
                thread_id: Uuid::nil(),
                starred: true,
                origin: EmailEventOrigin::UserAction,
            }),
            "email.thread_starred",
        ),
        (
            EmailMacroEvent::thread_project_changed(ThreadProjectChangedMetadata {
                link_id,
                owner: owner.clone(),
                actor: user_id("macro|actor@example.com"),
                thread_id: Uuid::nil(),
                previous_project_id: None,
                project_id: Some("project-1".to_string()),
            }),
            "email.thread_project_changed",
        ),
        (
            EmailMacroEvent::thread_labels_updated(ThreadLabelsUpdatedMetadata {
                link_id,
                owner: owner.clone(),
                actor: actor.clone(),
                thread_id: Uuid::nil(),
                added: vec![LabelRef {
                    label_id: Some(Uuid::nil()),
                    provider_label_id: "Label_1".to_string(),
                    name: Some("Receipts".to_string()),
                }],
                removed: vec![],
                origin: EmailEventOrigin::ProviderSync,
            }),
            "email.thread_labels_updated",
        ),
    ];

    for (event, expected_type) in cases {
        let value = serde_json::to_value(event.event()).expect("serializable");
        assert_eq!(value["event_type"], *expected_type);
    }
}

fn user_label() -> LabelRef {
    LabelRef {
        label_id: Some(Uuid::nil()),
        provider_label_id: "Label_1".to_string(),
        name: Some("Receipts".to_string()),
    }
}

fn system_label(provider_label_id: &str) -> LabelRef {
    LabelRef {
        label_id: None,
        provider_label_id: provider_label_id.to_string(),
        name: None,
    }
}

fn label_change(label: LabelRef, added: bool) -> Option<EmailMacroEvent> {
    EmailMacroEvent::thread_label_change(
        Uuid::nil(),
        user_id("macro|owner@example.com"),
        None,
        Uuid::nil(),
        label,
        added,
        EmailEventOrigin::UserAction,
    )
}

#[test]
fn thread_label_change_maps_system_labels_to_semantic_events() {
    let cases = [
        ("UNREAD", true, "email.thread_read", "is_read", false),
        ("UNREAD", false, "email.thread_read", "is_read", true),
        ("STARRED", true, "email.thread_starred", "starred", true),
        ("STARRED", false, "email.thread_starred", "starred", false),
        ("TRASH", true, "email.thread_trashed", "trashed", true),
        ("TRASH", false, "email.thread_trashed", "trashed", false),
        ("INBOX", true, "email.thread_archived", "archived", false),
        ("INBOX", false, "email.thread_archived", "archived", true),
    ];

    for (label, added, expected_type, state_field, expected_state) in cases {
        let event = label_change(system_label(label), added)
            .unwrap_or_else(|| panic!("{label} added={added} should map to an event"));
        let value = serde_json::to_value(event.event()).expect("serializable");
        assert_eq!(value["event_type"], expected_type, "{label} added={added}");
        assert_eq!(
            value["metadata"][state_field], expected_state,
            "{label} added={added}"
        );
    }
}

#[test]
fn thread_label_change_skips_unpublished_system_labels() {
    for label in ["SPAM", "IMPORTANT", "SENT", "DRAFT"] {
        assert!(
            label_change(system_label(label), true).is_none(),
            "{label} add should not publish"
        );
        assert!(
            label_change(system_label(label), false).is_none(),
            "{label} remove should not publish"
        );
    }
}

#[test]
fn thread_label_change_maps_user_labels_to_diff() {
    let added_event = label_change(user_label(), true).expect("user label maps to an event");
    let value = serde_json::to_value(added_event.event()).expect("serializable");
    assert_eq!(value["event_type"], "email.thread_labels_updated");
    assert_eq!(
        value["metadata"]["added"][0]["provider_label_id"],
        "Label_1"
    );
    assert_eq!(value["metadata"]["removed"], serde_json::json!([]));

    let removed_event = label_change(user_label(), false).expect("user label maps to an event");
    let value = serde_json::to_value(removed_event.event()).expect("serializable");
    assert_eq!(value["metadata"]["added"], serde_json::json!([]));
    assert_eq!(
        value["metadata"]["removed"][0]["provider_label_id"],
        "Label_1"
    );
}

#[test]
fn thread_label_change_skips_gmail_category_labels() {
    assert!(label_change(system_label("CATEGORY_PROMOTIONS"), true).is_none());
    assert!(label_change(system_label("CATEGORY_SOCIAL"), false).is_none());
}
