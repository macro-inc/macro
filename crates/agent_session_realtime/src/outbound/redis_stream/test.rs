use agent_runtime_protocol::domain::schema::v0::{SystemEvent, ToServerMessage};
use agent_session::domain::events::{LogAppendedEntry, LogAppendedMetadata};
use agent_session::domain::model::{AgentSessionId, Message};
use macro_uuid::Uuid;

use super::*;

#[test]
fn the_retention_floor_trims_entries_older_than_retention() {
    let retention_ms = u64::try_from(RETENTION.as_millis()).expect("fits");
    assert_eq!(
        retention_floor(retention_ms + 1_000),
        "1000-0",
        "an id at the floor's millisecond and later survives"
    );
}

#[test]
fn the_retention_floor_never_underflows() {
    assert_eq!(retention_floor(5), "0-0");
}

#[test]
fn an_entry_id_names_the_millisecond_it_was_added_at() {
    assert_eq!(entry_id_ms("1791910053617-3"), Some(1_791_910_053_617));
    assert_eq!(entry_id_ms("not-an-id"), None);
    assert_eq!(entry_id_ms("12345"), None);
}

#[test]
fn a_run_survives_its_wire_encoding() {
    let run = LogAppendedMetadata {
        agent_session_id: AgentSessionId::TEST_A,
        entries: vec![LogAppendedEntry {
            id: Uuid::from_u128(1),
            created_at: chrono::Utc::now(),
            user_id: None,
            content: Message::ToServer(ToServerMessage::Event {
                event: SystemEvent::AcpReady,
            }),
        }],
    };

    let decoded = decode(encode(&run).expect("encodes").as_bytes()).expect("decodes");

    assert_eq!(decoded.agent_session_id, run.agent_session_id);
    assert_eq!(decoded.entries.len(), 1);
    assert_eq!(decoded.entries[0].id, run.entries[0].id);
    assert_eq!(decoded.entries[0].created_at, run.entries[0].created_at);
}

#[test]
fn an_undecodable_payload_is_an_error_not_a_panic() {
    assert!(decode(b"{\"agent_session_id\":").is_err());
}
