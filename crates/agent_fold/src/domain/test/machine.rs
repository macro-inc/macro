//! The incremental fold's contract with a streaming consumer.
//!
//! [`fold`] is a loop over [`FoldMachineImpl`], so the tests in
//! [`super::fold`] already cover what the machine derives. What is left to
//! pin is the part only a pushing caller sees: that the per-push reports are
//! enough, on their own, to arrive at the same answer.

use super::util::{TURN, parse_log};
use crate::domain::fold::{FoldMachineImpl, fold};
use crate::domain::log::AgentSessionLog;
use crate::domain::model::{
    Author, AuthorKind, FoldEvent, FoldedMessage, MessageId, MessagePart, StopReason, TurnId,
};
use crate::domain::ports::FoldMachine;

const EMPTY_PROMPT: &str = r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"p0","method":"session/prompt","params":{"sessionId":"s","prompt":[]}}}"#;

/// A consumer that knows nothing but what the machine told it: it holds a
/// message list, appends on [`FoldEvent::NewMessage`] and replaces by key on
/// [`FoldEvent::MessageUpdate`].
///
/// This is the frontend's job, written out - a channel applying a stream of
/// updates to what it is already rendering.
#[derive(Default)]
struct Consumer {
    messages: Vec<FoldedMessage>,
    /// Every report seen, in order, as `(is_new, key)`.
    reports: Vec<(bool, MessageId)>,
}

#[test]
fn an_empty_prompt_still_reserves_its_turn_id() {
    let mut machine = FoldMachineImpl::new();
    for entry in parse_log(EMPTY_PROMPT) {
        let _ = machine.push(entry);
    }

    assert!(machine.messages().is_empty());
    assert_eq!(machine.next_turn_id(), TurnId(1));
}

impl Consumer {
    fn apply(&mut self, event: FoldEvent<'_>) {
        let (is_new, message) = match event {
            FoldEvent::NewMessage(message) => (true, message.into_owned()),
            FoldEvent::MessageUpdate(message) => (false, message.into_owned()),
            FoldEvent::MetadataUpdated(_) => return,
        };
        let id = message.id();
        self.reports.push((is_new, id));

        if is_new {
            assert!(
                !self.messages.iter().any(|held| held.id() == id),
                "{id:?} was reported new twice"
            );
            self.messages.push(message);
        } else {
            let held = self
                .messages
                .iter_mut()
                .find(|held| held.id() == id)
                .unwrap_or_else(|| panic!("{id:?} was updated before it was reported new"));
            *held = message;
        }
    }

    /// Push a whole log through a fresh machine, one frame at a time.
    fn drive(log: impl IntoIterator<Item = AgentSessionLog>) -> Self {
        let mut machine = FoldMachineImpl::new();
        let mut consumer = Self::default();
        for entry in log {
            for event in machine.push(entry) {
                consumer.apply(event);
            }
        }
        consumer
    }
}

/// The property the whole design rests on: a consumer that sees only the
/// per-push reports ends up holding exactly what folding the log in one go
/// produces. If these ever diverge, a channel rendered from the stream and
/// the same channel rendered from a reload disagree - and the placeholder
/// rows keyed on [`MessageId`] are already persisted against one of them.
#[test]
fn applying_the_reports_reproduces_the_batch_fold() {
    let consumer = Consumer::drive(parse_log(TURN));

    assert_eq!(consumer.messages, fold(parse_log(TURN)));
}

/// A message is announced once and only once, before anything updates it -
/// which is what lets `agent_session` treat a `NewMessage` as "write a comms
/// placeholder" without checking for one first.
///
/// The ordering and no-duplicate assertions live in [`Consumer::apply`]; this
/// pins the keys themselves.
#[test]
fn each_message_is_reported_new_exactly_once() {
    let consumer = Consumer::drive(parse_log(TURN));

    let announced: Vec<MessageId> = consumer
        .reports
        .iter()
        .filter(|(is_new, _)| *is_new)
        .map(|(_, id)| *id)
        .collect();

    assert_eq!(
        announced,
        vec![
            MessageId {
                turn: TurnId(0),
                author: AuthorKind::User,
            },
            MessageId {
                turn: TurnId(0),
                author: AuthorKind::Agent,
            },
        ],
        "one turn announces its prompt, then its reply"
    );
}

/// The agent's message is announced while the turn is still running, not held
/// back until it stops - the reason for the rework. Its parts and its stop
/// reason arrive as later updates to the message already announced.
#[test]
fn the_agent_message_is_announced_before_its_turn_ends() {
    let log = parse_log(TURN);
    let frames = log.len();

    let mut machine = FoldMachineImpl::new();
    let mut announced_at = None;
    for (index, entry) in log.into_iter().enumerate() {
        for event in machine.push(entry) {
            if let FoldEvent::NewMessage(message) = event
                && message.author == Author::Agent
            {
                announced_at = Some((index, message.into_owned()));
            }
        }
    }

    let (index, announced) = announced_at.expect("the agent message was announced");
    assert!(
        index < frames - 1,
        "announced at frame {index} of {frames}, not at the end"
    );
    assert_eq!(
        announced.parts.len(),
        1,
        "announced with only the first part the agent produced"
    );
    assert_eq!(announced.stop, None, "the turn had not stopped yet");

    // Everything else reached it as updates.
    let final_message = &machine.messages()[1];
    assert_eq!(final_message.id(), announced.id(), "same message, grown");
    assert_eq!(final_message.parts.len(), 5);
    assert_eq!(final_message.stop, Some(StopReason::EndTurn));
}

/// Most of a log is bookkeeping. Frames that change nothing renderable report
/// nothing, so a caller can use a report as its signal to redraw.
#[test]
fn frames_that_change_nothing_report_nothing() {
    let quiet = parse_log(concat!(
        // A handshake request, before any turn exists.
        r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"i","method":"initialize","params":{}}}"#,
        "\n",
        // Token accounting, deliberately dropped by the fold.
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"usage_update","usage":{"inputTokens":1,"outputTokens":2}}}}}"#,
    ));

    let mut machine = FoldMachineImpl::new();
    for entry in quiet {
        assert!(
            machine.push(entry).is_empty(),
            "a frame with nothing renderable reported a change"
        );
    }
    assert_eq!(machine.messages(), [], "and derived no messages");
}

/// A prompt arriving while the previous turn is still open is the one frame
/// that touches two turns. It still reports a single change - the abandoned
/// turn's agent message is already announced and keeps the `stop: None` it
/// was announced with - which is what makes one report per push sound.
#[test]
fn an_interrupting_prompt_reports_only_its_own_message() {
    let prompt = |text: &str, id: &str| {
        format!(
            r#"{{"direction":"to_runtime","content":{{"type":"acp","jsonrpc":"2.0","id":"{id}","method":"session/prompt","params":{{"sessionId":"s","prompt":[{{"type":"text","text":"{text}"}}]}}}}}}"#
        )
    };
    let chunk = r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"half an answ"}}}}}"#;

    let log = parse_log(&format!(
        "{}\n{chunk}\n{}",
        prompt("first", "a"),
        prompt("second", "b")
    ));
    let consumer = Consumer::drive(log);

    assert_eq!(
        consumer.reports,
        vec![
            (
                true,
                MessageId {
                    turn: TurnId(0),
                    author: AuthorKind::User
                }
            ),
            (
                true,
                MessageId {
                    turn: TurnId(0),
                    author: AuthorKind::Agent
                }
            ),
            (
                true,
                MessageId {
                    turn: TurnId(1),
                    author: AuthorKind::User
                }
            ),
        ],
        "the interrupting prompt reports its own message and nothing else"
    );

    // The abandoned turn kept what it had, unstopped.
    let abandoned = &consumer.messages[1];
    assert_eq!(
        *abandoned.parts,
        vec![MessagePart::Text {
            text: "half an answ".to_owned()
        }]
    );
    assert_eq!(abandoned.stop, None, "no response ever closed it");
}

/// A machine driven to the end of a log holds what the batch fold returns, so
/// a caller keeping one per live session can answer a reload from memory
/// instead of refolding.
#[test]
fn the_machine_holds_the_whole_fold() {
    let mut machine = FoldMachineImpl::new();
    for entry in parse_log(TURN) {
        let _ = machine.push(entry);
    }

    assert_eq!(machine.messages(), fold(parse_log(TURN)));
    assert_eq!(machine.into_messages(), fold(parse_log(TURN)));
}

/// A resumed session: the agent talks with no prompt in this log, because the
/// prompt is in the log of the session it resumed through `session/load`.
///
/// The fold used to drop every such frame for want of an open turn, so a
/// recording of hundreds of frames of real work folded to nothing and its
/// channel rendered empty. It opens a turn instead - one with no user message,
/// since there is no prompt to attribute one to.
#[test]
fn content_without_a_prompt_still_folds() {
    let resumed = parse_log(concat!(
        // The load that picks the conversation up mid-flight.
        r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"l","method":"session/load","params":{"sessionId":"s"}}}"#,
        "\n",
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"picking up where we left off"}}}}}"#,
        "\n",
        // Closed by a response to the prompt that lives in the resumed
        // session's own log - not by the load response, which carries config
        // options rather than a stop reason.
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"p","result":{"stopReason":"end_turn"}}}"#,
    ));
    let consumer = Consumer::drive(resumed);

    let agent_side = MessageId {
        turn: TurnId(0),
        author: AuthorKind::Agent,
    };
    assert_eq!(
        consumer.reports,
        vec![(true, agent_side), (false, agent_side)],
        "the agent's side is announced and then closed; there is no prompt to \
         derive a user side from"
    );

    let agent = &consumer.messages[0];
    assert_eq!(
        *agent.parts,
        vec![MessagePart::Text {
            text: "picking up where we left off".to_owned()
        }]
    );
    assert_eq!(
        agent.stop,
        Some(StopReason::EndTurn),
        "a turn nothing prompted is closed by the first response that stops"
    );
}

/// A tool call is as good a reason to open a turn as prose is. Every route the
/// agent has to contribute content goes through the same place, so none of
/// them can be the one that still drops a resumed session's frames.
#[test]
fn a_tool_call_without_a_prompt_opens_a_turn() {
    let resumed = parse_log(
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"tool_call","toolCallId":"t1","title":"Bash","kind":"execute","status":"pending","rawInput":{"command":"ls"},"content":[],"locations":[]}}}}"#,
    );
    let consumer = Consumer::drive(resumed);

    assert_eq!(consumer.messages.len(), 1, "the call opened a turn");
    let agent = &consumer.messages[0];
    assert_eq!(agent.id, TurnId(0));
    assert!(
        matches!(&agent.parts[0], MessagePart::ToolUse { name, .. } if name.display() == "Bash"),
        "and the call is its first part: {:?}",
        agent.parts[0]
    );
}
