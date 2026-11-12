//! Naming senders and group participants WhatsApp sent without a name.

use std::collections::HashMap;

use chrono::{TimeZone, Utc};
use whatsapp_linked::domain::events::{InboundEvent, InboundKind};
use whatsapp_linked::domain::models::{GroupInfo, Identity, Participant};
use whatsmeow::Event;
use whatsmeow::proto::wa_e2e;
use whatsmeow::store::{ContactStore, LidStore, MemoryStore};
use whatsmeow::types::events::Message;
use whatsmeow::types::{
    ContactInfo, DEFAULT_USER_SERVER, GROUP_SERVER, Jid, MessageInfo, MessageSource, new_jid,
};

use super::super::{
    complete_addresses, complete_participant_names, complete_sender_name, map_event,
};
use super::{ACCOUNT, inbound, now, plain_locator};

/// A group message as history pages carry it: by LID, usually with no name.
fn history_message(sender: &str, push_name: &str) -> Event {
    Event::Message(Box::new(Message {
        info: MessageInfo {
            source: MessageSource {
                chat: new_jid("120363000000000001", GROUP_SERVER),
                sender: sender.parse().unwrap(),
                is_group: true,
                ..MessageSource::default()
            },
            id: "3EB0NAME".to_owned(),
            push_name: push_name.to_owned(),
            timestamp: Some(Utc.with_ymd_and_hms(2026, 10, 21, 11, 59, 0).unwrap()),
            ..MessageInfo::default()
        },
        message: Some(wa_e2e::Message {
            conversation: Some("hi".to_owned()),
            ..Default::default()
        }),
        ..Message::default()
    }))
}

fn sender_name(event: &InboundEvent) -> Option<&str> {
    let InboundKind::Message(message) = &event.kind else {
        panic!("expected a message");
    };
    message.sender.display_name.as_deref()
}

fn lid() -> Jid {
    "987654321@lid".parse().unwrap()
}

/// A phone-number JID (built, so the test holds no address-like literals).
fn phone_jid(number: &str) -> Jid {
    new_jid(number, DEFAULT_USER_SERVER)
}

fn phone() -> Jid {
    phone_jid("15550001111")
}

#[tokio::test]
async fn a_lid_sender_without_a_name_takes_the_push_name_the_store_saw() {
    let store = MemoryStore::default();
    store.put_lid_mapping(&lid(), &phone()).await.unwrap();
    // A push-name history sync, or an earlier live message, keyed by phone.
    store.put_push_name(&phone(), "Ada").await.unwrap();
    store
        .put_contact_name(&phone(), "Ada Lovelace", "Ada")
        .await
        .unwrap();
    let mut event = inbound(map_event(
        ACCOUNT,
        &history_message("987654321@lid", ""),
        now(),
        &plain_locator,
    ));
    assert_eq!(sender_name(&event), None);

    complete_addresses(&store, &mut event).await.unwrap();
    let named = complete_sender_name(&store, &mut event).await.unwrap();

    assert!(named);
    assert_eq!(
        sender_name(&event),
        Some("Ada"),
        "their own WhatsApp name wins over the owner's address book"
    );
}

#[tokio::test]
async fn an_address_book_name_names_a_sender_with_no_push_name() {
    let store = MemoryStore::default();
    store
        .put_contact_name(&lid(), "Ada Lovelace", "Ada")
        .await
        .unwrap();
    let mut event = inbound(map_event(
        ACCOUNT,
        &history_message("987654321@lid", "-"),
        now(),
        &plain_locator,
    ));
    assert_eq!(sender_name(&event), None, "`-` is WhatsApp's no-name");

    complete_sender_name(&store, &mut event).await.unwrap();

    assert_eq!(sender_name(&event), Some("Ada Lovelace"));
}

#[tokio::test]
async fn a_name_the_message_carries_is_kept() {
    let store = MemoryStore::default();
    store.put_push_name(&lid(), "Old name").await.unwrap();
    let mut event = inbound(map_event(
        ACCOUNT,
        &history_message("987654321@lid", "New name"),
        now(),
        &plain_locator,
    ));

    let named = complete_sender_name(&store, &mut event).await.unwrap();

    assert!(!named);
    assert_eq!(sender_name(&event), Some("New name"));
}

#[tokio::test]
async fn a_sender_nobody_named_stays_unnamed() {
    let mut event = inbound(map_event(
        ACCOUNT,
        &history_message("987654321@lid", ""),
        now(),
        &plain_locator,
    ));

    let named = complete_sender_name(&MemoryStore::default(), &mut event)
        .await
        .unwrap();

    assert!(!named);
    assert_eq!(sender_name(&event), None);
}

#[test]
fn roster_participants_without_names_are_named_from_contacts() {
    let participant = |number: &str, alternate: Option<&str>, name: Option<&str>| Participant {
        identity: Identity {
            jid: phone_jid(number).to_string(),
            alternate_jid: alternate.map(str::to_owned),
            display_name: name.map(str::to_owned),
        },
        admin: false,
    };
    let mut group = GroupInfo {
        jid: new_jid("120363000000000001", GROUP_SERVER).to_string(),
        name: "Family".to_owned(),
        participants: vec![
            participant("15550001111", Some("987654321@lid"), None),
            participant("15550002222", None, Some("Ben")),
            participant("15550003333", None, None),
        ],
        announce: false,
        disappearing_seconds: None,
        community_parent: false,
        community_jid: None,
        community_announcements: false,
        observed_at: now(),
    };
    let contacts = HashMap::from([
        (
            lid(),
            ContactInfo {
                push_name: "Ada".to_owned(),
                ..ContactInfo::default()
            },
        ),
        (
            phone_jid("15550002222"),
            ContactInfo {
                push_name: "Not Ben".to_owned(),
                ..ContactInfo::default()
            },
        ),
    ]);

    complete_participant_names(&contacts, &mut group);

    let names: Vec<Option<&str>> = group
        .participants
        .iter()
        .map(|participant| participant.identity.display_name.as_deref())
        .collect();
    assert_eq!(names, vec![Some("Ada"), Some("Ben"), None]);
}
