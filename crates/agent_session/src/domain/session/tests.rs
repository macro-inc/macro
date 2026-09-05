//! Table-driven tests for the pure machine: inputs in, effects out. No
//! tokio, no mocks, no waiting - `Token` is a plain integer.

use agent_client_protocol::schema::v1::{
    AgentCapabilities, InitializeResponse, NewSessionResponse, PermissionOption,
    PermissionOptionKind, RequestId, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, Response, ResumeSessionResponse, SelectedPermissionOutcome,
    SessionCapabilities, SessionResumeCapabilities, ToolCallUpdate, ToolCallUpdateFields,
};
use agent_client_protocol::{JsonRpcMessage, RawJsonRpcMessage};
use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use agent_runtime_protocol::domain::schema::v0::{
    AcpMessage, SystemEvent, ToRuntimeMessage, ToServerMessage,
};
use macro_user_id::user_id::MacroUserIdStr;

use crate::PROTOCOL_VERSION;
use crate::domain::error::AgentSessionError;
use crate::domain::model::AgentSessionId;

use super::{
    CloseReason, Effect, Input, RuntimeStatus, SessionMachine, SessionRestoreSupport, StopReason,
};

fn machine() -> SessionMachine<u32> {
    SessionMachine::new(AgentSessionId::TEST_A, "/workspace".to_owned(), Vec::new())
}

fn command(text: &str, token: u32) -> Input<u32> {
    command_with_id(text, AgentActionId::mint(), token)
}

fn command_with_id(text: &str, action_id: AgentActionId, token: u32) -> Input<u32> {
    Input::Command {
        from: Some(MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id")),
        action: AgentAction::prompt(text),
        action_id,
        token,
    }
}

fn set_model_with_id(model: &str, action_id: AgentActionId, token: u32) -> Input<u32> {
    Input::Command {
        from: None,
        action: AgentAction::set_model(model),
        action_id,
        token,
    }
}

fn acp_ready() -> Input<u32> {
    Input::Inbound(ToServerMessage::Event {
        event: SystemEvent::AcpReady,
    })
}

fn frame(frame: RawJsonRpcMessage) -> Input<u32> {
    Input::Inbound(ToServerMessage::Acp(AcpMessage(frame)))
}

fn initialized() -> Input<u32> {
    initialized_with(InitializeResponse::new(PROTOCOL_VERSION))
}

fn initialized_with(response: InitializeResponse) -> Input<u32> {
    frame(RawJsonRpcMessage::response(
        request_id(0),
        Ok(serde_json::to_value(response).expect("a serializable response")),
    ))
}

fn initialization_refused() -> Input<u32> {
    frame(RawJsonRpcMessage::response(
        request_id(0),
        Err(agent_client_protocol::Error::internal_error()),
    ))
}

fn begin_opening(machine: &mut SessionMachine<u32>) {
    machine.handle(acp_ready());
    machine.handle(initialized());
}

/// The answer to `session/new`, sent after initialization completes.
fn session_opened(session_id: &'static str) -> Input<u32> {
    frame(RawJsonRpcMessage::response(
        request_id(1),
        Ok(serde_json::to_value(NewSessionResponse::new(session_id))
            .expect("a serializable response")),
    ))
}

fn session_refused() -> Input<u32> {
    frame(RawJsonRpcMessage::response(
        request_id(1),
        Err(agent_client_protocol::Error::internal_error()),
    ))
}

/// The request ids of every `Send` effect, in order.
fn sent_request_ids(effects: &[Effect<u32>]) -> Vec<RequestId> {
    effects
        .iter()
        .filter_map(|effect| match effect {
            Effect::Send {
                message: ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request))),
                ..
            } => Some(request.id.clone()),
            _ => None,
        })
        .collect()
}

fn sent_methods(effects: &[Effect<u32>]) -> Vec<String> {
    effects
        .iter()
        .filter_map(|effect| match effect {
            Effect::Send {
                message: ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request))),
                ..
            } => Some(request.method.to_string()),
            Effect::Send {
                message:
                    ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Notification(
                        notification,
                    ))),
                ..
            } => Some(notification.method.to_string()),
            _ => None,
        })
        .collect()
}

/// The machine's own request ids carry the session, so sessions sharing one
/// connection cannot collide.
fn request_id(n: u64) -> RequestId {
    RequestId::Str(format!("agent_session:{}:{n}", AgentSessionId::TEST_A))
}

#[test]
fn a_command_while_booting_queues_silently() {
    let mut machine = machine();

    let effects = machine.handle(command("fix the test", 1));

    assert!(effects.is_empty());
    assert_eq!(machine.pending_count(), 1);
    assert_eq!(machine.status(), RuntimeStatus::Booting);
}

#[test]
fn acp_ready_logs_then_sends_initialize() {
    let mut machine = machine();

    let effects = machine.handle(acp_ready());

    assert!(matches!(effects[0], Effect::Log { .. }));
    assert_eq!(sent_request_ids(&effects), [request_id(0)]);
    assert_eq!(effects.len(), 2);
    assert_eq!(machine.status(), RuntimeStatus::Handshaking);
}

#[test]
fn initialize_success_sends_session_new() {
    let mut machine = machine();
    machine.handle(acp_ready());

    let effects = machine.handle(initialized());

    assert!(matches!(effects[0], Effect::Log { .. }));
    assert_eq!(sent_request_ids(&effects), [request_id(1)]);
    assert_eq!(machine.status(), RuntimeStatus::Handshaking);
}

#[test]
fn refused_initialize_fails_the_queue_and_stops() {
    let mut machine = machine();
    machine.handle(command("doomed", 1));
    machine.handle(acp_ready());

    let effects = machine.handle(initialization_refused());

    assert!(matches!(
        effects[..],
        [
            Effect::Log { .. },
            Effect::Complete {
                token: 1,
                result: Err(AgentSessionError::Disconnected(_))
            },
            Effect::Stop {
                reason: StopReason::InitializationRefused
            },
        ]
    ));
    assert_eq!(machine.status(), RuntimeStatus::Dead);
}

#[test]
fn a_second_acp_ready_only_logs() {
    let mut machine = machine();
    machine.handle(acp_ready());

    let effects = machine.handle(acp_ready());

    assert!(matches!(effects[..], [Effect::Log { .. }]));
    assert_eq!(machine.status(), RuntimeStatus::Handshaking);
}

#[test]
fn session_new_success_flushes_the_queue() {
    let mut machine = machine();
    // One prompt and one model change: at most one turn-occupying action is
    // ever pending, because the harness dispatches its queue one turn at a
    // time - the machine asserts that contract rather than managing it.
    machine.handle(command("first", 1));
    machine.handle(set_model_with_id("opus", AgentActionId::mint(), 2));
    begin_opening(&mut machine);

    let effects = machine.handle(session_opened("acp-42"));

    assert!(matches!(
        effects[..],
        [
            Effect::Log { .. },
            Effect::PersistAcpSession { .. },
            Effect::Send { .. },
            Effect::Complete {
                token: 1,
                result: Ok(())
            },
            Effect::Send { .. },
            Effect::Complete {
                token: 2,
                result: Ok(())
            },
        ]
    ));
    assert!(matches!(machine.status(), RuntimeStatus::Live { .. }));
    assert_eq!(machine.pending_count(), 0);
    assert_eq!(
        machine.status().session_id().map(ToString::to_string),
        Some("acp-42".to_owned())
    );
}

#[test]
fn reconnect_uses_session_resume_when_the_agent_supports_it() {
    let mut machine = SessionMachine::resume(
        AgentSessionId::TEST_A,
        "acp-42".into(),
        "/workspace".to_owned(),
        Vec::new(),
    );
    machine.handle(command("continue", 1));
    machine.handle(acp_ready());
    let initialized = InitializeResponse::new(PROTOCOL_VERSION).agent_capabilities(
        AgentCapabilities::new().session_capabilities(
            SessionCapabilities::new().resume(SessionResumeCapabilities::new()),
        ),
    );

    let opening = machine.handle(initialized_with(initialized));

    assert_eq!(sent_methods(&opening), ["session/resume"]);
    let resumed = machine.handle(frame(RawJsonRpcMessage::response(
        request_id(1),
        Ok(serde_json::to_value(ResumeSessionResponse::new()).unwrap()),
    )));
    assert!(matches!(
        resumed[..],
        [
            Effect::Log { .. },
            Effect::Send { .. },
            Effect::Complete {
                token: 1,
                result: Ok(())
            }
        ]
    ));
    assert_eq!(machine.status().session_id().unwrap().to_string(), "acp-42");
}

#[test]
fn reconnect_falls_back_to_session_load() {
    let mut machine = SessionMachine::resume(
        AgentSessionId::TEST_A,
        "acp-42".into(),
        "/workspace".to_owned(),
        Vec::new(),
    );
    machine.handle(acp_ready());
    let initialized = InitializeResponse::new(PROTOCOL_VERSION)
        .agent_capabilities(AgentCapabilities::new().load_session(true));

    let opening = machine.handle(initialized_with(initialized));

    assert_eq!(sent_methods(&opening), ["session/load"]);
}

#[test]
fn reconnect_stops_when_the_agent_cannot_restore_sessions() {
    let mut machine = SessionMachine::resume(
        AgentSessionId::TEST_A,
        "acp-42".into(),
        "/workspace".to_owned(),
        Vec::new(),
    );
    machine.handle(command("cannot continue", 1));
    machine.handle(acp_ready());

    let effects = machine.handle(initialized());

    // The handshake itself succeeded, so its result is still announced: this
    // session cannot restore itself, but the connection is initialized and a
    // new session on it would not have to handshake again.
    assert!(matches!(
        effects[..],
        [
            Effect::Log { .. },
            Effect::Initialized { .. },
            Effect::Complete {
                token: 1,
                result: Err(AgentSessionError::ResumeUnsupported(_))
            },
            Effect::Stop {
                reason: StopReason::ResumeUnsupported
            }
        ]
    ));
}

#[test]
fn a_live_command_sends_then_completes() {
    let mut machine = machine();
    begin_opening(&mut machine);
    machine.handle(session_opened("acp-42"));

    let effects = machine.handle(command("now", 7));

    assert!(matches!(
        effects[..],
        [
            Effect::Send { .. },
            Effect::Complete {
                token: 7,
                result: Ok(())
            }
        ]
    ));
}

#[test]
fn queued_actions_carry_their_sender_onto_the_wire() {
    let mut machine = machine();
    machine.handle(command("first", 1));
    begin_opening(&mut machine);

    let effects = machine.handle(session_opened("acp-42"));

    let senders: Vec<_> = effects
        .iter()
        .filter_map(|effect| match effect {
            Effect::Send { from, .. } => from.clone(),
            _ => None,
        })
        .collect();
    assert_eq!(senders.len(), 1);
    assert_eq!(senders[0].to_string(), "macro|owner@example.com");
}

#[test]
fn a_refused_session_new_fails_the_queue_and_stops() {
    let mut machine = machine();
    machine.handle(command("doomed", 1));
    begin_opening(&mut machine);

    let effects = machine.handle(session_refused());

    assert!(matches!(
        effects[..],
        [
            Effect::Log { .. },
            Effect::Complete {
                token: 1,
                result: Err(AgentSessionError::Disconnected(_))
            },
            Effect::Stop {
                reason: StopReason::SessionRefused
            },
        ]
    ));
    assert_eq!(machine.status(), RuntimeStatus::Dead);
}

#[test]
fn an_unintelligible_session_new_answer_stops() {
    let mut machine = machine();
    begin_opening(&mut machine);

    let effects = machine.handle(frame(RawJsonRpcMessage::response(
        request_id(1),
        Ok(serde_json::json!({ "not": "a session" })),
    )));

    assert!(matches!(
        effects[..],
        [Effect::Log { .. }, Effect::Stop { .. }]
    ));
    assert_eq!(machine.status(), RuntimeStatus::Dead);
}

#[test]
fn a_foreign_frame_while_handshaking_only_logs() {
    let mut machine = machine();
    machine.handle(acp_ready());

    let effects = machine.handle(frame(RawJsonRpcMessage::response(
        RequestId::Str("someone-else:9".to_owned()),
        Ok(serde_json::json!({})),
    )));

    assert!(matches!(effects[..], [Effect::Log { .. }]));
    assert_eq!(machine.status(), RuntimeStatus::Handshaking);
}

#[test]
fn a_live_frame_only_logs() {
    let mut machine = machine();
    begin_opening(&mut machine);
    machine.handle(session_opened("acp-42"));

    let effects = machine.handle(frame(RawJsonRpcMessage::response(
        request_id(2),
        Ok(serde_json::json!({})),
    )));

    assert!(matches!(effects[..], [Effect::Log { .. }]));
    assert!(matches!(machine.status(), RuntimeStatus::Live { .. }));
}

#[test]
fn a_permission_request_prefers_allow_always_so_the_agent_does_not_block() {
    let outcome = permission_response(vec![
        PermissionOption::new("once", "Allow once", PermissionOptionKind::AllowOnce),
        PermissionOption::new("always", "Always allow", PermissionOptionKind::AllowAlways),
        PermissionOption::new("reject", "Reject", PermissionOptionKind::RejectOnce),
    ]);

    assert_eq!(
        outcome,
        RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new("always"))
    );
}

#[test]
fn a_permission_request_falls_back_to_allow_once() {
    let outcome = permission_response(vec![
        PermissionOption::new("once", "Allow once", PermissionOptionKind::AllowOnce),
        PermissionOption::new("reject", "Reject", PermissionOptionKind::RejectOnce),
    ]);

    assert_eq!(
        outcome,
        RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new("once"))
    );
}

#[test]
fn a_permission_request_without_an_allow_option_is_cancelled() {
    let outcome = permission_response(Vec::new());

    assert_eq!(outcome, RequestPermissionOutcome::Cancelled);
}

fn permission_response(options: Vec<PermissionOption>) -> RequestPermissionOutcome {
    let mut machine = machine();
    begin_opening(&mut machine);
    machine.handle(session_opened("acp-42"));
    let permission_id = RequestId::Str("agent:permission:0".to_owned());
    let (method, params) = RequestPermissionRequest::new(
        "acp-42",
        ToolCallUpdate::new("call-1", ToolCallUpdateFields::new()),
        options,
    )
    .to_untyped_message()
    .unwrap()
    .into_parts();

    let effects = machine.handle(frame(
        RawJsonRpcMessage::request(method, params, permission_id.clone()).unwrap(),
    ));

    assert!(matches!(effects.first(), Some(Effect::Log { .. })));
    let Effect::Send {
        message:
            ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Response(Response::Result {
                id,
                result,
            }))),
        ..
    } = &effects[1]
    else {
        panic!("expected a successful ACP permission response");
    };
    assert_eq!(id, &permission_id);
    serde_json::from_value::<RequestPermissionResponse>(result.clone())
        .unwrap()
        .outcome
}

#[test]
fn closing_fails_the_queue_and_stops() {
    let mut machine = machine();
    machine.handle(command("stranded", 1));
    machine.handle(command("also stranded", 2));

    let effects = machine.handle(Input::Closed(CloseReason::TransportClosed));

    assert!(matches!(
        effects[..],
        [
            Effect::Complete {
                token: 1,
                result: Err(AgentSessionError::Disconnected(_))
            },
            Effect::Complete {
                token: 2,
                result: Err(AgentSessionError::Disconnected(_))
            },
            Effect::Stop {
                reason: StopReason::Closed(CloseReason::TransportClosed)
            },
        ]
    ));
    assert_eq!(machine.status(), RuntimeStatus::Dead);
}

#[test]
fn closing_twice_is_idempotent() {
    let mut machine = machine();
    machine.handle(Input::Closed(CloseReason::TransportClosed));

    assert!(
        machine
            .handle(Input::Closed(CloseReason::Abandoned))
            .is_empty()
    );
}

#[test]
fn a_command_after_death_completes_disconnected() {
    let mut machine = machine();
    machine.handle(Input::Closed(CloseReason::TransportClosed));

    let effects = machine.handle(command("too late", 1));

    assert!(matches!(
        effects[..],
        [Effect::Complete {
            token: 1,
            result: Err(AgentSessionError::Disconnected(_))
        }]
    ));
}

#[test]
fn every_inbound_is_logged_first() {
    let mut machine = machine();

    for input in [
        acp_ready(),
        initialized(),
        session_opened("acp-42"),
        frame(RawJsonRpcMessage::response(
            RequestId::Str("unrelated:0".to_owned()),
            Ok(serde_json::json!({})),
        )),
    ] {
        let effects = machine.handle(input);
        assert!(
            matches!(effects.first(), Some(Effect::Log { .. })),
            "an inbound message must be logged before anything reacts to it"
        );
    }
}

#[test]
fn actions_go_out_under_the_ids_they_were_accepted_with() {
    let queued_id = AgentActionId::mint();
    let live_id = AgentActionId::mint();

    let mut machine = machine();
    machine.handle(command_with_id("queued", queued_id, 1));
    let initialize = machine.handle(acp_ready());
    let open = machine.handle(initialized());
    let flushed = machine.handle(session_opened("acp-42"));
    // A model change, because the queued prompt's turn is still in flight and
    // only non-turn actions may go out beside it.
    let live = machine.handle(set_model_with_id("opus", live_id, 2));

    let mut ids = Vec::new();
    for effects in [&initialize, &open, &flushed, &live] {
        ids.extend(sent_request_ids(effects));
    }

    // Handshake requests keep the machine's own counter; each action carries
    // the id it was accepted with, even one that waited in the queue.
    assert_eq!(
        ids,
        [
            request_id(0),
            request_id(1),
            queued_id.to_request_id(),
            live_id.to_request_id()
        ]
    );
}

fn stop(token: u32) -> Input<u32> {
    Input::Command {
        from: Some(MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id")),
        action: AgentAction::Stop,
        action_id: AgentActionId::mint(),
        token,
    }
}

#[test]
fn a_stop_while_booting_leaves_the_queued_prompt_to_run() {
    let mut machine = machine();

    // Queued, because nothing can be sent before the handshake finishes.
    assert!(machine.handle(command("start the work", 1)).is_empty());
    assert_eq!(machine.pending_count(), 1);

    // A stop cancels only the turn that is running - here, none. The queued
    // prompt stays: it will open the next turn, which its caller can stop in
    // turn if they meant that too.
    let effects = machine.handle(stop(2));
    assert!(effects.is_empty(), "nothing completes early: {effects:?}");
    assert_eq!(machine.pending_count(), 2);

    begin_opening(&mut machine);
    let effects = machine.handle(session_opened("acp-1"));

    assert_eq!(
        sent_methods(&effects),
        ["session/prompt", "session/cancel"],
        "the prompt still runs, in the order the actions were accepted"
    );
}

/// The response answering the in-flight prompt's request id, however the
/// turn ended.
fn turn_answered(request_id: RequestId) -> Input<u32> {
    frame(RawJsonRpcMessage::response(
        request_id,
        Ok(serde_json::json!({ "stopReason": "end_turn" })),
    ))
}

/// A live machine with `action_id`'s prompt in flight.
fn machine_with_turn_in_flight(action_id: AgentActionId) -> SessionMachine<u32> {
    let mut machine = machine();
    machine.handle(command_with_id("work", action_id, 1));
    begin_opening(&mut machine);
    machine.handle(session_opened("acp-42"));
    machine
}

#[test]
fn the_prompts_response_ends_its_turn() {
    let action_id = AgentActionId::mint();
    let mut machine = machine_with_turn_in_flight(action_id);

    let effects = machine.handle(turn_answered(action_id.to_request_id()));

    assert!(
        matches!(
            effects[..],
            [Effect::Log { .. }, Effect::TurnEnded { action_id: ended }] if ended == action_id
        ),
        "the answer is logged and the turn ends: {effects:?}"
    );
}

#[test]
fn a_refused_prompt_ends_its_turn_too() {
    let action_id = AgentActionId::mint();
    let mut machine = machine_with_turn_in_flight(action_id);

    let effects = machine.handle(frame(RawJsonRpcMessage::response(
        action_id.to_request_id(),
        Err(agent_client_protocol::Error::internal_error()),
    )));

    assert!(
        matches!(
            effects[..],
            [Effect::Log { .. }, Effect::TurnEnded { action_id: ended }] if ended == action_id
        ),
        "a refusal ends the turn the same way: {effects:?}"
    );
}

#[test]
fn another_requests_response_does_not_end_the_turn() {
    let action_id = AgentActionId::mint();
    let mut machine = machine_with_turn_in_flight(action_id);

    // A model change answered while the prompt's turn is still running.
    let effects = machine.handle(frame(RawJsonRpcMessage::response(
        AgentActionId::mint().to_request_id(),
        Ok(serde_json::json!({})),
    )));
    assert!(
        matches!(effects[..], [Effect::Log { .. }]),
        "only logged: {effects:?}"
    );

    // The turn is still in flight: its own answer still ends it.
    let effects = machine.handle(turn_answered(action_id.to_request_id()));
    assert!(matches!(effects[..], [
        Effect::Log { .. },
        Effect::TurnEnded { action_id: ended }
    ] if ended == action_id));
}

#[test]
fn a_death_mid_turn_is_not_a_turn_end() {
    let action_id = AgentActionId::mint();
    let mut machine = machine_with_turn_in_flight(action_id);

    let effects = machine.handle(Input::Closed(CloseReason::TransportClosed));

    assert!(
        !effects
            .iter()
            .any(|effect| matches!(effect, Effect::TurnEnded { .. })),
        "the session stopped; the turn did not end: {effects:?}"
    );
    assert!(matches!(effects[..], [Effect::Stop { .. }]));
    assert_eq!(machine.status(), RuntimeStatus::Dead);
}

#[test]
fn a_model_change_does_not_disturb_the_queue() {
    let mut machine = machine();

    assert!(machine.handle(command("start the work", 1)).is_empty());
    let effects = machine.handle(Input::Command {
        from: None,
        action: AgentAction::set_model("opus"),
        action_id: AgentActionId::mint(),
        token: 2,
    });

    assert!(
        effects.is_empty(),
        "nothing completes early, got {effects:?}"
    );
    assert_eq!(
        machine.pending_count(),
        2,
        "both are still queued, in order"
    );
}

/// The `cwd` of every sent request with the given method.
fn sent_cwds(effects: &[Effect<u32>], method: &str) -> Vec<String> {
    effects
        .iter()
        .filter_map(|effect| match effect {
            Effect::Send {
                message: ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request))),
                ..
            } if request.method.as_ref() == method => {
                let params = request
                    .params
                    .clone()
                    .expect("the request has params")
                    .into_value();
                Some(params["cwd"].as_str().expect("cwd is a string").to_owned())
            }
            _ => None,
        })
        .collect()
}

#[test]
fn session_new_carries_the_sessions_workspace() {
    let mut machine = SessionMachine::new(
        AgentSessionId::TEST_A,
        "/home/operator/code".to_owned(),
        Vec::new(),
    );
    machine.handle(acp_ready());
    let effects = machine.handle(initialized());

    // The session/new request works in the row's directory, not a constant.
    assert_eq!(sent_cwds(&effects, "session/new"), ["/home/operator/code"]);
}

#[test]
fn resume_carries_the_sessions_workspace() {
    let mut machine = SessionMachine::resume(
        AgentSessionId::TEST_A,
        "acp-42".into(),
        "/home/operator/code".to_owned(),
        Vec::new(),
    );
    machine.handle(acp_ready());
    let effects = machine.handle(initialized_with(
        InitializeResponse::new(PROTOCOL_VERSION).agent_capabilities(
            AgentCapabilities::new().session_capabilities(
                SessionCapabilities::new().resume(SessionResumeCapabilities::new()),
            ),
        ),
    ));

    assert_eq!(
        sent_cwds(&effects, "session/resume"),
        ["/home/operator/code"]
    );
}

#[test]
fn a_session_on_an_initialized_connection_opens_without_handshaking() {
    let mut machine = machine();
    machine.handle(command("fix the flaky test", 1));

    // No `AcpReady`, no `initialize`: another session on this connection
    // already ran the handshake and this one is told the result.
    let opening = machine.handle(Input::Ready {
        restore: SessionRestoreSupport {
            resume: false,
            load: false,
        },
    });

    assert_eq!(sent_methods(&opening), ["session/new"]);
    assert_eq!(
        machine.pending_count(),
        1,
        "the prompt still waits to flush"
    );
}

#[test]
fn a_ready_connection_still_picks_resume_for_a_session_that_has_one() {
    let mut machine = SessionMachine::resume(
        AgentSessionId::TEST_A,
        "acp-42".into(),
        "/workspace".to_owned(),
        Vec::new(),
    );

    let opening = machine.handle(Input::Ready {
        restore: SessionRestoreSupport {
            resume: true,
            load: false,
        },
    });

    assert_eq!(sent_methods(&opening), ["session/resume"]);
}

#[test]
fn a_ready_connection_that_cannot_restore_stops_the_session() {
    let mut machine: SessionMachine<u32> = SessionMachine::resume(
        AgentSessionId::TEST_A,
        "acp-42".into(),
        "/workspace".to_owned(),
        Vec::new(),
    );

    let effects = machine.handle(Input::Ready {
        restore: SessionRestoreSupport {
            resume: false,
            load: false,
        },
    });

    assert!(matches!(
        effects[..],
        [Effect::Stop {
            reason: StopReason::ResumeUnsupported
        }]
    ));
}

#[test]
fn the_session_that_ran_the_handshake_ignores_being_told_it_is_ready() {
    let mut machine = machine();
    machine.handle(acp_ready());
    let opened = machine.handle(initialized());
    assert_eq!(sent_methods(&opened), ["session/new"]);

    // The gate is shared, so the machine that published `Ready` reads it back.
    // Opening twice would leave the agent with a session nobody tracks.
    let echo = machine.handle(Input::Ready {
        restore: SessionRestoreSupport {
            resume: true,
            load: true,
        },
    });

    assert!(echo.is_empty());
}

#[test]
fn the_handshake_result_is_announced_for_the_connection() {
    let mut machine = machine();
    machine.handle(acp_ready());
    let initialized = InitializeResponse::new(PROTOCOL_VERSION)
        .agent_capabilities(AgentCapabilities::new().load_session(true));

    let effects = machine.handle(initialized_with(initialized));

    let announced = effects.iter().find_map(|effect| match effect {
        Effect::Initialized { restore } => Some(*restore),
        _ => None,
    });
    assert_eq!(
        announced,
        Some(SessionRestoreSupport {
            resume: false,
            load: true
        })
    );
}

// ---------------------------------------------------------------------------
// Elicitation: held for the user, never answered by the machine itself.
// ---------------------------------------------------------------------------

mod elicitation {
    use super::*;
    use agent_client_protocol::schema::v1::{
        ClientRequest, CreateElicitationRequest, CreateElicitationResponse, ElicitationAction,
        ElicitationFormMode, ElicitationRequestScope, ElicitationSchema, ElicitationSessionScope,
        ElicitationUrlMode, InitializeRequest, SessionId,
    };
    use agent_runtime_protocol::domain::action::{ElicitationAnswer, ElicitationRequestId};
    use std::collections::BTreeMap;

    fn live_machine() -> SessionMachine<u32> {
        let mut machine = machine();
        begin_opening(&mut machine);
        machine.handle(session_opened("acp-42"));
        machine
    }

    fn create(id: RequestId, request: CreateElicitationRequest) -> Input<u32> {
        let (method, params) = request.to_untyped_message().unwrap().into_parts();
        frame(RawJsonRpcMessage::request(method, params, id).unwrap())
    }

    fn form_for(session: &'static str) -> CreateElicitationRequest {
        CreateElicitationRequest::new(
            ElicitationFormMode::new(
                ElicitationSessionScope::new(SessionId::new(session)),
                ElicitationSchema::new(),
            ),
            "Which approach?",
        )
    }

    fn answer(id: ElicitationRequestId, answer: ElicitationAnswer, token: u32) -> Input<u32> {
        Input::Command {
            from: Some(
                MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id"),
            ),
            action: AgentAction::respond_elicitation(id, answer),
            action_id: AgentActionId::mint(),
            token,
        }
    }

    /// Every JSON-RPC response the machine sent, as `(id, result)`.
    fn sent_responses(
        effects: &[Effect<u32>],
    ) -> Vec<(
        RequestId,
        Result<serde_json::Value, agent_client_protocol::Error>,
    )> {
        effects
            .iter()
            .filter_map(|effect| match effect {
                Effect::Send {
                    message:
                        ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Response(
                            Response::Result { id, result },
                        ))),
                    ..
                } => Some((id.clone(), Ok(result.clone()))),
                Effect::Send {
                    message:
                        ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Response(
                            Response::Error { id, error },
                        ))),
                    ..
                } => Some((id.clone(), Err(error.clone()))),
                _ => None,
            })
            .collect()
    }

    fn refusals(effects: &[Effect<u32>]) -> Vec<RequestId> {
        sent_responses(effects)
            .into_iter()
            .filter_map(|(id, result)| match result {
                Err(error) if error.code == agent_client_protocol::ErrorCode::InvalidParams => {
                    Some(id)
                }
                _ => None,
            })
            .collect()
    }

    #[test]
    fn initialize_advertises_both_elicitation_modes() {
        let mut machine = machine();
        let effects = machine.handle(acp_ready());
        let Effect::Send {
            message: ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request))),
            ..
        } = &effects[1]
        else {
            panic!("initialize is sent");
        };
        let ClientRequest::InitializeRequest(initialize) =
            ClientRequest::parse_message(&request.method, &request.params).unwrap()
        else {
            panic!("the first request is initialize");
        };
        let _: &InitializeRequest = &initialize;
        let elicitation = initialize
            .client_capabilities
            .elicitation
            .expect("elicitation is advertised");
        assert!(elicitation.form.is_some(), "form mode is advertised");
        assert!(elicitation.url.is_some(), "url mode is advertised");

        // And on the wire, exactly the shape the protocol documents.
        let params = serde_json::to_value(&request.params).unwrap();
        assert_eq!(
            params["clientCapabilities"]["elicitation"],
            serde_json::json!({ "form": {}, "url": {} })
        );
    }

    #[test]
    fn a_form_elicitation_is_held_not_answered() {
        let mut machine = live_machine();

        let effects = machine.handle(create(RequestId::Number(0), form_for("acp-42")));

        assert!(
            matches!(effects[..], [Effect::Log { .. }]),
            "held: {effects:?}"
        );
        assert_eq!(machine.pending_elicitation(), Some(&RequestId::Number(0)));
        assert!(matches!(machine.status(), RuntimeStatus::Live { .. }));
    }

    #[test]
    fn a_url_elicitation_is_held_too() {
        let mut machine = live_machine();
        let request = CreateElicitationRequest::new(
            ElicitationUrlMode::new(
                ElicitationSessionScope::new(SessionId::new("acp-42")),
                "github-oauth-1",
                "https://agent.example.com/connect?elicitationId=github-oauth-1",
            ),
            "Authorize GitHub",
        );

        let effects = machine.handle(create(RequestId::Str("el-1".to_owned()), request));

        assert!(matches!(effects[..], [Effect::Log { .. }]));
        assert_eq!(
            machine.pending_elicitation(),
            Some(&RequestId::Str("el-1".to_owned()))
        );
    }

    #[test]
    fn a_second_elicitation_while_one_is_held_is_refused_and_the_first_kept() {
        let mut machine = live_machine();
        machine.handle(create(RequestId::Number(0), form_for("acp-42")));

        let effects = machine.handle(create(RequestId::Number(1), form_for("acp-42")));

        assert_eq!(refusals(&effects), [RequestId::Number(1)]);
        assert_eq!(machine.pending_elicitation(), Some(&RequestId::Number(0)));
    }

    #[test]
    fn request_scoped_and_foreign_session_elicitations_are_refused() {
        let mut machine = live_machine();

        let request_scoped = CreateElicitationRequest::new(
            ElicitationFormMode::new(
                ElicitationRequestScope::new(RequestId::Number(12)),
                ElicitationSchema::new(),
            ),
            "Workspace name?",
        );
        let effects = machine.handle(create(RequestId::Number(0), request_scoped));
        assert_eq!(refusals(&effects), [RequestId::Number(0)]);

        let effects = machine.handle(create(RequestId::Number(1), form_for("acp-other")));
        assert_eq!(refusals(&effects), [RequestId::Number(1)]);

        assert_eq!(machine.pending_elicitation(), None);
    }

    #[test]
    fn an_unknown_mode_is_refused() {
        let mut machine = live_machine();
        let params = serde_json::json!({
            "sessionId": "acp-42",
            "mode": "_hologram",
            "message": "Look here",
            "projector": "left"
        });
        let effects = machine.handle(frame(
            RawJsonRpcMessage::request(
                "elicitation/create".to_owned(),
                params,
                RequestId::Number(7),
            )
            .unwrap(),
        ));

        assert_eq!(refusals(&effects), [RequestId::Number(7)]);
        assert_eq!(machine.pending_elicitation(), None);
    }

    #[test]
    fn an_answer_with_the_held_id_goes_out_as_a_response_and_frees_the_slot() {
        let mut machine = live_machine();
        machine.handle(create(RequestId::Number(0), form_for("acp-42")));

        let content = BTreeMap::from([(
            "strategy".to_owned(),
            agent_runtime_protocol::domain::action::ElicitationContentValue::Text(
                "balanced".to_owned(),
            ),
        )]);
        let effects = machine.handle(answer(
            ElicitationRequestId::Number(0),
            ElicitationAnswer::Accept {
                content: Some(content),
            },
            1,
        ));

        let responses = sent_responses(&effects);
        assert_eq!(responses.len(), 1, "exactly one response: {effects:?}");
        let (id, result) = &responses[0];
        assert_eq!(*id, RequestId::Number(0));
        let response: CreateElicitationResponse =
            serde_json::from_value(result.clone().unwrap()).unwrap();
        assert!(matches!(response.action, ElicitationAction::Accept(_)));
        assert!(matches!(
            effects.last(),
            Some(Effect::Complete {
                token: 1,
                result: Ok(())
            })
        ));
        assert_eq!(machine.pending_elicitation(), None);

        // Answering again is a conflict: nothing is held any more.
        let effects = machine.handle(answer(
            ElicitationRequestId::Number(0),
            ElicitationAnswer::Decline,
            2,
        ));
        assert!(matches!(
            effects[..],
            [Effect::Complete {
                token: 2,
                result: Err(AgentSessionError::ElicitationNotPending(_))
            }]
        ));
    }

    #[test]
    fn an_answer_with_the_wrong_id_is_refused_and_the_slot_kept() {
        let mut machine = live_machine();
        machine.handle(create(RequestId::Number(0), form_for("acp-42")));

        let effects = machine.handle(answer(
            ElicitationRequestId::Number(99),
            ElicitationAnswer::Decline,
            1,
        ));

        assert!(matches!(
            effects[..],
            [Effect::Complete {
                token: 1,
                result: Err(AgentSessionError::ElicitationNotPending(_))
            }]
        ));
        assert_eq!(machine.pending_elicitation(), Some(&RequestId::Number(0)));
    }

    #[test]
    fn an_answer_before_the_session_is_live_is_refused_not_queued() {
        let mut machine = machine();

        let effects = machine.handle(answer(
            ElicitationRequestId::Number(0),
            ElicitationAnswer::Cancel,
            1,
        ));

        assert!(matches!(
            effects[..],
            [Effect::Complete {
                token: 1,
                result: Err(AgentSessionError::ElicitationNotPending(_))
            }]
        ));
        assert_eq!(machine.pending_count(), 0);
    }

    #[test]
    fn a_stop_cancels_the_held_elicitation_before_cancelling_the_turn() {
        let mut machine = live_machine();
        machine.handle(create(RequestId::Number(0), form_for("acp-42")));

        let effects = machine.handle(stop(1));

        let responses = sent_responses(&effects);
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0].0, RequestId::Number(0));
        let response: CreateElicitationResponse =
            serde_json::from_value(responses[0].1.clone().unwrap()).unwrap();
        assert!(matches!(response.action, ElicitationAction::Cancel));

        // The cancel answer precedes the cancel notification.
        let order: Vec<&str> = effects
            .iter()
            .filter_map(|effect| match effect {
                Effect::Send {
                    message: ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Response(_))),
                    ..
                } => Some("answer"),
                Effect::Send {
                    message: ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Notification(n))),
                    ..
                } if n.method.as_ref() == "session/cancel" => Some("cancel"),
                _ => None,
            })
            .collect();
        assert_eq!(order, ["answer", "cancel"]);
        assert_eq!(machine.pending_elicitation(), None);
    }

    #[test]
    fn a_closed_connection_drops_the_held_elicitation_without_answering() {
        let mut machine = live_machine();
        machine.handle(create(RequestId::Number(0), form_for("acp-42")));

        let effects = machine.handle(Input::Closed(CloseReason::TransportClosed));

        assert!(sent_responses(&effects).is_empty());
        assert_eq!(machine.pending_elicitation(), None);
        assert_eq!(machine.status(), RuntimeStatus::Dead);
    }
}
