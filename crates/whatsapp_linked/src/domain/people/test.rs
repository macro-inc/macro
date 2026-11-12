use super::*;
use crate::domain::models::{Identity, Participant};
use chrono::Utc;
use super::UNKNOWN_PERSON;
use external_chat::domain::timeline::{ExternalChatPersonRef, StoredPerson};

const ANA_LID: &str = "900000000001@lid";
const BEN_LID: &str = "900000000002@lid";
const CAL_LID: &str = "900000000003@lid";

/// A phone-number JID; numbers are short so they read as synthetic.
fn phone(number: &str) -> String {
    format!("{number}@s.whatsapp.net")
}

fn stored(id: u128) -> StoredPerson {
    StoredPerson {
        person_id: Uuid::from_u128(id),
        user_id: None,
    }
}

fn named(name: &str) -> ExternalChatPersonRef {
    ExternalChatPersonRef {
        name: name.to_owned(),
        user_id: None,
    }
}

#[test]
fn people_go_by_the_owners_contact_name_then_their_whatsapp_name_then_their_number() {
    let names = ChatNames::new(
        HashMap::from([(phone("5550001"), "Ana (work)".to_owned())]),
        vec![
            // Seen by LID in a history message without a WhatsApp name; the
            // owner saved her number.
            SeenPerson {
                person_id: Uuid::from_u128(1),
                user_id: None,
                whatsapp_name: Some("ana".to_owned()),
                jids: vec![ANA_LID.to_owned(), phone("5550001")],
            },
            SeenPerson {
                person_id: Uuid::from_u128(2),
                user_id: None,
                whatsapp_name: Some("Ben".to_owned()),
                jids: vec![BEN_LID.to_owned(), phone("5550002")],
            },
            SeenPerson {
                person_id: Uuid::from_u128(3),
                user_id: None,
                whatsapp_name: None,
                jids: vec![phone("5550003")],
            },
            SeenPerson {
                person_id: Uuid::from_u128(4),
                user_id: None,
                whatsapp_name: Some("  ".to_owned()),
                jids: vec![CAL_LID.to_owned()],
            },
        ],
    );

    let people = names.people(None);

    assert_eq!(people.person(&stored(1)), named("Ana (work)"));
    assert_eq!(people.person(&stored(2)), named("Ben"));
    assert_eq!(people.person(&stored(3)), named("+5550003"));
    assert_eq!(people.person(&stored(4)), named(UNKNOWN_PERSON));
    assert_eq!(people.person(&stored(5)), named(UNKNOWN_PERSON));
    // Mentions by either id name the same person.
    assert_eq!(people.get(ANA_LID), named("Ana (work)"));
    assert_eq!(people.get(&phone("5550002")), named("Ben"));
}

fn roster() -> GroupInfo {
    let participant = |jid: &str, alternate: Option<&str>, name: Option<&str>| Participant {
        identity: Identity {
            jid: jid.to_owned(),
            alternate_jid: alternate.map(str::to_owned),
            display_name: name.map(str::to_owned),
        },
        admin: false,
    };
    GroupInfo {
        jid: format!("{}@g.us", 120363000000000001_u64),
        name: "Family".to_owned(),
        participants: vec![
            participant(ANA_LID, Some(&phone("5550001")), None),
            participant(BEN_LID, Some(&phone("5550002")), None),
            participant(CAL_LID, None, None),
        ],
        announce: false,
        disappearing_seconds: None,
        community_parent: false,
        community_jid: None,
        community_announcements: false,
        observed_at: Utc::now(),
    }
}

#[test]
fn members_never_seen_writing_go_by_the_owners_contact_name_else_their_number() {
    let names = ChatNames::new(
        HashMap::from([(phone("5550001"), "Ana (work)".to_owned())]),
        vec![],
    );
    let mut members = roster();

    names.name_members(&mut members);

    let shown: Vec<Option<&str>> = members
        .participants
        .iter()
        .map(|participant| participant.identity.display_name.as_deref())
        .collect();
    assert_eq!(shown, vec![Some("Ana (work)"), Some("+5550002"), None]);
    let people = names.people(Some(&roster()));
    assert_eq!(people.get(BEN_LID), named("+5550002"));
    assert_eq!(people.get(ANA_LID), named("Ana (work)"));
}

#[test]
fn members_seen_writing_go_by_their_whatsapp_name() {
    let names = ChatNames::new(
        HashMap::new(),
        vec![SeenPerson {
            person_id: Uuid::from_u128(2),
            user_id: Some("macro|ben@example.com".to_owned()),
            whatsapp_name: Some("Ben".to_owned()),
            jids: vec![phone("5550002")],
        }],
    );
    let mut members = roster();

    names.name_members(&mut members);

    assert_eq!(
        members.participants[1].identity.display_name.as_deref(),
        Some("Ben")
    );
    assert_eq!(
        names.people(Some(&roster())).get(BEN_LID),
        ExternalChatPersonRef {
            name: "Ben".to_owned(),
            user_id: Some("macro|ben@example.com".to_owned()),
        }
    );
}
