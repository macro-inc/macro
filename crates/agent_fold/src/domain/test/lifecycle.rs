//! What the lifecycle fold signals, and what it stays silent about.
use super::util::{TURN, parse_log};
use crate::domain::fold::{FoldMachineImpl, fold};
use crate::domain::lifecycle::LifecycleFold;
use crate::domain::log::AgentSessionLog;
use crate::domain::model::{FoldEvent, FoldedMessage, StopReason, TurnSignal};
use crate::domain::ports::FoldMachine as _;
use crate::testing::fixtures::{ELICITATION_CLAUDE_SINGLE_SELECT, RESUMED_NO_PROMPT};
use serde_json::{Value, json};

fn frame(direction: &str, body: Value) -> AgentSessionLog {
    let mut content = body;
    content["type"] = json!("acp");
    content["jsonrpc"] = json!("2.0");
    parse_log(&json!({"direction":direction,"content":content}).to_string())
        .pop()
        .unwrap()
}
fn request(method: &str, id: Value) -> AgentSessionLog {
    frame(
        "to_runtime",
        json!({"id":id,"method":method,"params":{"sessionId":"s","cwd":"/","mcpServers":[]}}),
    )
}
fn prompt(id: Value, text: &str) -> AgentSessionLog {
    frame(
        "to_runtime",
        json!({"id":id,"method":"session/prompt","params":{"sessionId":"s","prompt":[{"type":"text","text":text}]}}),
    )
}
fn result(id: Value) -> AgentSessionLog {
    frame("to_server", json!({"id":id,"result":{}}))
}
fn update(kind: &str, text: &str) -> AgentSessionLog {
    frame(
        "to_server",
        json!({"method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":kind,"content":{"type":"text","text":text}}}}),
    )
}

/// Push a whole log live and collect every signal, in order.
fn signals_of(log: &[AgentSessionLog]) -> (LifecycleFold, Vec<TurnSignal>) {
    let mut machine = LifecycleFold::new();
    let mut signals = Vec::new();
    for entry in log {
        signals.extend(machine.push(entry.clone()).signals);
    }
    (machine, signals)
}

fn apply(visible: &mut Vec<FoldedMessage>, event: FoldEvent<'_>) {
    match event {
        FoldEvent::MessagesReplaced(messages) => *visible = messages.into_owned(),
        FoldEvent::NewMessage(message) => visible.push(message.into_owned()),
        FoldEvent::MessageUpdate(message) => {
            let at = visible
                .iter()
                .position(|old| old.id() == message.id())
                .unwrap();
            visible[at] = message.into_owned();
        }
        FoldEvent::MetadataUpdated(_) => {}
    }
}

#[test]
fn passes_fold_events_through_unchanged() {
    let log = parse_log(TURN);
    let mut lifecycle = LifecycleFold::new();
    let mut bare = FoldMachineImpl::new();
    let mut visible = vec![];
    for entry in &log {
        let wrapped = lifecycle.push(entry.clone()).events;
        let plain: Vec<_> = bare
            .push(entry.clone())
            .into_iter()
            .map(FoldEvent::into_owned)
            .collect();
        assert_eq!(wrapped, plain);
        for event in wrapped {
            apply(&mut visible, event);
        }
        assert_eq!(visible, lifecycle.inner().messages());
    }
    assert_eq!(visible, fold(log.iter().cloned()));
}

#[test]
fn a_complete_turn_signals_one_end_with_its_stop_and_last_text() {
    let log = parse_log(TURN);
    let (machine, signals) = signals_of(&log);

    let reply = machine
        .inner()
        .messages()
        .iter()
        .rev()
        .find(|message| message.stop.is_some())
        .expect("the agent's reply closed the turn");
    assert!(
        matches!(
            signals.as_slice(),
            [TurnSignal::TurnEnded { turn, action_id, stop: StopReason::EndTurn, last_text: Some(text) }]
                if *turn == reply.id
                    // The hand-shaped fixture's prompt id is not a uuid this
                    // server minted, so no action id is attributed.
                    && action_id.is_none()
                    && !text.is_empty()
        ),
        "exactly one turn end, quoting the reply: {signals:#?}"
    );
}

#[test]
fn a_turn_our_prompt_opened_ends_naming_that_action() {
    let action = "01a08989-2892-7311-9c01-3dd1efda7880";
    let log = vec![
        request("initialize", json!(0)),
        result(json!(0)),
        request("session/new", json!(1)),
        frame("to_server", json!({"id":1,"result":{"sessionId":"s"}})),
        prompt(json!(action), "do it"),
        update("agent_message_chunk", "done"),
        frame(
            "to_server",
            json!({"id":action,"result":{"stopReason":"end_turn"}}),
        ),
    ];
    let (_, signals) = signals_of(&log);

    assert!(
        matches!(
            signals.as_slice(),
            [TurnSignal::TurnEnded { action_id: Some(id), stop: StopReason::EndTurn, last_text: Some(text), .. }]
                if id.as_uuid().to_string() == action && text == "done"
        ),
        "{signals:#?}"
    );
}

#[test]
fn a_question_is_raised_then_cleared_before_the_turn_ends() {
    let log = parse_log(ELICITATION_CLAUDE_SINGLE_SELECT);
    let (_, signals) = signals_of(&log);

    let kinds: Vec<&str> = signals
        .iter()
        .map(|signal| match signal {
            TurnSignal::ElicitationRaised { .. } => "raised",
            TurnSignal::ElicitationCleared { .. } => "cleared",
            TurnSignal::TurnEnded { .. } => "ended",
        })
        .collect();
    assert_eq!(kinds, ["raised", "cleared", "ended"], "{signals:#?}");
    assert!(matches!(
        &signals[0],
        TurnSignal::ElicitationRaised { question, .. } if !question.is_empty()
    ));
    let (raised_id, cleared_id) = match (&signals[0], &signals[1]) {
        (
            TurnSignal::ElicitationRaised {
                request_id: raised, ..
            },
            TurnSignal::ElicitationCleared {
                request_id: cleared,
                ..
            },
        ) => (raised, cleared),
        other => panic!("{other:?}"),
    };
    assert_eq!(raised_id, cleared_id);
}

/// Folding stored history is the caller's plain decision to push it and
/// ignore what it signals; the fold needs no notion of "history" for a live
/// turn afterwards to be signalled correctly.
#[test]
fn history_pushed_and_ignored_leaves_a_live_turn_signalling_normally() {
    let history = parse_log(TURN);
    let mut live = LifecycleFold::new();
    for entry in &history {
        // What the log writer does on catch-up: fold, discard the signals.
        let _ = live.push(entry.clone());
    }
    assert_eq!(live.inner().messages(), fold(history.iter().cloned()));

    let _ = live.push(prompt(json!(7), "once more"));
    let _ = live.push(update("agent_message_chunk", "again"));
    let pushed = live.push(frame(
        "to_server",
        json!({"id":7,"result":{"stopReason":"end_turn"}}),
    ));
    assert!(
        matches!(
            pushed.signals.as_slice(),
            [TurnSignal::TurnEnded { stop: StopReason::EndTurn, last_text: Some(text), .. }]
                if text == "again"
        ),
        "{:#?}",
        pushed.signals
    );
}

#[test]
fn a_load_replacement_signals_nothing_for_the_replaced_history() {
    let load = json!(1);
    let log = vec![
        request("initialize", json!(0)),
        result(json!(0)),
        request("session/load", load.clone()),
        update("user_message_chunk", "question"),
        update("agent_message_chunk", "answer"),
        result(load),
    ];
    let (machine, signals) = signals_of(&log);

    assert!(signals.is_empty(), "{signals:#?}");
    assert_eq!(machine.inner().messages().len(), 2);
}

/// A resumed session's log is history: its turns were replaced in, not
/// lived through, so nothing about them is signalled.
#[test]
fn a_resumed_sessions_history_signals_nothing() {
    let log = parse_log(RESUMED_NO_PROMPT);
    let (machine, signals) = signals_of(&log);

    assert!(signals.is_empty(), "{signals:#?}");
    assert!(
        machine
            .inner()
            .messages()
            .iter()
            .any(|message| message.stop.is_some())
    );
}

/// A turn nobody here prompted - streamed after a resume - ends on the
/// runtime's `_session/turn_complete`, which the session machine ignores but
/// the fold does not.
#[test]
fn an_unprompted_turn_ends_on_turn_complete_with_no_action_id() {
    let log = vec![
        request("initialize", json!(0)),
        result(json!(0)),
        request("session/new", json!(1)),
        frame("to_server", json!({"id":1,"result":{"sessionId":"s"}})),
        update("user_message_chunk", "carried over"),
        update("agent_message_chunk", "picking up where we left off"),
        frame(
            "to_server",
            json!({"method":"_session/turn_complete","params":{"sessionId":"s","outcome":{"kind":"finished"}}}),
        ),
    ];
    let (_, signals) = signals_of(&log);

    assert!(
        matches!(
            signals.as_slice(),
            [TurnSignal::TurnEnded { action_id: None, stop: StopReason::EndTurn, last_text: Some(text), .. }]
                if text == "picking up where we left off"
        ),
        "{signals:#?}"
    );
}
