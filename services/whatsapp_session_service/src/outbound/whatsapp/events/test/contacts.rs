//! Saved contacts and phone-number lookups as chat-list rows.

use std::collections::HashMap;

use external_chat::domain::models::ExternalChatKind;
use whatsapp_linked::domain::events::{ChatUpdate, LookupAnswer};
use whatsapp_linked::domain::jid::PhoneNumber;
use whatsmeow::Event;
use whatsmeow::proto::wa_sync_action::ContactAction;
use whatsmeow::proto::wa_vname_cert::verified_name_certificate::Details;
use whatsmeow::store::{ContactStore, MemoryStore};
use whatsmeow::types::events::Contact;
use whatsmeow::types::{
    ContactInfo, DEFAULT_USER_SERVER, IsOnWhatsAppResponse, VerifiedName, new_jid,
};

use super::super::{chat_setting, contact_chats, lookup_answer};

fn listed(jid: &str, name: &str) -> ChatUpdate {
    ChatUpdate {
        jid: jid.to_owned(),
        kind: ExternalChatKind::Direct,
        name: Some(name.to_owned()),
        last_activity_at: None,
        archived: None,
        pinned: None,
        anchor: None,
        create: true,
    }
}

#[test]
fn saved_contacts_are_listed_and_people_only_seen_in_groups_are_not() {
    let [dana, eve, shop] =
        ["5550001", "5550002", "5550003"].map(|user| new_jid(user, DEFAULT_USER_SERVER));
    let contacts = HashMap::from([
        (
            dana.clone(),
            ContactInfo {
                full_name: "Dana Smith".to_owned(),
                first_name: "Dana".to_owned(),
                push_name: "dana".to_owned(),
                ..ContactInfo::default()
            },
        ),
        (
            eve.clone(),
            ContactInfo {
                first_name: "Eve".to_owned(),
                ..ContactInfo::default()
            },
        ),
        (
            "987654321@lid".parse().unwrap(),
            ContactInfo {
                full_name: "Frank".to_owned(),
                ..ContactInfo::default()
            },
        ),
        (
            shop,
            ContactInfo {
                push_name: "Seen in a group".to_owned(),
                business_name: "Some shop".to_owned(),
                ..ContactInfo::default()
            },
        ),
    ]);

    let mut chats = contact_chats(&contacts);
    chats.sort_by(|a, b| a.jid.cmp(&b.jid));

    assert_eq!(
        chats,
        [
            listed(&dana.to_string(), "Dana Smith"),
            listed(&eve.to_string(), "Eve"),
            listed("987654321@lid", "Frank"),
        ]
    );
}

#[test]
fn a_contact_saved_on_the_phone_is_listed_at_once() {
    let eve = new_jid("5550002", DEFAULT_USER_SERVER);
    let event = Event::Contact(Box::new(Contact {
        jid: eve.clone(),
        timestamp: chrono::Utc::now(),
        action: Some(ContactAction {
            full_name: Some("Eve Adams".to_owned()),
            ..ContactAction::default()
        }),
        from_full_sync: false,
    }));

    assert_eq!(
        chat_setting(&event),
        Some(listed(&eve.to_string(), "Eve Adams"))
    );
}

#[tokio::test]
async fn a_registered_number_is_its_phone_chat_named_like_any_chat() {
    let store = MemoryStore::default();
    let dana = new_jid("5550001", DEFAULT_USER_SERVER);
    let corner_shop = new_jid("5550004", DEFAULT_USER_SERVER);
    store
        .put_contact_name(&dana, "Dana Smith", "Dana")
        .await
        .unwrap();
    // WhatsApp answers by LID with the number alongside.
    let registered = |business: Option<&str>| IsOnWhatsAppResponse {
        query: "+5550001".to_owned(),
        jid: "987654321@lid".parse().unwrap(),
        is_in: true,
        phone_number: dana.clone(),
        verified_name: business.map(|name| VerifiedName {
            details: Some(Details {
                verified_name: Some(name.to_owned()),
                ..Details::default()
            }),
            ..VerifiedName::default()
        }),
    };
    let phone = |number: &str| PhoneNumber::parse(number).unwrap();

    assert_eq!(
        lookup_answer(
            &store,
            &store,
            &phone("+5550001"),
            &[registered(Some("Dana's Bakery"))]
        )
        .await,
        LookupAnswer::Found {
            jid: dana.to_string(),
            name: Some("Dana Smith".to_owned()),
        },
        "the address book wins over the business name"
    );
    let unsaved = IsOnWhatsAppResponse {
        phone_number: corner_shop.clone(),
        ..registered(Some("Corner Shop"))
    };
    assert_eq!(
        lookup_answer(&store, &store, &phone("+5550004"), &[unsaved]).await,
        LookupAnswer::Found {
            jid: corner_shop.to_string(),
            name: Some("Corner Shop".to_owned()),
        }
    );
    let not_registered = IsOnWhatsAppResponse {
        is_in: false,
        ..registered(None)
    };
    assert_eq!(
        lookup_answer(&store, &store, &phone("+5550005"), &[not_registered]).await,
        LookupAnswer::NotOnWhatsApp
    );
    assert_eq!(
        lookup_answer(&store, &store, &phone("+5550005"), &[]).await,
        LookupAnswer::NotOnWhatsApp
    );
}
