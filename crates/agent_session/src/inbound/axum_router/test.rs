//! The wire contract of the raw-log endpoint.
//!
//! `/agent-sessions/{id}/log` exists so a client can run the fold itself,
//! which only works if what the endpoint emits deserializes back into the
//! vocabulary the fold consumes. These tests are that round trip: serialize the response,
//! decode it the way a client would, and check the fold reaches the same place
//! it would have on the server.

use super::*;
use crate::domain::model::{AgentSessionLog, SessionBot, SessionLog, StoredAgentSessionLog};
use agent_fold::domain::fold::fold;
use agent_fold::testing::{TURN, parse_log_as, test_session};
use bots::domain::models::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;

/// Serialize a log the way the endpoint does, then decode it the way a client
/// would - into [`AgentSessionLogEntryDto`] itself, the type this crate
/// already builds the response from. If its shape ever stops round-tripping
/// through its own `Serialize`/`Deserialize`, that is exactly the drift this
/// test exists to catch.
/// A frame as the log would have stored it. The time is fixed rather than
/// `now()` so a serialized entry is byte-stable.
fn stored(entry: AgentSessionLog) -> StoredAgentSessionLog {
    StoredAgentSessionLog {
        created_at: DateTime::from_timestamp(1_700_000_000, 0).expect("a valid timestamp"),
        entry,
    }
}

fn round_trip(entries: Vec<AgentSessionLog>) -> Vec<AgentSessionLogEntryDto> {
    let log = SessionLog {
        bot: SessionBot {
            id: BotId::new_from_uuid(macro_uuid::Uuid::from_u128(0xb07)),
            name: "Test Agent".to_owned(),
            avatar_url: None,
        },
        entries: entries.into_iter().map(stored).collect(),
    };
    let response = AgentSessionLogResponse {
        bot: log.bot,
        entries: log.entries.into_iter().map(Into::into).collect(),
    };
    let json = serde_json::to_string(&response).expect("the response serializes");

    #[derive(Deserialize)]
    struct Wire {
        entries: Vec<AgentSessionLogEntryDto>,
    }
    let wire: Wire = serde_json::from_str(&json).expect("a client can decode it");
    wire.entries
}

/// The round trip is lossless where it matters: a log decoded from the
/// endpoint folds to exactly what the same log folds to on the server.
///
/// This is what lets the fold move to the client without the two disagreeing -
/// and they must not, because both sides derive the same turn numbering from
/// the same frames.
#[test]
fn a_decoded_log_folds_to_what_the_server_folds() {
    let recorded = parse_log_as(test_session(), TURN);
    let decoded: Vec<AgentSessionLog> = round_trip(recorded.clone())
        .into_iter()
        .map(|entry| AgentSessionLog {
            agent_session_id: test_session(),
            user_id: entry.user_id.map(|user| {
                MacroUserIdStr::try_from(user).expect("the id round-trips through its string form")
            }),
            content: entry.message,
        })
        .collect();

    assert_eq!(decoded.len(), recorded.len());
    assert_eq!(fold(decoded), fold(recorded));
}

/// An unattributed frame carries no `userId` key at all rather than a null.
///
/// Not covered by [`a_decoded_log_folds_to_what_the_server_folds`]: fold
/// equivalence would already fail if attribution round-tripped to the wrong
/// value, but omitted-vs-null is a wire-shape detail that decoding to
/// `Option<String>` erases either way - only inspecting the raw JSON can
/// tell the two apart.
#[test]
fn unattributed_frames_omit_the_user_id_key() {
    let recorded = parse_log_as(test_session(), TURN);
    let unattributed = recorded
        .iter()
        .find(|entry| entry.user_id.is_none())
        .expect("the fixture has unattributed frames");

    let value: serde_json::Value =
        serde_json::to_value(AgentSessionLogEntryDto::from(stored(unattributed.clone())))
            .expect("the entry serializes");
    assert!(
        value.get("userId").is_none(),
        "an unattributed frame omits the key rather than sending null: {value}"
    );
}

/// The frame is flattened in rather than nested: an entry is the recording's
/// own `{direction, content}` shape with the attribution and the log's own
/// timestamp alongside, so the same parser reads a stored recording and an
/// endpoint response.
#[test]
fn an_entry_is_a_recording_line_plus_attribution() {
    let recorded = parse_log_as(test_session(), TURN);
    let prompt = recorded
        .iter()
        .find(|entry| entry.user_id.is_some())
        .expect("the fixture attributes its prompt");

    let value: serde_json::Value =
        serde_json::to_value(AgentSessionLogEntryDto::from(stored(prompt.clone())))
            .expect("the entry serializes");

    let object = value.as_object().expect("an entry is a JSON object");
    assert_eq!(
        object.keys().map(String::as_str).collect::<Vec<_>>(),
        vec!["createdAt", "userId", "direction", "content"],
        "no envelope around the frame"
    );
    assert_eq!(
        object["direction"], "to_runtime",
        "a prompt travels inbound"
    );
    assert_eq!(
        object["content"]["method"], "session/prompt",
        "the envelope is the ACP frame verbatim"
    );
}

/// The control body's wire shape: the operation's tag sits at the top level
/// beside its fields, not nested under a `kind` object.
#[test]
fn a_control_request_reads_the_operation_from_the_top_level() {
    let stop: ControlRequest = serde_json::from_str(r#"{"kind":"stop"}"#).expect("a stop decodes");
    assert_eq!(stop.kind, ControlEventKind::Stop);

    let change: ControlRequest = serde_json::from_str(r#"{"kind":"change_model","model":"opus"}"#)
        .expect("a model change decodes");
    assert_eq!(
        change.kind,
        ControlEventKind::ChangeModel {
            model: "opus".to_owned()
        }
    );

    let prompt: ControlRequest =
        serde_json::from_str(r#"{"kind":"prompt","content":"do the thing"}"#)
            .expect("a prompt decodes");
    assert_eq!(
        prompt.kind,
        ControlEventKind::Prompt {
            content: "do the thing".to_owned()
        }
    );
}
