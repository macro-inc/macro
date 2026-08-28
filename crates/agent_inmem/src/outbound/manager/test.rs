//! End to end over the real session service: the manager's transport is
//! attached the way the harness attaches any container, and the machine's
//! whole handshake plus one prompt runs against the in-process agent.

use std::sync::Arc;
use std::time::Duration;

use agent::StreamPart;
use agent_client_protocol::RawJsonRpcMessage;
use agent_fold::domain::log::Message;
use agent_fold::domain::service::FoldedMessageService;
use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use agent_session::domain::connection::RuntimeAttachment;
use agent_session::domain::model::{AgentSessionId, CreateAgentSessionParams};
use agent_session::domain::ports::{AgentSessionLogRepo as _, NoOpRealtime};
use agent_session::domain::service::{AgentSessionService as _, AgentSessionServiceImpl};
use agent_session::testing::InMemoryAgentSessionRepo;
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;

use super::*;
use crate::outbound::log_frames::LogFrameSource;
use crate::testing::ScriptedEngine;

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@macro.com").expect("a valid user id")
}

fn manager(repo: &InMemoryAgentSessionRepo, engine: Arc<ScriptedEngine>) -> InMemAgentManager {
    InMemAgentManager::new(engine, Arc::new(LogFrameSource::new(repo.clone())))
}

fn facts(id: AgentSessionId) -> SessionFacts {
    SessionFacts {
        id,
        owner: owner(),
        model: "test-model".to_owned(),
        acp_session_id: None,
    }
}

/// Frames the log holds, flattened to JSON strings for loose assertions.
async fn logged_frames(repo: &InMemoryAgentSessionRepo, id: AgentSessionId) -> Vec<String> {
    repo.list_by_session(id)
        .await
        .expect("the log should read")
        .into_iter()
        .map(|stored| {
            let frame: &RawJsonRpcMessage = match &stored.entry.content {
                Message::ToServer(message) => match message {
                    agent_runtime_protocol::domain::schema::v0::ToServerMessage::Acp(acp) => &acp.0,
                    _ => return "system-event".to_owned(),
                },
                Message::ToRuntime(message) => match message {
                    agent_runtime_protocol::domain::schema::v0::ToRuntimeMessage::Acp(acp) => {
                        &acp.0
                    }
                    _ => return "to-runtime".to_owned(),
                },
            };
            serde_json::to_string(frame).expect("a frame should serialize")
        })
        .collect()
}

#[tokio::test]
async fn a_prompt_runs_end_to_end_through_the_real_session_machine() {
    let repo = InMemoryAgentSessionRepo::new();
    let sessions = AgentSessionServiceImpl::new(
        repo.clone(),
        FoldedMessageService::new(repo.clone()),
        NoOpRealtime,
    );

    let id = AgentSessionId::new();
    sessions
        .create_session(CreateAgentSessionParams {
            id,
            owner_id: owner(),
            bot_id: BotId::TEST_A,
            thread_id: None,
            originating_message_id: None,
            model: "test-model".to_owned(),
            harness: "macro-inmem".to_owned(),
            repo_url: None,
            workspace: "/workspace".to_owned(),
            sandbox_size: agent_session::domain::model::SandboxSize::Default,
            egress_token_hash: None,
        })
        .await
        .expect("the session row should create");

    let manager = manager(
        &repo,
        Arc::new(ScriptedEngine::new(vec![StreamPart::Content(
            "streamed reply".to_owned(),
        )])),
    );
    let transport = manager.attach(facts(id)).await;
    sessions
        .attach_session(id, RuntimeAttachment::solo(transport))
        .await
        .expect("the transport should attach");
    sessions
        .send_action(
            id,
            Some(owner()),
            AgentAction::prompt("hello agent"),
            AgentActionId::mint(),
        )
        .await
        .expect("the prompt should send");

    // The turn is done once its response frame lands in the log.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    let frames = loop {
        let frames = logged_frames(&repo, id).await;
        if frames.iter().any(|frame| frame.contains("stopReason")) {
            break frames;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "the prompt never completed; log so far: {frames:#?}"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    };

    let all = frames.join("\n");
    assert!(all.contains("initialize"), "no initialize in: {all}");
    assert!(all.contains("session/new"), "no session/new in: {all}");
    assert!(
        all.contains("hello agent"),
        "the prompt frame never logged: {all}"
    );
    assert!(
        all.contains("streamed reply"),
        "the streamed update never logged: {all}"
    );

    let session = sessions
        .get_session(id)
        .await
        .expect("the session row should read");
    assert!(
        session.acp_session_id.is_some(),
        "session/new's id should persist for resume"
    );

    // A second attach must resume rather than die: the row now carries an
    // ACP session id, and this agent declares resume support. Re-attaching
    // kills the previous agent, and the machine only accepts the new
    // transport once the old actor has observed its stream end - the same
    // disconnect-then-resume order the harness's deliver path drives.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let transport = manager.attach(facts(id)).await;
        match sessions
            .attach_session(id, RuntimeAttachment::solo(transport))
            .await
        {
            Ok(()) => break,
            Err(agent_session::domain::error::AgentSessionError::AlreadyConnected(_)) => {
                assert!(
                    tokio::time::Instant::now() < deadline,
                    "the replaced agent never disconnected"
                );
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            Err(error) => panic!("the transport should reattach: {error:?}"),
        }
    }
    sessions
        .send_action(
            id,
            Some(owner()),
            AgentAction::prompt("still there?"),
            AgentActionId::mint(),
        )
        .await
        .expect("the prompt should send on the resumed session");

    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let frames = logged_frames(&repo, id).await;
        if frames.iter().any(|frame| frame.contains("session/resume")) {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "the reattach never resumed; log so far: {frames:#?}"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// A "restart": the second manager shares nothing with the first but the
/// durable repo, the way a new process would. The resumed turn must carry
/// the first turn's conversation, rebuilt from the frame log.
#[tokio::test]
async fn a_restarted_manager_rebuilds_the_conversation_from_the_log() {
    let repo = InMemoryAgentSessionRepo::new();
    let sessions = AgentSessionServiceImpl::new(
        repo.clone(),
        FoldedMessageService::new(repo.clone()),
        NoOpRealtime,
    );

    let id = AgentSessionId::new();
    sessions
        .create_session(CreateAgentSessionParams {
            id,
            owner_id: owner(),
            bot_id: BotId::TEST_A,
            thread_id: None,
            originating_message_id: None,
            model: "test-model".to_owned(),
            harness: "macro-inmem".to_owned(),
            repo_url: None,
            workspace: "/workspace".to_owned(),
            sandbox_size: agent_session::domain::model::SandboxSize::Default,
            egress_token_hash: None,
        })
        .await
        .expect("the session row should create");

    let before = manager(
        &repo,
        Arc::new(ScriptedEngine::new(vec![StreamPart::Content(
            "streamed reply".to_owned(),
        )])),
    );
    let transport = before.attach(facts(id)).await;
    sessions
        .attach_session(id, RuntimeAttachment::solo(transport))
        .await
        .expect("the transport should attach");
    sessions
        .send_action(
            id,
            Some(owner()),
            AgentAction::prompt("hello agent"),
            AgentActionId::mint(),
        )
        .await
        .expect("the prompt should send");

    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let frames = logged_frames(&repo, id).await;
        if frames.iter().any(|frame| frame.contains("stopReason")) {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "the first prompt never completed; log so far: {frames:#?}"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    // Kill the first manager's agents and conversations, as a restart would.
    drop(before);

    let engine = Arc::new(ScriptedEngine::new(vec![StreamPart::Content(
        "back again".to_owned(),
    )]));
    let after = manager(&repo, Arc::clone(&engine));
    let row = sessions
        .get_session(id)
        .await
        .expect("the session row should read");
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let transport = after
            .attach(SessionFacts {
                acp_session_id: row.acp_session_id.clone(),
                ..facts(id)
            })
            .await;
        match sessions
            .attach_session(id, RuntimeAttachment::solo(transport))
            .await
        {
            Ok(()) => break,
            Err(agent_session::domain::error::AgentSessionError::AlreadyConnected(_)) => {
                assert!(
                    tokio::time::Instant::now() < deadline,
                    "the dropped agent never disconnected"
                );
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            Err(error) => panic!("the transport should reattach: {error:?}"),
        }
    }
    sessions
        .send_action(
            id,
            Some(owner()),
            AgentAction::prompt("still there?"),
            AgentActionId::mint(),
        )
        .await
        .expect("the prompt should send on the resumed session");

    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        if !engine.requests().is_empty() {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "the resumed prompt never reached the engine"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    // The rebuilt context: the first turn's prompt and reply, then the new
    // prompt - not just the new prompt.
    assert_eq!(
        engine.requests()[0].1,
        vec![
            "hello agent".to_owned(),
            "streamed reply".to_owned(),
            "still there?".to_owned()
        ]
    );
}
