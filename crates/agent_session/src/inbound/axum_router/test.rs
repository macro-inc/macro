//! The wire contract of the raw-log endpoint.
//!
//! `/channel/{id}/log` exists so a client can run the fold itself, which only
//! works if what the endpoint emits deserializes back into the vocabulary the
//! fold consumes. These tests are that round trip: serialize the response,
//! decode it the way a client would, and check the fold reaches the same place
//! it would have on the server.

use super::*;
use crate::domain::model::{AgentSessionLog, SessionBot};
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
fn round_trip(entries: Vec<AgentSessionLog>) -> Vec<AgentSessionLogEntryDto> {
    let response = AgentChannelLogResponse::from(ChannelSessionLog {
        agent_session_id: test_session(),
        bot: SessionBot {
            id: BotId::new_from_uuid(macro_uuid::Uuid::from_u128(0xb07)),
            name: "Test Agent".to_owned(),
            avatar_url: None,
        },
        entries,
    });
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
/// and they must not, because a channel's placeholder rows are keyed on turn
/// numbering that both sides have to derive identically.
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
        serde_json::to_value(AgentSessionLogEntryDto::from(unattributed.clone()))
            .expect("the entry serializes");
    assert!(
        value.get("userId").is_none(),
        "an unattributed frame omits the key rather than sending null: {value}"
    );
}

/// The frame is flattened in rather than nested: an entry is the recording's
/// own `{direction, content}` shape with the attribution alongside, so the
/// same parser reads a stored recording and an endpoint response.
#[test]
fn an_entry_is_a_recording_line_plus_attribution() {
    let recorded = parse_log_as(test_session(), TURN);
    let prompt = recorded
        .iter()
        .find(|entry| entry.user_id.is_some())
        .expect("the fixture attributes its prompt");

    let value: serde_json::Value =
        serde_json::to_value(AgentSessionLogEntryDto::from(prompt.clone()))
            .expect("the entry serializes");

    let object = value.as_object().expect("an entry is a JSON object");
    assert_eq!(
        object.keys().map(String::as_str).collect::<Vec<_>>(),
        vec!["userId", "direction", "content"],
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
