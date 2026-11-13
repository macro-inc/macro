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

fn new_contract_events(link_id: Uuid) -> Vec<EmailMacroEvent> {
    let owner = user_id("macro|owner@example.com");

    vec![
        EmailMacroEvent::message_draft_synced(MessageDraftSyncedMetadata {
            link_id,
            owner: owner.clone(),
            message_id: Uuid::new_v4(),
            provider_message_id: "gmail-draft-1".to_string(),
            thread_id: Uuid::new_v4(),
            provider_thread_id: "gmail-thread-1".to_string(),
            is_spam_or_trash: false,
        }),
        EmailMacroEvent::thread_backfilled(ThreadBackfilledMetadata {
            link_id,
            owner: owner.clone(),
            thread_id: Uuid::new_v4(),
        }),
        EmailMacroEvent::threads_reindex_requested(ThreadsReindexRequestedMetadata {
            link_id,
            owner: owner.clone(),
            thread_ids: vec![Uuid::new_v4(), Uuid::new_v4()],
            reason: ThreadsReindexReason::ContactsChanged,
        }),
        EmailMacroEvent::thread_spam_changed(ThreadSpamChangedMetadata {
            link_id,
            owner,
            actor: None,
            thread_id: Uuid::new_v4(),
            spam: true,
            origin: EmailEventOrigin::ProviderSync,
        }),
    ]
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
fn message_draft_synced_wire_shape_preserves_spam_or_trash_state() {
    for is_spam_or_trash in [false, true] {
        let event = Event::with_event_id(
            Uuid::nil(),
            EmailTopicEvent::MessageDraftSynced(MessageDraftSyncedMetadata {
                link_id: Uuid::nil(),
                owner: user_id("macro|owner@example.com"),
                message_id: Uuid::nil(),
                provider_message_id: "gmail-draft-1".to_string(),
                thread_id: Uuid::nil(),
                provider_thread_id: "gmail-thread-1".to_string(),
                is_spam_or_trash,
            }),
        );

        let value = serde_json::to_value(&event).expect("serializable");
        assert_eq!(
            value,
            json!({
                "event_id": "00000000-0000-0000-0000-000000000000",
                "schema_version": 1,
                "event_type": "email.message_draft_synced",
                "metadata": {
                    "link_id": "00000000-0000-0000-0000-000000000000",
                    "owner": "macro|owner@example.com",
                    "message_id": "00000000-0000-0000-0000-000000000000",
                    "provider_message_id": "gmail-draft-1",
                    "thread_id": "00000000-0000-0000-0000-000000000000",
                    "provider_thread_id": "gmail-thread-1",
                    "is_spam_or_trash": is_spam_or_trash,
                },
            })
        );
    }
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
fn new_contract_events_decode_round_trip() {
    let link_id = Uuid::new_v4();

    for original in new_contract_events(link_id) {
        let payload = serde_json::to_vec(original.event()).expect("serializable");
        let decoded = EmailMacroEvent::decode(original.key(), &payload).expect("decodable payload");

        assert_eq!(decoded.key(), link_id.to_string());
        assert_eq!(decoded.event(), original.event());
    }
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
fn new_contract_event_constructors_are_keyed_by_link_id() {
    let link_id = Uuid::new_v4();

    for event in new_contract_events(link_id) {
        assert_eq!(event.key(), link_id.to_string());
    }
}

#[test]
fn threads_reindex_reason_uses_snake_case() {
    let value = serde_json::to_value(ThreadsReindexReason::ContactsChanged)
        .expect("reason is serializable");

    assert_eq!(value, json!("contacts_changed"));
}

#[test]
fn event_type_strings_follow_dot_convention() {
    for (event, expected_type) in every_event() {
        let value = serde_json::to_value(event.event()).expect("serializable");
        assert_eq!(value["event_type"], *expected_type);
    }
}

/// One event of every variant, with the `event_type` it must carry.
fn every_event() -> Vec<(EmailMacroEvent, &'static str)> {
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
            EmailMacroEvent::message_draft_synced(MessageDraftSyncedMetadata {
                link_id,
                owner: owner.clone(),
                message_id: Uuid::nil(),
                provider_message_id: "m".to_string(),
                thread_id: Uuid::nil(),
                provider_thread_id: "t".to_string(),
                is_spam_or_trash: false,
            }),
            "email.message_draft_synced",
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
            EmailMacroEvent::thread_spam_changed(ThreadSpamChangedMetadata {
                link_id,
                owner: owner.clone(),
                actor: actor.clone(),
                thread_id: Uuid::nil(),
                spam: true,
                origin: EmailEventOrigin::UserAction,
            }),
            "email.thread_spam_changed",
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
        (
            EmailMacroEvent::thread_backfilled(ThreadBackfilledMetadata {
                link_id,
                owner: owner.clone(),
                thread_id: Uuid::nil(),
            }),
            "email.thread_backfilled",
        ),
        (
            EmailMacroEvent::threads_reindex_requested(ThreadsReindexRequestedMetadata {
                link_id,
                owner,
                thread_ids: vec![Uuid::nil()],
                reason: ThreadsReindexReason::ContactsChanged,
            }),
            "email.threads_reindex_requested",
        ),
    ];
    cases
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
        ("SPAM", true, "email.thread_spam_changed", "spam", true),
        ("SPAM", false, "email.thread_spam_changed", "spam", false),
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
    for label in ["IMPORTANT", "SENT", "DRAFT"] {
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

const INTERNAL_EVENTS: [&str; 3] = [
    "email.message_draft_synced",
    "email.thread_backfilled",
    "email.threads_reindex_requested",
];

#[test]
fn public_events_reach_only_the_mailbox_owner() {
    use macro_event_broker::exposure::{Audience, Exposure, Stage};

    let owner = user_id("macro|owner@example.com");
    for (event, name) in every_event() {
        let exposure = event.event().event.exposure().expect("valid exposure");
        match exposure {
            Exposure::Public(public) => {
                assert!(
                    !INTERNAL_EVENTS.contains(&name),
                    "{name} must stay internal"
                );
                assert_eq!(public.name, name);
                assert_eq!(public.stage, Stage::Preview);
                assert_eq!(
                    public.audience,
                    Audience::Recipient {
                        user_id: owner.clone()
                    },
                    "{name}"
                );
                let payload = serde_json::to_value(public.payload.as_ref()).unwrap();
                assert_eq!(payload["event_type"], name);
                let body = payload.to_string();
                for forbidden in [
                    "owner@example.com",
                    "\"owner\"",
                    "subject",
                    "email_address",
                    "to_emails",
                    "cc_emails",
                    "from_",
                    "provider_message_id",
                    "provider_thread_id",
                ] {
                    assert!(
                        !body.contains(forbidden),
                        "{name} leaks {forbidden}: {body}"
                    );
                }
            }
            Exposure::Internal(_) => {
                assert!(INTERNAL_EVENTS.contains(&name), "{name} must be public");
            }
        }
    }
}

#[test]
fn email_entities_are_the_thread_or_the_link() {
    use macro_event_broker::exposure::{EntityRef, EntityType, Exposure, PublicEntityType};

    for (event, name) in every_event() {
        let Exposure::Public(public) = event.event().event.exposure().unwrap() else {
            continue;
        };
        let expected = if name.starts_with("email.link_") {
            EntityRef::new(PublicEntityType::EmailLink, Uuid::nil().to_string())
        } else {
            EntityRef::new(EntityType::EmailThread, Uuid::nil().to_string())
        };
        assert_eq!(public.entity, expected, "{name}");
    }
}

fn public_payload(event: &EmailMacroEvent) -> serde_json::Value {
    use macro_event_broker::exposure::Exposure;

    let Exposure::Public(public) = event.event().event.exposure().unwrap() else {
        panic!("expected a public event");
    };
    serde_json::to_value(public.payload.as_ref()).unwrap()
}

#[test]
fn message_received_public_body() {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
    let thread_id = Uuid::parse_str("00000000-0000-0000-0000-000000000002").unwrap();
    let message_id = Uuid::parse_str("00000000-0000-0000-0000-000000000003").unwrap();
    let event = EmailMacroEvent::message_received(MessageReceivedMetadata {
        link_id,
        owner: user_id("macro|owner@example.com"),
        message_id,
        provider_message_id: "gmail-1".to_string(),
        thread_id,
        provider_thread_id: "gmail-t-1".to_string(),
        is_new_thread: true,
        subject: Some("Quarterly numbers".to_string()),
        from_email: Some("sender@example.com".to_string()),
        from_name: Some("Sender".to_string()),
        to_emails: vec!["owner@example.com".to_string()],
        attachment_count: 2,
        is_spam_or_trash: false,
        received_at: Some(timestamp()),
    });

    assert_eq!(
        public_payload(&event),
        json!({
            "event_type": "email.message_received",
            "metadata": {
                "link_id": "00000000-0000-0000-0000-000000000001",
                "thread_id": "00000000-0000-0000-0000-000000000002",
                "message_id": "00000000-0000-0000-0000-000000000003",
                "is_new_thread": true,
                "attachment_count": 2,
                "is_spam_or_trash": false,
                "received_at": "2026-01-02T03:04:05Z"
            }
        })
    );
}

#[test]
fn link_connected_public_body() {
    let event = EmailMacroEvent::link_connected(LinkConnectedMetadata {
        link_id: Uuid::nil(),
        owner: user_id("macro|owner@example.com"),
        email_address: "owner@example.com".to_string(),
        provider: "GMAIL".to_string(),
        is_primary: true,
        connected_at: timestamp(),
    });

    assert_eq!(
        public_payload(&event),
        json!({
            "event_type": "email.link_connected",
            "metadata": {
                "link_id": "00000000-0000-0000-0000-000000000000",
                "provider": "GMAIL",
                "is_primary": true,
                "connected_at": "2026-01-02T03:04:05Z"
            }
        })
    );
}

#[test]
fn link_disconnected_public_body() {
    let event = EmailMacroEvent::link_disconnected(LinkDisconnectedMetadata {
        link_id: Uuid::nil(),
        owner: user_id("macro|owner@example.com"),
        email_address: "owner@example.com".to_string(),
        reason: LinkDisconnectReason::AccessRevoked,
    });

    assert_eq!(
        public_payload(&event),
        json!({
            "event_type": "email.link_disconnected",
            "metadata": {
                "link_id": "00000000-0000-0000-0000-000000000000",
                "reason": "access_revoked"
            }
        })
    );
}

#[test]
fn thread_labels_updated_public_body() {
    let event = EmailMacroEvent::thread_labels_updated(ThreadLabelsUpdatedMetadata {
        link_id: Uuid::nil(),
        owner: user_id("macro|owner@example.com"),
        actor: Some(user_id("macro|actor@example.com")),
        thread_id: Uuid::nil(),
        added: vec![LabelRef {
            label_id: Some(Uuid::nil()),
            provider_label_id: "Label_1".to_string(),
            name: Some("Receipts".to_string()),
        }],
        removed: vec![],
        origin: EmailEventOrigin::UserAction,
    });

    assert_eq!(
        public_payload(&event),
        json!({
            "event_type": "email.thread_labels_updated",
            "metadata": {
                "link_id": "00000000-0000-0000-0000-000000000000",
                "thread_id": "00000000-0000-0000-0000-000000000000",
                "actor": "macro|actor@example.com",
                "added": [{
                    "label_id": "00000000-0000-0000-0000-000000000000",
                    "provider_label_id": "Label_1",
                    "name": "Receipts"
                }],
                "removed": [],
                "origin": "user_action"
            }
        })
    );
}
