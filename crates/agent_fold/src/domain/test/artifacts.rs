//! Files the Agent Service collected after a turn ended.
//!
//! The frame is not ACP and arrives out of band, so what these pin is where
//! it lands: on the agent message of the turn that produced it, however much
//! later it shows up.

use super::util::{TURN, capturing_warnings, parse_log};
use crate::domain::fold::{FoldMachineImpl, fold};
use crate::domain::model::{Author, FoldEvent, MessagePart};
use crate::domain::ports::FoldMachine;
use crate::testing::fixtures::ARTIFACTS;

/// One `artifacts` frame, as the Agent Service writes it.
fn artifacts_frame(items: &str) -> String {
    format!(r#"{{"direction":"to_server","content":{{"type":"artifacts","artifacts":[{items}]}}}}"#)
}

/// One screenshot, named by its suffix so two frames are told apart.
fn screenshot(suffix: &str) -> String {
    format!(
        r#"{{"key":"walkthrough/{suffix}.png@1","uri":"https://macro.com/api/agent-artifacts/{suffix}","name":"{suffix}.png","mimeType":"image/png","sizeBytes":11}}"#
    )
}

const PROMPT: &str = r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"p2","method":"session/prompt","params":{"sessionId":"s1","prompt":[{"type":"text","text":"and again"}]}}}"#;

/// A turn that produced nothing at all: the prompt is answered with a stop
/// reason and no content, which mints an agent message carrying only empty
/// prose.
const SILENT_TURN: &str = concat!(
    r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"p1","method":"session/prompt","params":{"sessionId":"s1","prompt":[{"type":"text","text":"record it"}]}}}"#,
    "\n",
    r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"p1","result":{"stopReason":"end_turn"}}}"#,
);

/// The artifacts part of a message, wherever it sits among its parts.
fn artifacts_part(parts: &[MessagePart]) -> &Vec<crate::domain::model::ArtifactItem> {
    parts
        .iter()
        .find_map(|part| match part {
            MessagePart::Artifacts { items } => Some(items),
            _ => None,
        })
        .unwrap_or_else(|| panic!("an artifacts part: {parts:#?}"))
}

/// The whole fixture: a turn that ended, then its walkthrough.
#[test]
fn appends_collected_files_to_the_agent_message() {
    let (messages, warnings) = capturing_warnings(|| fold(parse_log(ARTIFACTS)));

    assert_eq!(
        warnings,
        vec![],
        "a collected walkthrough warns about nothing"
    );
    assert_eq!(messages.len(), 2, "one user message, one agent message");

    let agent = &messages[1];
    assert_eq!(agent.author, Author::Agent);
    assert_eq!(
        agent.stop,
        Some(crate::domain::model::StopReason::EndTurn),
        "the frame does not reopen the turn or move its stop reason"
    );

    let parts = agent.parts.as_slice();
    assert!(
        matches!(parts.last(), Some(MessagePart::Artifacts { .. })),
        "the files go on the end: {parts:#?}"
    );
    insta::assert_debug_snapshot!(artifacts_part(parts));
}

/// A turn whose agent said nothing still gets its files - on a message minted
/// for them, carrying nothing else.
#[test]
fn a_silent_turn_gets_a_message_of_its_own() {
    let log = format!("{SILENT_TURN}\n{}", artifacts_frame(&screenshot("only")));
    let messages = fold(parse_log(&log));

    // The prompt's own message, the message `close_turn` minted for the stop
    // reason, and nothing else: the files land on the one already there.
    assert_eq!(messages.len(), 2, "{messages:#?}");
    let agent = &messages[1];
    assert_eq!(agent.author, Author::Agent);
    assert_eq!(artifacts_part(agent.parts.as_slice()).len(), 1);
}

/// Nothing has closed the turn, so no agent message exists at all and one is
/// minted holding only the files.
#[test]
fn an_unanswered_turn_mints_a_message_holding_only_the_files() {
    let log = format!(
        "{}\n{}",
        r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"p1","method":"session/prompt","params":{"sessionId":"s1","prompt":[{"type":"text","text":"record it"}]}}}"#,
        artifacts_frame(&screenshot("only"))
    );
    let messages = fold(parse_log(&log));

    assert_eq!(messages.len(), 2, "{messages:#?}");
    let agent = &messages[1];
    assert_eq!(agent.author, Author::Agent);
    assert_eq!(
        agent.id, messages[0].id,
        "attributed to the turn it followed"
    );
    assert_eq!(agent.stop, None, "the turn is not closed by its files");
    assert!(
        matches!(agent.parts.as_slice(), [MessagePart::Artifacts { .. }]),
        "only the files: {:#?}",
        agent.parts
    );
}

/// The pull is asynchronous, so the frame can land after the user has already
/// asked something else. It belongs to the turn that produced it, not to
/// whatever is running now.
#[test]
fn a_late_frame_attaches_to_the_previous_turn() {
    let log = format!(
        "{}\n{PROMPT}\n{}",
        ARTIFACTS.trim_end(),
        artifacts_frame(&screenshot("late"))
    );
    let messages = fold(parse_log(&log));

    let agent = messages
        .iter()
        .filter(|message| message.author == Author::Agent)
        .collect::<Vec<_>>();
    assert_eq!(agent.len(), 1, "the new turn has answered nothing yet");
    assert_eq!(
        artifacts_part(agent[0].parts.as_slice()).len(),
        3,
        "the late file joins the two the turn already had"
    );
    assert!(
        matches!(
            messages.last().map(|message| &message.author),
            Some(Author::User { .. })
        ),
        "the new turn's prompt is still the transcript's tail: {messages:#?}"
    );
}

/// Two frames merge into one strip rather than stacking two parts.
#[test]
fn consecutive_frames_merge_into_one_part() {
    let log = format!(
        "{}\n{}\n{}",
        ARTIFACTS.trim_end(),
        artifacts_frame(&screenshot("second")),
        artifacts_frame(&screenshot("third"))
    );
    let messages = fold(parse_log(&log));

    let parts = messages[1].parts.as_slice();
    assert_eq!(
        parts
            .iter()
            .filter(|part| matches!(part, MessagePart::Artifacts { .. }))
            .count(),
        1,
        "one strip, not three: {parts:#?}"
    );
    let items = artifacts_part(parts);
    assert_eq!(items.len(), 4);
    assert_eq!(items[3].name, "third.png", "appended in arrival order");
}

/// An empty collection says only that nothing was produced, so it derives no
/// part and warns about nothing.
#[test]
fn an_empty_frame_is_a_no_op() {
    let log = format!("{}\n{}", TURN.trim_end(), artifacts_frame(""));
    let (messages, warnings) = capturing_warnings(|| fold(parse_log(&log)));

    assert_eq!(warnings, vec![], "an empty collection is not an anomaly");
    assert_eq!(messages, fold(parse_log(TURN)));
}

/// The streaming path reports the same message update any appended part
/// does, so a live subscriber sees the strip without a reload.
#[test]
fn the_frame_reports_the_message_it_updated() {
    let mut machine = FoldMachineImpl::new();
    let mut last = None;
    for entry in parse_log(ARTIFACTS) {
        for event in machine.push(entry) {
            if let FoldEvent::MessageUpdate(message) = event {
                last = Some(message.into_owned());
            }
        }
    }

    let updated = last.expect("the agent message was updated");
    assert_eq!(updated.author, Author::Agent);
    assert_eq!(
        artifacts_part(updated.parts.as_slice()).len(),
        2,
        "the update carries the files, not just the stop reason"
    );
    assert_eq!(
        machine.messages(),
        fold(parse_log(ARTIFACTS)),
        "the stream and the batch fold agree"
    );
}
