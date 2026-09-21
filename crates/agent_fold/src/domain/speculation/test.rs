//! The two-tier fold's contract: speculate, promote, rebase, retract.

use std::collections::BTreeMap;

use super::*;
use crate::domain::model::{
    AnsweredField, AnsweredValue, Author, Control, ControlOutcome, ElicitationOutcome,
    ElicitationRequestId, MessagePart, StopReason, TurnId, TurnState,
};
use crate::testing::{TURN, parse_log, test_session};
use agent_client_protocol::schema::v1::SessionId;
use agent_runtime_protocol::domain::action::{ElicitationAnswer, ElicitationContentValue};
use chrono::{Duration, TimeZone, Utc};
use macro_uuid::Uuid;

/// The ACP session the `TURN` fixture runs in.
const ACP_SESSION: &str = "s1";

/// The id the agent asks its question under in [`blocked`].
const QUESTION_ID: ElicitationRequestId = ElicitationRequestId::Number(7);

fn cursor(index: usize) -> LogCursor {
    let index = u128::try_from(index).expect("small index");
    LogCursor {
        id: Uuid::from_u128(index + 1),
        created_at: Utc.with_ymd_and_hms(2026, 8, 13, 0, 0, 0).unwrap()
            + Duration::microseconds(i64::try_from(index).expect("small index")),
    }
}

fn rows(log: Vec<AgentSessionLog>) -> Vec<(LogCursor, AgentSessionLog)> {
    log.into_iter()
        .enumerate()
        .map(|(index, row)| (cursor(index), row))
        .collect()
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("eric@example.com").expect("test email parses")
}

/// The row the harness logs for `action` under `action_id` - built the way
/// the harness builds it, which is also how the fold speculates it.
fn logged(action: &AgentAction, action_id: AgentActionId) -> AgentSessionLog {
    AgentSessionLog {
        agent_session_id: test_session(),
        user_id: Some(user()),
        content: Message::ToRuntime(
            action
                .to_runtime(&SessionId::from(ACP_SESSION), action_id.to_request_id())
                .expect("action encodes"),
        ),
    }
}

fn speculation(action: AgentAction, action_id: AgentActionId) -> FoldInput {
    FoldInput::Speculated(Speculation::new(action_id, action, Some(user())))
}

/// A fold that has folded the whole `TURN` fixture: one closed turn.
fn settled() -> SpeculativeFold {
    let mut fold = SpeculativeFold::new(test_session());
    fold.push(FoldInput::Snapshot(rows(parse_log(TURN))))
        .expect("snapshot");
    assert_eq!(fold.metadata().turn, TurnState::Idle);
    fold
}

/// A fold whose turn is still open: the fixture up to the agent's first chunk.
fn mid_turn() -> SpeculativeFold {
    let open: String = TURN.lines().take(5).collect::<Vec<_>>().join("\n");
    let mut fold = SpeculativeFold::new(test_session());
    fold.push(FoldInput::Snapshot(rows(parse_log(&open))))
        .expect("snapshot");
    assert_eq!(fold.metadata().turn, TurnState::Running);
    fold
}

/// A fold whose open turn is blocked on a question the agent asked.
fn blocked() -> SpeculativeFold {
    let mut log: Vec<&str> = TURN.lines().take(5).collect();
    log.push(
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":7,"method":"elicitation/create","params":{"mode":"form","sessionId":"s1","message":"Which colour?","requestedSchema":{"type":"object","properties":{"colour":{"type":"string","title":"Colour"}}}}}}"#,
    );
    let mut fold = SpeculativeFold::new(test_session());
    fold.push(FoldInput::Snapshot(rows(parse_log(&log.join("\n")))))
        .expect("snapshot");
    assert_eq!(fold.metadata().turn, TurnState::Blocked);
    fold
}

/// Submitting `colour` to the question [`blocked`] holds open.
fn accept(colour: &str) -> AgentAction {
    AgentAction::respond_elicitation(
        QUESTION_ID,
        ElicitationAnswer::Accept {
            content: Some(BTreeMap::from([(
                "colour".to_owned(),
                ElicitationContentValue::Text(colour.to_owned()),
            )])),
        },
    )
}

/// The question's outcome, and whether the message holding it is pending.
fn question(fold: &SpeculativeFold) -> (ElicitationOutcome, bool) {
    fold.messages()
        .iter()
        .find_map(|message| {
            message.parts.iter().find_map(|part| match part {
                MessagePart::Elicitation { outcome, .. } => {
                    Some((outcome.clone(), message.pending))
                }
                _ => None,
            })
        })
        .expect("the question is in the transcript")
}

/// Whether each stop line in the transcript is still pending, in order.
fn stops(fold: &SpeculativeFold) -> Vec<bool> {
    fold.messages()
        .iter()
        .filter(|message| {
            matches!(
                message.parts.first(),
                Some(MessagePart::Control {
                    control: Control::Stop,
                    ..
                })
            )
        })
        .map(|message| message.pending)
        .collect()
}

fn user_texts(messages: &[FoldedMessage]) -> Vec<(String, bool)> {
    messages
        .iter()
        .filter(|message| matches!(message.author, Author::User { .. }))
        .filter_map(|message| match message.parts.first() {
            Some(MessagePart::Text { text }) => Some((text.clone(), message.pending)),
            _ => None,
        })
        .collect()
}

fn is_replace(events: &[FoldEvent<'_>]) -> bool {
    matches!(
        events,
        [
            FoldEvent::MessagesReplaced(_),
            FoldEvent::MetadataUpdated(_)
        ]
    )
}

#[test]
fn nothing_is_accepted_before_a_snapshot() {
    let mut fold = SpeculativeFold::new(test_session());
    let id = AgentActionId::mint();
    assert_eq!(
        fold.push(FoldInput::Confirmed(
            cursor(0),
            logged(&AgentAction::prompt("hi"), id)
        ))
        .unwrap_err(),
        SpeculationError::NoSnapshot
    );
    assert_eq!(
        fold.push(speculation(AgentAction::prompt("hi"), id))
            .unwrap_err(),
        SpeculationError::NoSnapshot
    );
}

#[test]
fn a_speculated_answer_resolves_the_question_and_unblocks_the_turn() {
    let mut fold = blocked();
    let before = fold.messages().len();
    let id = AgentActionId::mint();

    fold.push(speculation(accept("red"), id)).unwrap();

    let (outcome, pending) = question(&fold);
    assert_eq!(
        outcome,
        ElicitationOutcome::Accepted {
            answers: vec![AnsweredField {
                name: "colour".to_owned(),
                label: "Colour".to_owned(),
                value: AnsweredValue::Text {
                    text: "red".to_owned()
                },
            }],
        }
    );
    assert!(pending, "the message holding the question is unconfirmed");
    assert!(fold.metadata().pending_elicitation().is_none());
    assert_eq!(fold.metadata().turn, TurnState::Running);
    // The answer resolves a part; it mints no message of its own.
    assert_eq!(fold.messages().len(), before);
    assert_eq!(fold.pending().collect::<Vec<_>>(), vec![id]);
}

#[test]
fn the_confirmed_answer_promotes_by_content() {
    let mut fold = blocked();
    let id = AgentActionId::mint();
    fold.push(speculation(accept("red"), id)).unwrap();
    let speculated = fold.messages().len();

    // The harness logs the answer under the agent's request id, so the row
    // carries no action id at all and matches on content.
    fold.push(FoldInput::Confirmed(
        cursor(99),
        logged(&accept("red"), AgentActionId::mint()),
    ))
    .unwrap();

    assert_eq!(fold.pending().count(), 0);
    assert!(fold.fork.is_none());
    let (outcome, pending) = question(&fold);
    assert!(matches!(outcome, ElicitationOutcome::Accepted { .. }));
    assert!(!pending);
    assert_eq!(fold.messages().len(), speculated, "nothing was duplicated");
    assert_eq!(fold.metadata().turn, TurnState::Running);
}

#[test]
fn retracting_an_answer_restores_the_question() {
    let mut fold = blocked();
    let id = AgentActionId::mint();
    fold.push(speculation(accept("red"), id)).unwrap();

    let events = fold.push(FoldInput::Retracted(id)).unwrap();

    assert!(is_replace(&events));
    assert_eq!(question(&fold), (ElicitationOutcome::Pending, false));
    assert!(fold.metadata().pending_elicitation().is_some());
    assert_eq!(fold.metadata().turn, TurnState::Blocked);
}

#[test]
fn a_speculated_decline_reads_as_declined() {
    let mut fold = blocked();
    fold.push(speculation(
        AgentAction::respond_elicitation(QUESTION_ID, ElicitationAnswer::Decline),
        AgentActionId::mint(),
    ))
    .unwrap();

    assert_eq!(question(&fold).0, ElicitationOutcome::Declined);
    assert_eq!(fold.metadata().turn, TurnState::Running);
}

#[test]
fn answering_a_question_already_answered_changes_nothing() {
    let mut fold = blocked();
    fold.push(speculation(accept("red"), AgentActionId::mint()))
        .unwrap();
    let answered: Vec<FoldedMessage> = fold.messages().to_vec();

    let events = fold
        .push(speculation(accept("blue"), AgentActionId::mint()))
        .unwrap();

    assert!(events.is_empty());
    assert_eq!(fold.pending().count(), 1);
    assert_eq!(fold.messages(), answered.as_slice());
}

#[test]
fn a_stop_beats_a_question_the_user_walked_away_from() {
    let mut fold = blocked();

    fold.push(speculation(AgentAction::Stop, AgentActionId::mint()))
        .unwrap();

    assert_eq!(fold.metadata().turn, TurnState::Stopping);
}

#[test]
fn a_stop_speculated_before_the_session_id_is_known_still_promotes() {
    let mut fold = SpeculativeFold::new(test_session());
    fold.push(FoldInput::Snapshot(rows(parse_log(
        r#"{"direction":"to_server","content":{"type":"event","event":"acp_ready"}}"#,
    ))))
    .unwrap();
    assert_eq!(fold.committed.machine.acp_session_id(), None);

    let id = AgentActionId::mint();
    fold.push(speculation(AgentAction::Stop, id)).unwrap();
    let Message::ToRuntime(ToRuntimeMessage::Acp(acp)) = &fold.suffix[0].frame.content else {
        panic!("a runtime-bound frame");
    };
    let RawJsonRpcMessage::Notification(notification) = &acp.0 else {
        panic!("a notification");
    };
    let params = serde_json::to_value(notification.params.as_ref()).unwrap();
    assert_eq!(params["sessionId"], PLACEHOLDER_ACP_SESSION);

    // The harness sent the cancel into the session the runtime had by then.
    fold.push(FoldInput::Confirmed(
        cursor(99),
        logged(&AgentAction::Stop, AgentActionId::mint()),
    ))
    .unwrap();

    assert_eq!(fold.pending().count(), 0);
    assert!(fold.fork.is_none());
    assert_eq!(stops(&fold), vec![false], "one stop line, confirmed");
}

#[test]
fn stopping_twice_leaves_one_stop_line() {
    let mut fold = mid_turn();
    fold.push(speculation(AgentAction::Stop, AgentActionId::mint()))
        .unwrap();

    let events = fold
        .push(speculation(AgentAction::Stop, AgentActionId::mint()))
        .unwrap();

    assert!(events.is_empty());
    assert_eq!(stops(&fold), vec![true]);
    assert_eq!(fold.pending().count(), 1);
}

#[test]
fn a_speculated_prompt_is_pending_and_the_turn_is_starting() {
    let mut fold = settled();
    let before = fold.messages().len();
    let id = AgentActionId::mint();

    let events = fold
        .push(speculation(AgentAction::prompt("hi"), id))
        .unwrap();

    let message = events
        .iter()
        .find_map(|event| match event {
            FoldEvent::NewMessage(message) => Some(message.clone().into_owned()),
            _ => None,
        })
        .expect("the prompt is reported new");
    assert_eq!(message.request_id, Some(id));
    assert!(message.pending);
    assert_eq!(
        message.author,
        Author::User {
            user_id: Some(user())
        }
    );
    assert!(
        events
            .iter()
            .any(|event| matches!(event, FoldEvent::MetadataUpdated(_))),
        "the turn state moved"
    );
    assert_eq!(fold.messages().len(), before + 1);
    assert_eq!(fold.metadata().turn, TurnState::Starting);
    assert_eq!(fold.pending().collect::<Vec<_>>(), vec![id]);
}

#[test]
fn the_confirmed_row_promotes_the_speculation_in_place() {
    let mut fold = settled();
    let id = AgentActionId::mint();
    let action = AgentAction::prompt("hi");
    fold.push(speculation(action.clone(), id)).unwrap();
    let speculated: Vec<FoldedMessage> = fold.messages().to_vec();

    let events = fold
        .push(FoldInput::Confirmed(cursor(99), logged(&action, id)))
        .unwrap();

    // Not a replace: the reader already has this message and only its
    // pending mark changes.
    assert!(!is_replace(&events));
    let reported = events
        .iter()
        .filter_map(FoldEvent::message)
        .find(|message| message.request_id == Some(id))
        .expect("the confirmed prompt is reported");
    assert!(!reported.pending);
    assert_eq!(fold.pending().count(), 0);
    assert!(fold.fork.is_none());

    let mut expected = speculated;
    for message in &mut expected {
        message.pending = false;
    }
    assert_eq!(fold.messages(), expected.as_slice());
    assert_eq!(fold.metadata().turn, TurnState::Running);
}

#[test]
fn a_prompt_the_harness_composed_differently_still_promotes_by_id() {
    let mut fold = settled();
    let id = AgentActionId::mint();
    fold.push(speculation(AgentAction::prompt("hi"), id))
        .unwrap();

    fold.push(FoldInput::Confirmed(
        cursor(99),
        logged(&AgentAction::prompt("hi\n\n<context>doc</context>"), id),
    ))
    .unwrap();

    assert_eq!(fold.pending().count(), 0);
    let (text, pending) = user_texts(fold.messages()).pop().unwrap();
    assert_eq!(text, "hi\n\n<context>doc</context>");
    assert!(!pending);
}

#[test]
fn a_foreign_row_while_pending_rebases_the_suffix_after_it() {
    let mut fold = settled();
    let mine = AgentActionId::mint();
    fold.push(speculation(AgentAction::prompt("mine"), mine))
        .unwrap();

    let theirs = AgentActionId::mint();
    let events = fold
        .push(FoldInput::Confirmed(
            cursor(99),
            logged(&AgentAction::prompt("theirs"), theirs),
        ))
        .unwrap();

    assert!(is_replace(&events));
    let texts = user_texts(fold.messages());
    let tail = &texts[texts.len() - 2..];
    assert_eq!(
        tail,
        [("theirs".to_owned(), false), ("mine".to_owned(), true)],
        "the confirmed prompt sits before the still-pending one"
    );
    assert_eq!(fold.pending().collect::<Vec<_>>(), vec![mine]);
    // Turn ids are assigned in fold order, so the speculated prompt moved up.
    let mine_message = fold
        .messages()
        .iter()
        .find(|message| message.request_id == Some(mine))
        .unwrap();
    let theirs_message = fold
        .messages()
        .iter()
        .find(|message| message.request_id == Some(theirs))
        .unwrap();
    assert!(mine_message.id > theirs_message.id);
}

#[test]
fn a_retraction_removes_the_speculation_and_restores_the_committed_view() {
    let mut fold = settled();
    let committed: Vec<FoldedMessage> = fold.messages().to_vec();
    let id = AgentActionId::mint();
    fold.push(speculation(AgentAction::prompt("hi"), id))
        .unwrap();

    let events = fold.push(FoldInput::Retracted(id)).unwrap();

    assert!(is_replace(&events));
    assert_eq!(fold.messages(), committed.as_slice());
    assert_eq!(fold.metadata().turn, TurnState::Idle);
    assert!(fold.fork.is_none());

    // Retracting something never speculated changes nothing.
    assert!(
        fold.push(FoldInput::Retracted(AgentActionId::mint()))
            .unwrap()
            .is_empty()
    );
}

#[test]
fn a_snapshot_settles_what_it_already_contains() {
    let mut fold = settled();
    let id = AgentActionId::mint();
    let action = AgentAction::prompt("hi");
    fold.push(speculation(action.clone(), id)).unwrap();

    let mut log = parse_log(TURN);
    log.push(logged(&action, id));
    let events = fold.push(FoldInput::Snapshot(rows(log))).unwrap();

    assert!(is_replace(&events));
    assert_eq!(fold.pending().count(), 0);
    assert!(fold.fork.is_none());
    let (text, pending) = user_texts(fold.messages()).pop().unwrap();
    assert_eq!(text, "hi");
    assert!(!pending);
}

#[test]
fn a_speculated_stop_reads_as_stopping_and_promotes_by_method() {
    let mut fold = mid_turn();
    let id = AgentActionId::mint();

    let events = fold.push(speculation(AgentAction::Stop, id)).unwrap();

    let control = events
        .iter()
        .filter_map(FoldEvent::message)
        .find(|message| {
            matches!(
                message.parts.first(),
                Some(MessagePart::Control {
                    control: Control::Stop,
                    ..
                })
            )
        })
        .expect("the stop renders as a control line");
    assert!(control.pending);
    assert!(matches!(
        control.parts.first(),
        Some(MessagePart::Control {
            outcome: ControlOutcome::Accepted,
            ..
        })
    ));
    // The turn is not closed: only the runtime's own stop event does that.
    assert_eq!(fold.metadata().turn, TurnState::Stopping);
    assert!(fold.messages().last().unwrap().stop.is_none() || fold.messages().len() > 1);

    // A cancel is a notification with no request id, and its content is the
    // same bytes for every stop in the session, so the confirmed row matches
    // on its method and promotes the same way.
    let events = fold
        .push(FoldInput::Confirmed(
            cursor(99),
            logged(&AgentAction::Stop, AgentActionId::mint()),
        ))
        .unwrap();
    assert!(!is_replace(&events));
    assert_eq!(fold.pending().count(), 0);
    let control = fold
        .messages()
        .iter()
        .find(|message| {
            matches!(
                message.parts.first(),
                Some(MessagePart::Control {
                    control: Control::Stop,
                    ..
                })
            )
        })
        .unwrap();
    assert!(!control.pending);
    assert_eq!(fold.metadata().turn, TurnState::Stopping);
}

#[test]
fn a_speculated_frame_names_the_session_the_log_showed() {
    let mut fold = settled();
    assert_eq!(
        fold.committed.machine.acp_session_id(),
        Some(&SessionId::from(ACP_SESSION))
    );
    let id = AgentActionId::mint();
    fold.push(speculation(AgentAction::prompt("hi"), id))
        .unwrap();
    let frame = &fold.suffix[0].frame;
    let Message::ToRuntime(ToRuntimeMessage::Acp(acp)) = &frame.content else {
        panic!("a runtime-bound frame");
    };
    let RawJsonRpcMessage::Request(request) = &acp.0 else {
        panic!("a request");
    };
    let params = serde_json::to_value(request.params.as_ref()).unwrap();
    assert_eq!(params["sessionId"], ACP_SESSION);
    assert_eq!(request.id, id.to_request_id());
}

#[test]
fn a_session_with_no_runtime_yet_still_speculates() {
    let mut fold = SpeculativeFold::new(test_session());
    fold.push(FoldInput::Snapshot(rows(parse_log(
        r#"{"direction":"to_server","content":{"type":"event","event":"acp_ready"}}"#,
    ))))
    .unwrap();
    assert_eq!(fold.committed.machine.acp_session_id(), None);

    let id = AgentActionId::mint();
    fold.push(speculation(AgentAction::prompt("hi"), id))
        .unwrap();

    assert_eq!(user_texts(fold.messages()), vec![("hi".to_owned(), true)]);
    assert_eq!(fold.metadata().turn, TurnState::Starting);
}

/// The frontend's job, written out: a reader holding only what the events
/// told it must end up with exactly what `messages()` says.
#[test]
fn events_alone_reconstruct_the_view() {
    #[derive(Default)]
    struct Reader {
        messages: Vec<FoldedMessage>,
    }
    impl Reader {
        fn apply(&mut self, events: Vec<FoldEvent<'_>>) {
            for event in events {
                match event {
                    FoldEvent::NewMessage(message) | FoldEvent::MessageUpdate(message) => {
                        let message = message.into_owned();
                        match self
                            .messages
                            .iter_mut()
                            .find(|held| held.id() == message.id())
                        {
                            Some(held) => *held = message,
                            None => self.messages.push(message),
                        }
                    }
                    FoldEvent::MessagesReplaced(messages) => {
                        self.messages = messages.into_owned();
                    }
                    FoldEvent::MetadataUpdated(_) => {}
                }
            }
        }
    }

    let mut fold = SpeculativeFold::new(test_session());
    let mut reader = Reader::default();
    let open: String = TURN.lines().take(4).collect::<Vec<_>>().join("\n");
    reader.apply(
        fold.push(FoldInput::Snapshot(rows(parse_log(&open))))
            .unwrap(),
    );

    let stop = AgentActionId::mint();
    reader.apply(fold.push(speculation(AgentAction::Stop, stop)).unwrap());
    let next = AgentActionId::mint();
    reader.apply(
        fold.push(speculation(AgentAction::prompt("next"), next))
            .unwrap(),
    );
    assert_eq!(reader.messages, fold.messages());

    // The rest of the fixture confirms the running turn's answer and end,
    // each one a foreign row that rebases the suffix.
    for (index, row) in parse_log(TURN).into_iter().enumerate().skip(4) {
        reader.apply(fold.push(FoldInput::Confirmed(cursor(index), row)).unwrap());
        assert_eq!(reader.messages, fold.messages());
    }
    reader.apply(
        fold.push(FoldInput::Confirmed(
            cursor(50),
            logged(&AgentAction::Stop, AgentActionId::mint()),
        ))
        .unwrap(),
    );
    assert_eq!(reader.messages, fold.messages());
    reader.apply(
        fold.push(FoldInput::Confirmed(
            cursor(51),
            logged(&AgentAction::prompt("next"), next),
        ))
        .unwrap(),
    );
    assert_eq!(reader.messages, fold.messages());
    assert_eq!(fold.pending().count(), 0);
    assert!(fold.messages().iter().all(|message| !message.pending));
}

#[test]
fn speculating_an_action_the_log_already_confirmed_changes_nothing() {
    let mut fold = settled();
    let id = AgentActionId::mint();
    let action = AgentAction::prompt("hi");
    fold.push(FoldInput::Confirmed(cursor(99), logged(&action, id)))
        .unwrap();
    let confirmed: Vec<FoldedMessage> = fold.messages().to_vec();

    let events = fold.push(speculation(action, id)).unwrap();

    assert!(events.is_empty());
    assert_eq!(fold.pending().count(), 0);
    assert_eq!(fold.messages(), confirmed.as_slice());
}

/// The bug this pins: a prompt sent into a booting session showed, vanished
/// on the first live row, and came back once the runtime answered. The
/// runtime's `disconnected` event makes the replay gate stage every
/// runtime-bound frame until the next `initialize`, and a rebase re-folded
/// the speculated prompt through that gate.
#[test]
fn a_speculation_survives_the_replay_gate_across_a_disconnect() {
    let mut fold = settled();
    let id = AgentActionId::mint();
    fold.push(speculation(AgentAction::prompt("hi"), id))
        .unwrap();

    // The runtime drops while the prompt is still on the wire.
    let disconnected =
        parse_log(r#"{"direction":"to_server","content":{"type":"event","event":"disconnected"}}"#)
            .remove(0);
    let events = fold
        .push(FoldInput::Confirmed(cursor(99), disconnected))
        .unwrap();

    assert!(is_replace(&events), "a foreign row rebases the suffix");
    assert_eq!(
        user_texts(fold.messages()).pop(),
        Some(("hi".to_owned(), true)),
        "the pending prompt is still shown after the rebase"
    );
    assert_eq!(fold.metadata().turn, TurnState::Disconnected);

    // Speculating straight into a disconnected session shows just the same.
    let second = AgentActionId::mint();
    fold.push(speculation(AgentAction::prompt("again"), second))
        .unwrap();
    assert_eq!(
        user_texts(fold.messages()).pop(),
        Some(("again".to_owned(), true))
    );
}

/// Enter with a queued message: the client stops the turn and speculates the
/// queue head under the id the server already gave it, so the head reads as
/// sent while the runtime winds the old turn down.
#[test]
fn a_speculated_prompt_behind_a_stop_closes_the_stopped_turn_as_cancelled() {
    let mut fold = mid_turn();
    let stop_id = AgentActionId::mint();
    fold.push(speculation(AgentAction::Stop, stop_id)).unwrap();
    assert_eq!(fold.metadata().turn, TurnState::Stopping);

    let head_id = AgentActionId::mint();
    fold.push(speculation(AgentAction::prompt("next"), head_id))
        .unwrap();
    let stopped = |fold: &SpeculativeFold| {
        fold.messages()
            .iter()
            .find(|message| message.id == TurnId(0) && matches!(message.author, Author::Agent))
            .map(|message| (message.stop.clone(), message.pending))
            .expect("the stopped turn's agent message")
    };
    assert_eq!(
        stopped(&fold),
        (Some(StopReason::Cancelled), true),
        "the only way a stopped turn can end is predicted, and marked pending"
    );
    assert_eq!(
        user_texts(fold.messages()).pop(),
        Some(("next".to_owned(), true))
    );
    assert_eq!(fold.metadata().turn, TurnState::Starting);

    // The log then confirms in its own order: the cancel, the cancelled
    // response, and the head the server dispatched under the same id.
    fold.push(FoldInput::Confirmed(
        cursor(50),
        logged(&AgentAction::Stop, stop_id),
    ))
    .unwrap();
    assert_eq!(fold.metadata().turn, TurnState::Starting);
    let cancelled = parse_log(
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"prompt-1","result":{"stopReason":"cancelled"}}}"#,
    )
    .remove(0);
    fold.push(FoldInput::Confirmed(cursor(51), cancelled))
        .unwrap();
    assert_eq!(stopped(&fold), (Some(StopReason::Cancelled), false));
    assert_eq!(fold.metadata().turn, TurnState::Starting);
    fold.push(FoldInput::Confirmed(
        cursor(52),
        logged(&AgentAction::prompt("next"), head_id),
    ))
    .unwrap();
    assert_eq!(
        user_texts(fold.messages()).pop(),
        Some(("next".to_owned(), false))
    );
    assert_eq!(fold.metadata().turn, TurnState::Running);
    assert_eq!(fold.pending().count(), 0);
}

/// A confirmed prompt that follows an unanswered one still leaves the old
/// turn open-ended: only the speculative path predicts the runtime.
#[test]
fn a_confirmed_prompt_behind_a_stop_predicts_nothing() {
    let mut fold = mid_turn();
    let stop_id = AgentActionId::mint();
    fold.push(FoldInput::Confirmed(
        cursor(50),
        logged(&AgentAction::Stop, stop_id),
    ))
    .unwrap();
    fold.push(FoldInput::Confirmed(
        cursor(51),
        logged(&AgentAction::prompt("next"), AgentActionId::mint()),
    ))
    .unwrap();
    let first_agent = fold
        .messages()
        .iter()
        .find(|message| message.id == TurnId(0) && matches!(message.author, Author::Agent))
        .expect("agent message");
    assert_eq!(first_agent.stop, None);
}

#[test]
fn permission_answers_speculate_once_and_promote_on_the_agents_request_id() {
    use crate::domain::model::PermissionOutcome;
    use agent_client_protocol::schema::v1::RequestId;
    use agent_runtime_protocol::domain::action::PermissionAnswer;

    let mut log: Vec<&str> = TURN.lines().take(5).collect();
    log.push(r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":7,"method":"session/request_permission","params":{"sessionId":"s1","toolCall":{"toolCallId":"t1"},"options":[{"optionId":"once","name":"Allow once","kind":"allow_once"}]}}}"#);
    let mut fold = SpeculativeFold::new(test_session());
    fold.push(FoldInput::Snapshot(rows(parse_log(&log.join("\n")))))
        .unwrap();
    assert_eq!(fold.metadata().turn, TurnState::Blocked);
    assert_eq!(fold.metadata().pending_interactions.len(), 1);
    let answer = AgentAction::RespondToPermission(
        agent_runtime_protocol::domain::action::AgentPermissionAction {
            request_id: RequestId::Number(7),
            answer: PermissionAnswer::Selected {
                option_id: "once".into(),
            },
        },
    );
    let id = AgentActionId::mint();
    fold.push(speculation(answer.clone(), id)).unwrap();
    assert!(fold.metadata().pending_interactions.is_empty());
    assert_eq!(fold.metadata().turn, TurnState::Running);
    fold.push(FoldInput::Retracted(id)).unwrap();
    assert_eq!(fold.metadata().pending_interactions.len(), 1);
    assert_eq!(fold.metadata().turn, TurnState::Blocked);
    fold.push(speculation(answer.clone(), id)).unwrap();
    fold.push(speculation(answer.clone(), AgentActionId::mint()))
        .unwrap();
    assert_eq!(fold.pending().collect::<Vec<_>>(), vec![id]);
    assert!(fold.messages().iter().flat_map(|message| message.parts.iter()).any(|part|
        matches!(part, MessagePart::Permission { outcome: PermissionOutcome::Selected { option_id }, .. } if option_id == "once")
    ));
    fold.push(FoldInput::Confirmed(
        cursor(99),
        logged(&answer, AgentActionId::mint()),
    ))
    .unwrap();
    assert_eq!(fold.pending().count(), 0);

    // A later request can reuse an answered id. Its live identity takes
    // precedence over an older outcome when deduplicating speculation.
    fold.push(FoldInput::Confirmed(
        cursor(100),
        parse_log(log.last().unwrap()).remove(0),
    ))
    .unwrap();
    assert_eq!(fold.metadata().turn, TurnState::Blocked);
    fold.push(speculation(answer, AgentActionId::mint()))
        .unwrap();
    assert!(fold.metadata().pending_interactions.is_empty());
    assert_eq!(fold.metadata().turn, TurnState::Running);
}
