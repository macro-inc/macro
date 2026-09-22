use super::*;
use crate::domain::voice::{VoiceRuntimeBinding, VoiceRuntimeConnections};
use agent_runtime_protocol::domain::{channel::Channel, connection::ServerChannel};
use agent_session::domain::connection::RuntimeAttachment;
use agent_session::domain::service::AgentSessionService as _;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

struct Voice {
    binding: Mutex<Option<VoiceRuntimeBinding>>,
    attachment: Mutex<Option<RuntimeAttachment<ServerChannel>>>,
    suspended: AtomicUsize,
    drained: AtomicUsize,
}

#[async_trait::async_trait]
impl VoiceRuntimeConnections for Voice {
    async fn binding(
        &self,
        _: AgentSessionId,
    ) -> crate::domain::error::Result<Option<VoiceRuntimeBinding>> {
        Ok(self.binding.lock().unwrap().clone())
    }
    async fn suspend_text_runtime(&self, _: AgentSessionId) -> crate::domain::error::Result<()> {
        self.suspended.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    async fn drain_voice_runtime(
        &self,
        _: AgentSessionId,
        _: Uuid,
    ) -> crate::domain::error::Result<()> {
        self.drained.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    async fn take_attachment(
        &self,
        session: AgentSessionId,
        _: Uuid,
    ) -> crate::domain::error::Result<RuntimeAttachment<ServerChannel>> {
        self.attachment
            .lock()
            .unwrap()
            .take()
            .ok_or(HarnessError::Disconnected(session))
    }
}

#[tokio::test]
async fn voice_owns_native_and_typed_turns_and_blocks_input_while_ending() {
    let generation = macro_uuid::generate_uuid_v7();
    let (server, mut runtime) = Channel::duplex();
    let voice = Arc::new(Voice {
        binding: Mutex::new(Some(VoiceRuntimeBinding {
            generation,
            speaker: sender(),
            accepts_input: true,
        })),
        attachment: Mutex::new(Some(RuntimeAttachment::solo(server))),
        suspended: AtomicUsize::new(0),
        drained: AtomicUsize::new(0),
    });
    let ((service, repo, containers, _, _), mut signals) = harness_with_voice(
        PromptContextMock::default(),
        PromptComposerMock::default(),
        KindDefaultPolicies,
        PromptMentionsMock::new(),
        voice.clone(),
    );
    let id = AgentSessionId::new();
    let mut row = agent_session::testing::test_agent_session(id);
    row.bot_id = bot_id::MACRO_NEW_BOT_ID;
    row.harness = "in-memory".into();
    row.owner_id = model_owner::Owner::User(sender());
    repo.insert_session(row);
    service
        .execute(id, HarnessCommand::PrepareVoice { generation })
        .await
        .unwrap();
    assert_eq!(voice.suspended.load(Ordering::SeqCst), 1);
    service
        .execute_here(id, HarnessCommand::AttachVoice { generation })
        .await
        .unwrap();
    let sessions = &service.inner.sessions;
    sessions
        .record_runtime_frame(
            id,
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
    sessions
        .record_runtime_frame(
            id,
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
        panic!("new")
    };
    sessions
        .record_runtime_frame(
            id,
            generation,
            ToServerMessage::Acp(AcpMessage(RawJsonRpcMessage::response(
                open.id,
                Ok(json!({"sessionId":"voice"})),
            ))),
        )
        .await
        .unwrap();
    let spoken = AgentActionId::mint();
    service
        .execute(
            id,
            HarnessCommand::NativeVoiceTurn {
                generation,
                action_id: spoken,
                text: "spoken request".into(),
            },
        )
        .await
        .unwrap();
    assert!(
        runtime.rx.try_recv().is_err(),
        "native audio must not become a second model prompt"
    );
    assert!(matches!(
        service
            .execute(id, HarnessCommand::PrepareVoice { generation })
            .await,
        Err(HarnessError::Session(AgentSessionError::TurnConflict))
    ));
    assert_eq!(
        voice.suspended.load(Ordering::SeqCst),
        1,
        "busy preparation cannot stop the current model"
    );
    let typed = DeliverAction::prompt(AgentAction::prompt("typed follow-up"), Some(sender()), None);
    let typed_id = typed.id;
    service
        .execute(id, HarnessCommand::Deliver(typed))
        .await
        .unwrap();
    assert!(
        runtime.rx.try_recv().is_err(),
        "typed input waits for the active voice turn"
    );
    sessions
        .record_runtime_frame(
            id,
            generation,
            ToServerMessage::Acp(AcpMessage(RawJsonRpcMessage::response(
                spoken.to_request_id(),
                Ok(json!({"stopReason":"cancelled"})),
            ))),
        )
        .await
        .unwrap();
    signals.settled(id).await;
    let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(prompt))) =
        runtime.rx.recv().await.unwrap()
    else {
        panic!("typed prompt")
    };
    assert_eq!(prompt.id, typed_id.to_request_id());
    assert_eq!(prompt.method.as_ref(), "session/prompt");
    assert_eq!(containers.resumed(), 0);
    assert_eq!(containers.spawned(), 0);
    sessions
        .record_runtime_frame(
            id,
            generation,
            ToServerMessage::Acp(AcpMessage(RawJsonRpcMessage::response(
                typed_id.to_request_id(),
                Ok(json!({"stopReason":"end_turn"})),
            ))),
        )
        .await
        .unwrap();
    signals.settled(id).await;
    voice
        .binding
        .lock()
        .unwrap()
        .as_mut()
        .unwrap()
        .accepts_input = false;
    let rejected = service
        .execute(
            id,
            HarnessCommand::Deliver(DeliverAction {
                id: AgentActionId::mint(),
                action: AgentAction::set_model("other"),
                actor: Some(sender()),
                announce: None,
            }),
        )
        .await;
    assert!(matches!(rejected, Err(HarnessError::Disconnected(session)) if session == id));
    assert!(runtime.rx.try_recv().is_err());
    service
        .execute(id, HarnessCommand::EndVoice { generation })
        .await
        .unwrap();
    assert_eq!(voice.drained.load(Ordering::SeqCst), 1);
    assert_eq!(containers.resumed(), 0);
    assert!(matches!(
        sessions.management(id).await.unwrap(),
        agent_session::domain::model::SessionManagement::Unmanaged
    ));
}

#[tokio::test]
async fn a_connecting_voice_lease_never_resumes_a_parallel_text_runtime() {
    let generation = macro_uuid::generate_uuid_v7();
    let voice = Arc::new(Voice {
        binding: Mutex::new(Some(VoiceRuntimeBinding {
            generation,
            speaker: sender(),
            accepts_input: true,
        })),
        attachment: Mutex::new(None),
        suspended: AtomicUsize::new(0),
        drained: AtomicUsize::new(0),
    });
    let ((service, repo, containers, _, _), _) = harness_with_voice(
        PromptContextMock::default(),
        PromptComposerMock::default(),
        KindDefaultPolicies,
        PromptMentionsMock::new(),
        voice,
    );
    let id = AgentSessionId::new();
    let mut row = agent_session::testing::test_agent_session(id);
    row.bot_id = bot_id::MACRO_NEW_BOT_ID;
    row.harness = "in-memory".into();
    row.owner_id = model_owner::Owner::User(sender());
    repo.insert_session(row);
    let result = service
        .execute(
            id,
            HarnessCommand::Deliver(DeliverAction::prompt(
                AgentAction::prompt("during connect"),
                Some(sender()),
                None,
            )),
        )
        .await;
    assert!(matches!(result, Err(HarnessError::Disconnected(session)) if session == id));
    assert_eq!(containers.spawned(), 0);
    assert_eq!(containers.resumed(), 0);
}
