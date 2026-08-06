//! Table-driven tests for the pure machine: inputs in, effects out. No
//! tokio, no mocks, no waiting - `Token` is a plain integer.

use agent_client_protocol::schema::v1::{
    InitializeResponse, NewSessionResponse, PermissionOption, PermissionOptionKind, RequestId,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse, Response,
    SelectedPermissionOutcome, ToolCallUpdate, ToolCallUpdateFields,
};
use agent_client_protocol::{JsonRpcMessage, RawJsonRpcMessage};
use agent_runtime_protocol::domain::action::AgentAction;
use agent_runtime_protocol::domain::schema::v0::{
    AcpMessage, SystemEvent, ToRuntimeMessage, ToServerMessage,
};
use macro_user_id::user_id::MacroUserIdStr;

use crate::PROTOCOL_VERSION;
use crate::domain::error::AgentSessionError;
use crate::domain::model::AgentSessionId;

use super::{CloseReason, Effect, Input, RuntimeStatus, SessionMachine, StopReason};

fn machine() -> SessionMachine<u32> {
    SessionMachine::new(AgentSessionId::TEST_A)
}

fn command(text: &str, token: u32) -> Input<u32> {
    Input::Command {
        from: Some(MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id")),
        action: AgentAction::prompt(text),
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
    frame(RawJsonRpcMessage::response(
        request_id(0),
        Ok(
            serde_json::to_value(InitializeResponse::new(PROTOCOL_VERSION))
                .expect("a serializable response"),
        ),
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
        RequestId::Str("agent_session:1".to_owned()),
        Ok(serde_json::to_value(NewSessionResponse::new(session_id))
            .expect("a serializable response")),
    ))
}

fn session_refused() -> Input<u32> {
    frame(RawJsonRpcMessage::response(
        RequestId::Str("agent_session:1".to_owned()),
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

fn request_id(n: u64) -> RequestId {
    RequestId::Str(format!("agent_session:{n}"))
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
fn session_new_success_flushes_the_queue_positionally() {
    let mut machine = machine();
    machine.handle(command("first", 1));
    machine.handle(command("second", 2));
    begin_opening(&mut machine);

    let effects = machine.handle(session_opened("acp-42"));

    // Each action's completion directly follows its send: delivery is
    // positional, not counted.
    assert!(matches!(
        effects[..],
        [
            Effect::Log { .. },
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
        RequestId::Str("agent_session:1".to_owned()),
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
        RequestId::Str("agent_session:2".to_owned()),
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
fn request_ids_never_repeat_across_the_connection() {
    let mut machine = machine();
    machine.handle(command("queued", 1));
    let initialize = machine.handle(acp_ready());
    let open = machine.handle(initialized());
    let flushed = machine.handle(session_opened("acp-42"));
    let live = machine.handle(command("live", 2));

    let mut ids = Vec::new();
    for effects in [&initialize, &open, &flushed, &live] {
        ids.extend(sent_request_ids(effects));
    }

    assert_eq!(
        ids,
        [request_id(0), request_id(1), request_id(2), request_id(3)]
    );
}
