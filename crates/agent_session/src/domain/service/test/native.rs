//! Native input is admitted by the same durable, generation-fenced actor.

use super::*;
use agent_runtime_protocol::domain::channel::Channel;
use serde_json::json;

async fn native_session() -> (Fixture, Uuid, Channel<ToServerMessage, ToRuntimeMessage>) {
    let fx = fixture();
    let generation = macro_uuid::generate_uuid_v7();
    let (server, mut runtime) = Channel::duplex();
    fx.service
        .attach_session(
            fx.session,
            RuntimeAttachment::solo(server).generation(generation),
        )
        .await
        .unwrap();
    fx.service
        .record_runtime_frame(
            fx.session,
            generation,
            ToServerMessage::Event {
                event: SystemEvent::AcpReady,
            },
        )
        .await
        .unwrap();
    let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(init))) =
        runtime.rx.recv().await.unwrap()
    else {
        panic!("initialize")
    };
    fx.service
        .record_runtime_frame(
            fx.session,
            generation,
            ToServerMessage::Acp(AcpMessage(RawJsonRpcMessage::response(
                init.id,
                Ok(json!({"protocolVersion":1,"agentCapabilities":{}})),
            ))),
        )
        .await
        .unwrap();
    let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(open))) =
        runtime.rx.recv().await.unwrap()
    else {
        panic!("session/new")
    };
    fx.service
        .record_runtime_frame(
            fx.session,
            generation,
            ToServerMessage::Acp(AcpMessage(RawJsonRpcMessage::response(
                open.id,
                Ok(json!({"sessionId":"native-session"})),
            ))),
        )
        .await
        .unwrap();
    (fx, generation, runtime)
}

fn speaker() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("speaker@example.com").unwrap()
}

#[tokio::test]
async fn native_prompt_is_durable_attributed_and_never_echoed_to_the_runtime() {
    let (fx, generation, mut runtime) = native_session().await;
    let action = AgentActionId::mint();
    fx.service
        .record_native_turn(
            fx.session,
            generation,
            speaker(),
            action,
            "Spoken request".into(),
        )
        .await
        .unwrap();
    // A retry of the same in-flight admission neither replays audio nor writes
    // a second user message.
    fx.service
        .record_native_turn(
            fx.session,
            generation,
            speaker(),
            action,
            "Spoken request".into(),
        )
        .await
        .unwrap();
    assert!(runtime.rx.try_recv().is_err());
    let logs = fx.service.session_log(fx.session).await.unwrap();
    let prompts: Vec<_> = logs.entries.iter().filter(|log| matches!(&log.entry.content,
        Message::ToRuntime(ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request))))
        if request.method.as_ref() == "session/prompt"
    )).collect();
    assert_eq!(prompts.len(), 1);
    assert_eq!(prompts[0].entry.user_id.as_ref(), Some(&speaker()));
    let Message::ToRuntime(ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request)))) =
        &prompts[0].entry.content
    else {
        unreachable!()
    };
    assert_eq!(request.id, action.to_request_id());
    let messages = fold(logs.entries.into_iter().map(|entry| entry.entry));
    assert!(
        matches!(&messages[0].parts[0], agent_fold::domain::model::MessagePart::Text { text } if text == "Spoken request")
    );
    fx.service
        .close_runtime(fx.session, generation)
        .await
        .unwrap();
}

#[tokio::test]
async fn a_stale_native_generation_cannot_append_or_close_its_successor() {
    let (fx, generation, mut runtime) = native_session().await;
    let old = macro_uuid::generate_uuid_v7();
    let count = fx
        .service
        .session_log(fx.session)
        .await
        .unwrap()
        .entries
        .len();
    assert!(matches!(
        fx.service
            .record_native_turn(
                fx.session,
                old,
                speaker(),
                AgentActionId::mint(),
                "old audio".into()
            )
            .await,
        Err(AgentSessionError::Forbidden)
    ));
    assert!(matches!(
        fx.service
            .record_runtime_frame(
                fx.session,
                old,
                ToServerMessage::Event {
                    event: SystemEvent::AcpReady
                }
            )
            .await,
        Err(AgentSessionError::Forbidden)
    ));
    fx.service.close_runtime(fx.session, old).await.unwrap();
    assert_eq!(
        fx.service
            .session_log(fx.session)
            .await
            .unwrap()
            .entries
            .len(),
        count
    );
    let action = AgentActionId::mint();
    fx.service
        .send_action(
            fx.session,
            Some(speaker()),
            AgentAction::prompt("typed input"),
            action,
        )
        .await
        .unwrap();
    assert!(
        matches!(runtime.rx.recv().await, Some(ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request)))) if request.id == action.to_request_id())
    );
    fx.service
        .close_runtime(fx.session, generation)
        .await
        .unwrap();
    assert!(matches!(
        fx.service
            .record_native_turn(
                fx.session,
                generation,
                speaker(),
                AgentActionId::mint(),
                "late audio".into()
            )
            .await,
        Err(AgentSessionError::Disconnected(_))
    ));
}

#[tokio::test]
async fn native_turn_conflicts_until_its_canonical_completion_and_cancels_reviews() {
    let (fx, generation, mut runtime) = native_session().await;
    let first = AgentActionId::mint();
    let next = AgentActionId::mint();
    fx.service
        .record_native_turn(fx.session, generation, speaker(), first, "first".into())
        .await
        .unwrap();
    use agent_client_protocol::{
        JsonRpcMessage as _,
        schema::v1::{
            CreateElicitationRequest, ElicitationFormMode, ElicitationSchema,
            ElicitationSessionScope,
        },
    };
    let request = CreateElicitationRequest::new(
        ElicitationFormMode::new(
            ElicitationSessionScope::new(SessionId::new("native-session")),
            ElicitationSchema::new(),
        ),
        "Review before sending",
    );
    let (method, params) = request.to_untyped_message().unwrap().into_parts();
    fx.service
        .record_runtime_frame(
            fx.session,
            generation,
            ToServerMessage::Acp(AcpMessage(
                RawJsonRpcMessage::request(
                    method,
                    params,
                    RequestId::Str("voice-review-test".into()),
                )
                .unwrap(),
            )),
        )
        .await
        .unwrap();
    assert!(matches!(
        fx.service
            .record_native_turn(fx.session, generation, speaker(), next, "next".into())
            .await,
        Err(AgentSessionError::TurnConflict)
    ));
    fx.service
        .record_runtime_frame(
            fx.session,
            generation,
            ToServerMessage::Acp(AcpMessage(RawJsonRpcMessage::response(
                first.to_request_id(),
                Ok(json!({"stopReason":"cancelled"})),
            ))),
        )
        .await
        .unwrap();
    let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Response(Response::Result {
        result,
        ..
    }))) = runtime.rx.recv().await.unwrap()
    else {
        panic!("review must be cancelled")
    };
    assert_eq!(result["action"], "cancel");
    fx.service
        .record_native_turn(fx.session, generation, speaker(), next, "next".into())
        .await
        .unwrap();
    assert!(runtime.rx.try_recv().is_err());
    fx.service
        .close_runtime(fx.session, generation)
        .await
        .unwrap();
}
