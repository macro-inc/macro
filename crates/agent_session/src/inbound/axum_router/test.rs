//! The wire contract of the raw-log endpoint.
//!
//! `/channel/{id}/log` exists so a client can run the fold itself, which only
//! works if what the endpoint emits deserializes back into the vocabulary the
//! fold consumes. These tests are that round trip: serialize the response,
//! decode it the way a client would, and check the fold reaches the same place
//! it would have on the server.

use super::*;
use crate::domain::model::AgentSessionLog;
use agent_fold::domain::fold::fold;
use agent_fold::testing::{TURN, parse_log_as, test_session};
use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;

/// One entry as a client reads it back: the attribution, and the frame's own
/// two fields flattened in beside it.
///
/// Written out by hand rather than reusing [`AgentSessionLogEntryDto`] so the
/// test decodes the JSON on its own terms - if the DTO's shape drifts, this
/// fails instead of drifting with it.
#[derive(Debug, Deserialize)]
struct WireEntry {
    #[serde(rename = "userId")]
    user_id: Option<String>,
    #[serde(flatten)]
    message: Message,
}

/// Serialize a log the way the endpoint does, then decode it the way a client
/// would.
fn round_trip(entries: Vec<AgentSessionLog>) -> Vec<WireEntry> {
    let response = AgentChannelLogResponse::from(ChannelSessionLog {
        agent_session_id: test_session(),
        entries,
    });
    let json = serde_json::to_string(&response).expect("the response serializes");

    #[derive(Deserialize)]
    struct Wire {
        entries: Vec<WireEntry>,
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

/// Attribution survives, and only where it existed: the fixture attributes
/// exactly its prompt frames, and an unattributed frame carries no `userId`
/// key at all rather than a null.
#[test]
fn attribution_survives_the_round_trip() {
    let recorded = parse_log_as(test_session(), TURN);
    let attributed = recorded
        .iter()
        .filter(|entry| entry.user_id.is_some())
        .count();
    assert!(attributed > 0, "the fixture attributes its prompts");

    let decoded = round_trip(recorded.clone());
    assert_eq!(
        decoded
            .iter()
            .filter(|entry| entry.user_id.is_some())
            .count(),
        attributed
    );
    for (decoded, recorded) in decoded.iter().zip(&recorded) {
        assert_eq!(
            decoded.user_id,
            recorded.user_id.as_ref().map(ToString::to_string),
            "the same frames are attributed, to the same people"
        );
    }

    let value: serde_json::Value = serde_json::to_value(AgentSessionLogEntryDto::from(
        recorded
            .iter()
            .find(|entry| entry.user_id.is_none())
            .expect("the fixture has unattributed frames")
            .clone(),
    ))
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
