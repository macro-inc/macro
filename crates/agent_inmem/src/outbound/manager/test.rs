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
use agent_session::domain::service::{AgentSessionService, AgentSessionServiceImpl};
use agent_session::testing::InMemoryAgentSessionRepo;
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::Owner;

use super::*;
use crate::domain::engine::AgentIdentity;
use crate::outbound::log_frames::LogFrameSource;
use crate::testing::{ScriptedEngine, TestAdmission, disabled_admission};
use agent_session::domain::model::ReplicaId;
use agent_session::domain::ports::{
    NoOpAgentSessionNameGenerator, NoOpTurnObserver, NoopLifecyclePublisher,
};

mod summary;

/// Instructions long enough to be unmistakable in an assertion, and shaped
/// like something a real session would carry.
const INSTRUCTIONS: &str = "Answer in one sentence. Never open a pull request.";

#[tokio::test]
async fn a_failed_history_read_never_creates_an_empty_conversation() {
    use std::sync::atomic::{AtomicBool, Ordering};
    struct RecoverableFrames(Arc<AtomicBool>);
    impl FrameSource for RecoverableFrames {
        fn frames(
            &self,
            _: AgentSessionId,
        ) -> futures::future::BoxFuture<
            '_,
            agent_session::domain::error::Result<Vec<agent_session::domain::model::Message>>,
        > {
            Box::pin(async move {
                if self.0.load(Ordering::SeqCst) {
                    Err(agent_session::domain::error::AgentSessionError::Unknown(
                        anyhow::anyhow!("history unavailable"),
                    ))
                } else {
                    Ok(Vec::new())
                }
            })
        }
    }
    let failed = Arc::new(AtomicBool::new(true));
    let engine = Arc::new(ScriptedEngine::new(Vec::new()));
    let manager = InMemAgentManager::new(
        engine.clone(),
        Arc::new(RecoverableFrames(failed.clone())),
        Arc::new(crate::domain::mcp::NoMcpServers),
        Arc::new(crate::testing::TestModelAccess::paid()),
    );
    let id = AgentSessionId::new();
    assert!(
        manager
            .attach(facts(id), Some("token".to_owned()))
            .await
            .is_err()
    );
    assert!(!manager.store.contains_key(&id));
    assert!(!manager.live.contains_key(&id));
    assert_eq!(manager.session_token(id), None);
    assert!(engine.requests().is_empty());
    failed.store(false, Ordering::SeqCst);
    assert!(manager.attach(facts(id), None).await.is_ok());
    assert!(manager.store.contains_key(&id));
}

/// Attach `transport`, waiting out the previous one's disconnect.
///
/// Replacing a session's agent is two independent events: the manager drops
/// the old task immediately, and the session service notices the transport
/// died a moment later. Until it has, the attach is refused as
/// `AlreadyConnected` - so a reattach retries rather than failing.
async fn attach_retrying(
    sessions: &impl AgentSessionService,
    id: AgentSessionId,
    manager: &InMemAgentManager,
    facts: SessionFacts,
) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let transport = manager
            .attach(facts.clone(), None)
            .await
            .expect("history should restore");
        match sessions
            .attach_session(id, RuntimeAttachment::solo(transport))
            .await
        {
            Ok(()) => return,
            Err(agent_session::domain::error::AgentSessionError::AlreadyConnected(_)) => {
                assert!(
                    tokio::time::Instant::now() < deadline,
                    "the replaced agent never disconnected"
                );
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            Err(error) => panic!("the transport should attach: {error:?}"),
        }
    }
}

/// Compare the original prose while retaining the actual invocation envelope in
/// ScriptedEngine's capture. Protocol tests assert its current action ID.
fn without_invocation_context(message: &str) -> &str {
    let Some((prose, suffix)) = message.rsplit_once("<m-agent-context>") else {
        return message;
    };
    let Some(json) = suffix.strip_suffix("</m-agent-context>") else {
        return message;
    };
    let Ok(context) = serde_json::from_str::<serde_json::Value>(json) else {
        return message;
    };
    let Some(invocation) = context["text"]
        .as_str()
        .and_then(|text| text.strip_prefix("<invocation turn_id=\""))
    else {
        return message;
    };
    let Some((turn, _)) = invocation.split_once('"') else {
        return message;
    };
    if context["version"] == 1 && turn.parse::<macro_uuid::Uuid>().is_ok() {
        prose
    } else {
        message
    }
}

/// Block until the engine has been asked to run the turn answering `prompt`.
///
/// The prompt returns as soon as the session machine has written the frame,
/// which is before the agent task has picked it up - so an assertion on the
/// engine right after `send_action` races it.
async fn await_turns(engine: &ScriptedEngine, prompt: &str) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let seen = engine.requests().iter().any(|turn| {
            turn.messages
                .iter()
                .any(|message| without_invocation_context(message) == prompt)
        });
        if seen {
            return;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "the prompt {prompt:?} never reached the engine"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@macro.com").expect("a valid user id")
}

fn manager(repo: &InMemoryAgentSessionRepo, engine: Arc<ScriptedEngine>) -> InMemAgentManager {
    InMemAgentManager::new(
        engine,
        Arc::new(LogFrameSource::new(repo.clone())),
        Arc::new(crate::domain::mcp::NoMcpServers),
        Arc::new(crate::testing::TestModelAccess::paid()),
    )
}

fn facts(id: AgentSessionId) -> SessionFacts {
    SessionFacts {
        billing: Default::default(),
        delivery: crate::domain::engine::ReplyDelivery::Streamed,
        id,
        owner: Owner::User(owner()),
        model: "anthropic/claude-sonnet-5-5".to_owned(),
        identity: None,
        instructions: None,
        acp_session_id: None,
    }
}

/// The same facts, with the session's row carrying `instructions`.
fn facts_with_instructions(id: AgentSessionId, instructions: &str) -> SessionFacts {
    SessionFacts {
        delivery: crate::domain::engine::ReplyDelivery::Streamed,
        instructions: Some(instructions.to_owned()),
        ..facts(id)
    }
}

fn facts_with_identity(id: AgentSessionId, name: &str, handle: &str) -> SessionFacts {
    SessionFacts {
        delivery: crate::domain::engine::ReplyDelivery::Streamed,
        identity: Some(AgentIdentity {
            bot: BotId::TEST_A,
            name: name.to_owned(),
            handle: handle.to_owned(),
        }),
        ..facts(id)
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
                Message::ToRuntime(message) | Message::Notification(message) => match message {
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
        NoOpAgentSessionNameGenerator,
        Arc::new(NoOpTurnObserver),
        Arc::new(NoopLifecyclePublisher),
        ReplicaId::mint(),
    );

    let id = AgentSessionId::new();
    sessions
        .create_session(CreateAgentSessionParams {
            billing: Default::default(),
            origin: trigger_context::TriggerOrigin::Unknown,
            purpose: agent_session::domain::model::SessionPurpose::Standalone,
            repo_branch: None,
            id,
            owner_id: Owner::User(owner()),
            bot_id: BotId::TEST_A,
            thread_id: None,
            originating_message_id: None,
            model: "anthropic/claude-sonnet-5-5".to_owned(),
            harness: "macro-inmem".to_owned(),
            repo_url: None,
            workspace: "/workspace".to_owned(),
            sandbox_size: agent_session::domain::model::SandboxSize::Default,
            instructions: None,
            mcp_servers: Default::default(),
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
    let manager = manager.with_admission(disabled_admission());
    let transport = manager
        .attach(facts(id), None)
        .await
        .expect("history should restore");
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
        let transport = manager
            .attach(facts(id), None)
            .await
            .expect("history should restore");
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

#[tokio::test]
async fn manager_admission_rejects_turns_without_wedging_the_session() {
    use ai_billing::domain::{AiAdmissionError, DenyReason};

    let repo = InMemoryAgentSessionRepo::new();
    let sessions = AgentSessionServiceImpl::new(
        repo.clone(),
        FoldedMessageService::new(repo.clone()),
        NoOpRealtime,
        NoOpAgentSessionNameGenerator,
        Arc::new(NoOpTurnObserver),
        Arc::new(NoopLifecyclePublisher),
        ReplicaId::mint(),
    );
    let id = AgentSessionId::new();
    sessions
        .create_session(CreateAgentSessionParams {
            billing: Default::default(),
            origin: trigger_context::TriggerOrigin::Unknown,
            purpose: agent_session::domain::model::SessionPurpose::Standalone,
            repo_branch: None,
            id,
            owner_id: Owner::User(owner()),
            bot_id: BotId::TEST_A,
            thread_id: None,
            originating_message_id: None,
            model: "anthropic/claude-sonnet-5-5".to_owned(),
            harness: "macro-inmem".to_owned(),
            repo_url: None,
            workspace: "/workspace".to_owned(),
            sandbox_size: agent_session::domain::model::SandboxSize::Default,
            instructions: None,
            mcp_servers: Default::default(),
            egress_token_hash: None,
        })
        .await
        .unwrap();
    let engine = Arc::new(ScriptedEngine::new(vec![]));
    let denial = AiAdmissionError::Denied(DenyReason::AllowanceExhausted);
    let admission = Arc::new(TestAdmission::new(Err(denial)));
    let manager = manager(&repo, engine.clone()).with_admission(admission.clone());
    let transport = manager.attach(facts(id), None).await.unwrap();
    sessions
        .attach_session(id, RuntimeAttachment::solo(transport))
        .await
        .unwrap();
    sessions
        .send_action(
            id,
            Some(owner()),
            // Development commands are disabled, so this is provider-backed text.
            AgentAction::prompt("/ask unavailable"),
            AgentActionId::mint(),
        )
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if logged_frames(&repo, id)
                .await
                .iter()
                .any(|frame| frame.contains(denial.code()))
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the runtime must return its sanitized denial");
    assert!(engine.requests().is_empty());
    assert!(manager.store.get(&id).unwrap().history.is_empty());
    assert_eq!(
        *admission.calls.lock().unwrap(),
        vec![(owner().to_string(), ai_usage::AiFeature::AgentSession)]
    );

    // A second prompt must run on the same connection: a rejection is not a
    // disconnect and must release the session machine's pending turn.
    *admission.result.lock().unwrap() = Ok(());
    sessions
        .send_action(
            id,
            Some(owner()),
            AgentAction::prompt("retry"),
            AgentActionId::mint(),
        )
        .await
        .unwrap();
    await_turns(&engine, "retry").await;
    assert_eq!(
        engine.requests()[0]
            .messages
            .iter()
            .map(|text| without_invocation_context(text).to_owned())
            .collect::<Vec<_>>(),
        ["retry"]
    );
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
        NoOpAgentSessionNameGenerator,
        Arc::new(NoOpTurnObserver),
        Arc::new(NoopLifecyclePublisher),
        ReplicaId::mint(),
    );

    let id = AgentSessionId::new();
    sessions
        .create_session(CreateAgentSessionParams {
            billing: Default::default(),
            origin: trigger_context::TriggerOrigin::Unknown,
            purpose: agent_session::domain::model::SessionPurpose::Standalone,
            repo_branch: None,
            id,
            owner_id: Owner::User(owner()),
            bot_id: BotId::TEST_A,
            thread_id: None,
            originating_message_id: None,
            model: "anthropic/claude-sonnet-5-5".to_owned(),
            harness: "macro-inmem".to_owned(),
            repo_url: None,
            workspace: "/workspace".to_owned(),
            sandbox_size: agent_session::domain::model::SandboxSize::Default,
            instructions: None,
            mcp_servers: Default::default(),
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
    let transport = before
        .attach(facts(id), None)
        .await
        .expect("history should restore");
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
            .attach(
                SessionFacts {
                    delivery: crate::domain::engine::ReplyDelivery::Streamed,
                    acp_session_id: row.acp_session_id.clone(),
                    ..facts(id)
                },
                None,
            )
            .await
            .expect("history should restore");
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
        engine.requests()[0]
            .messages
            .iter()
            .map(|text| without_invocation_context(text).to_owned())
            .collect::<Vec<_>>(),
        vec![
            "hello agent".to_owned(),
            "streamed reply".to_owned(),
            "still there?".to_owned()
        ]
    );
}

/// The session row's instructions reach every turn the engine runs, and keep
/// reaching it after the agent task is replaced.
///
/// Both halves matter and only one is obvious. The first prompt proves the
/// column is wired to the engine at all; the second proves the value lives on
/// the conversation state rather than on the agent task, which is what makes
/// a reattach - the idle reaper's, or a redeploy's - keep the system prompt
/// the session was opened with.
#[tokio::test]
async fn instructions_reach_every_turn_including_after_a_reattach() {
    let repo = InMemoryAgentSessionRepo::new();
    let sessions = AgentSessionServiceImpl::new(
        repo.clone(),
        FoldedMessageService::new(repo.clone()),
        NoOpRealtime,
        NoOpAgentSessionNameGenerator,
        Arc::new(NoOpTurnObserver),
        Arc::new(NoopLifecyclePublisher),
        ReplicaId::mint(),
    );

    let id = AgentSessionId::new();
    sessions
        .create_session(CreateAgentSessionParams {
            billing: Default::default(),
            origin: trigger_context::TriggerOrigin::Unknown,
            purpose: agent_session::domain::model::SessionPurpose::Standalone,
            repo_branch: None,
            id,
            owner_id: Owner::User(owner()),
            bot_id: BotId::TEST_A,
            thread_id: None,
            originating_message_id: None,
            model: "anthropic/claude-sonnet-5-5".to_owned(),
            harness: "macro-inmem".to_owned(),
            repo_url: None,
            workspace: "/workspace".to_owned(),
            sandbox_size: agent_session::domain::model::SandboxSize::Default,
            instructions: Some(INSTRUCTIONS.to_owned()),
            mcp_servers: Default::default(),
            egress_token_hash: None,
        })
        .await
        .expect("the session row should create");

    let engine = Arc::new(ScriptedEngine::new(vec![StreamPart::Content(
        "acknowledged".to_owned(),
    )]));
    let manager = manager(&repo, Arc::clone(&engine));

    for prompt in ["first", "second"] {
        // A fresh attach each time, as a reaped-then-resumed session gets:
        // the agent task is replaced, the conversation store is not.
        attach_retrying(
            &sessions,
            id,
            &manager,
            facts_with_instructions(id, INSTRUCTIONS),
        )
        .await;
        sessions
            .send_action(
                id,
                Some(owner()),
                AgentAction::prompt(prompt),
                AgentActionId::mint(),
            )
            .await
            .expect("the prompt should send");
        await_turns(&engine, prompt).await;
    }

    let instructions: Vec<Option<String>> = engine
        .requests()
        .into_iter()
        .map(|turn| turn.instructions)
        .collect();
    assert_eq!(
        instructions,
        vec![Some(INSTRUCTIONS.to_owned()), Some(INSTRUCTIONS.to_owned())],
        "both turns run under the session's instructions"
    );
}

/// A session with no instructions hands the engine none, rather than an empty
/// string it would splice into its system prompt as a blank section.
#[tokio::test]
async fn a_session_without_instructions_hands_the_engine_none() {
    let repo = InMemoryAgentSessionRepo::new();
    let sessions = AgentSessionServiceImpl::new(
        repo.clone(),
        FoldedMessageService::new(repo.clone()),
        NoOpRealtime,
        NoOpAgentSessionNameGenerator,
        Arc::new(NoOpTurnObserver),
        Arc::new(NoopLifecyclePublisher),
        ReplicaId::mint(),
    );

    let id = AgentSessionId::new();
    sessions
        .create_session(CreateAgentSessionParams {
            billing: Default::default(),
            origin: trigger_context::TriggerOrigin::Unknown,
            purpose: agent_session::domain::model::SessionPurpose::Standalone,
            repo_branch: None,
            id,
            owner_id: Owner::User(owner()),
            bot_id: BotId::TEST_A,
            thread_id: None,
            originating_message_id: None,
            model: "anthropic/claude-sonnet-5-5".to_owned(),
            harness: "macro-inmem".to_owned(),
            repo_url: None,
            workspace: "/workspace".to_owned(),
            sandbox_size: agent_session::domain::model::SandboxSize::Default,
            instructions: None,
            mcp_servers: Default::default(),
            egress_token_hash: None,
        })
        .await
        .expect("the session row should create");

    let engine = Arc::new(ScriptedEngine::new(vec![StreamPart::Content(
        "acknowledged".to_owned(),
    )]));
    let manager = manager(&repo, Arc::clone(&engine));
    let transport = manager
        .attach(facts(id), None)
        .await
        .expect("history should restore");
    sessions
        .attach_session(id, RuntimeAttachment::solo(transport))
        .await
        .expect("the transport should attach");
    sessions
        .send_action(
            id,
            Some(owner()),
            AgentAction::prompt("hello"),
            AgentActionId::mint(),
        )
        .await
        .expect("the prompt should send");
    await_turns(&engine, "hello").await;

    assert_eq!(engine.requests()[0].instructions, None);
}

/// The session's bot identity reaches every turn, including after a reattach
/// that replaces the agent task. A named agent with no instructions still
/// knows who it is.
#[tokio::test]
async fn identity_reaches_every_turn_including_after_a_reattach() {
    let repo = InMemoryAgentSessionRepo::new();
    let sessions = AgentSessionServiceImpl::new(
        repo.clone(),
        FoldedMessageService::new(repo.clone()),
        NoOpRealtime,
        NoOpAgentSessionNameGenerator,
        Arc::new(NoOpTurnObserver),
        Arc::new(NoopLifecyclePublisher),
        ReplicaId::mint(),
    );

    let id = AgentSessionId::new();
    sessions
        .create_session(CreateAgentSessionParams {
            billing: Default::default(),
            origin: trigger_context::TriggerOrigin::Unknown,
            purpose: agent_session::domain::model::SessionPurpose::Standalone,
            repo_branch: None,
            id,
            owner_id: Owner::User(owner()),
            bot_id: BotId::TEST_A,
            thread_id: None,
            originating_message_id: None,
            model: "anthropic/claude-sonnet-5-5".to_owned(),
            harness: "macro-inmem".to_owned(),
            repo_url: None,
            workspace: "/workspace".to_owned(),
            sandbox_size: agent_session::domain::model::SandboxSize::Default,
            instructions: None,
            mcp_servers: Default::default(),
            egress_token_hash: None,
        })
        .await
        .expect("the session row should create");

    let engine = Arc::new(ScriptedEngine::new(vec![StreamPart::Content(
        "i am grunk".to_owned(),
    )]));
    let manager = manager(&repo, Arc::clone(&engine));

    for prompt in ["who are you", "say your handle"] {
        attach_retrying(
            &sessions,
            id,
            &manager,
            facts_with_identity(id, "Grunk", "grunk"),
        )
        .await;
        sessions
            .send_action(
                id,
                Some(owner()),
                AgentAction::prompt(prompt),
                AgentActionId::mint(),
            )
            .await
            .expect("the prompt should send");
        await_turns(&engine, prompt).await;
    }

    let identities: Vec<Option<(String, String)>> = engine
        .requests()
        .into_iter()
        .map(|turn| {
            turn.identity
                .map(|identity| (identity.name, identity.handle))
        })
        .collect();
    assert_eq!(
        identities,
        vec![
            Some(("Grunk".to_owned(), "grunk".to_owned())),
            Some(("Grunk".to_owned(), "grunk".to_owned())),
        ],
        "both turns run as the named agent"
    );
}

/// The egress token has no container environment to live in here, so the
/// manager keeps what spawn handed it: a resume finds it, teardown forgets it.
#[tokio::test]
async fn the_manager_remembers_the_egress_token_from_spawn_until_teardown() {
    let repo = InMemoryAgentSessionRepo::new();
    let manager = manager(&repo, Arc::new(ScriptedEngine::new(Vec::new())));
    let id = AgentSessionId::new();
    assert_eq!(manager.session_token(id), None);

    let _spawned = manager
        .attach(facts(id), Some("session-token".to_owned()))
        .await
        .expect("history should restore");
    assert_eq!(manager.session_token(id).as_deref(), Some("session-token"));

    // A resume passes nothing and keeps what spawn stored.
    let _resumed = manager
        .attach(facts(id), None)
        .await
        .expect("history should restore");
    assert_eq!(manager.session_token(id).as_deref(), Some("session-token"));

    manager.teardown(id);
    assert_eq!(manager.session_token(id), None);
}

/// Teardown is what ends the session, so it also drops the MCP sessions the
/// egress token was holding. A connector that pools them learns the token.
#[tokio::test]
async fn teardown_releases_pooled_mcp_sessions_for_the_egress_token() {
    let repo = InMemoryAgentSessionRepo::new();
    let mcp = Arc::new(RecordingRelease {
        released: std::sync::Mutex::new(Vec::new()),
    });
    let manager = InMemAgentManager::new(
        Arc::new(ScriptedEngine::new(Vec::new())),
        Arc::new(LogFrameSource::new(repo.clone())),
        mcp.clone(),
        Arc::new(crate::testing::TestModelAccess::paid()),
    );
    let id = AgentSessionId::new();
    let _spawned = manager
        .attach(facts(id), Some("session-token".to_owned()))
        .await
        .expect("history should restore");

    manager.teardown(id);

    assert_eq!(
        mcp.released.lock().expect("lock").as_slice(),
        ["session-token"]
    );
}

/// A resume that rotates the credential leaves the old token unaccepted, so
/// the MCP sessions pooled under it are released; the same token again is
/// still in use and keeps them.
#[tokio::test]
async fn attaching_with_a_new_token_releases_the_replaced_one() {
    let repo = InMemoryAgentSessionRepo::new();
    let mcp = Arc::new(RecordingRelease {
        released: std::sync::Mutex::new(Vec::new()),
    });
    let manager = InMemAgentManager::new(
        Arc::new(ScriptedEngine::new(Vec::new())),
        Arc::new(LogFrameSource::new(repo.clone())),
        mcp.clone(),
        Arc::new(crate::testing::TestModelAccess::paid()),
    );
    let id = AgentSessionId::new();
    let _spawned = manager
        .attach(facts(id), Some("spawned".to_owned()))
        .await
        .expect("history should restore");
    let _same = manager
        .attach(facts(id), Some("spawned".to_owned()))
        .await
        .expect("history should restore");
    assert!(mcp.released.lock().expect("lock").is_empty());

    let _rotated = manager
        .attach(facts(id), Some("rotated".to_owned()))
        .await
        .expect("history should restore");

    assert_eq!(manager.session_token(id).as_deref(), Some("rotated"));
    assert_eq!(mcp.released.lock().expect("lock").as_slice(), ["spawned"]);
}

/// Records [`McpToolConnector::release`] so teardown can be seen doing it.
struct RecordingRelease {
    released: std::sync::Mutex<Vec<String>>,
}

impl crate::domain::mcp::McpToolConnector for RecordingRelease {
    async fn connect(
        &self,
        _servers: Vec<agent_client_protocol::schema::v1::McpServerHttp>,
    ) -> Option<mcp_toolset::RemoteMcpToolSet> {
        None
    }

    fn release(&self, token: &str) {
        self.released.lock().expect("lock").push(token.to_owned());
    }
}

/// Run one prompt through a session attached with `billing`, and return
/// what its turn was admitted as and what its engine was asked to meter.
async fn turn_features(
    billing: agent_session::domain::model::SessionBilling,
) -> (Vec<(String, ai_usage::AiFeature)>, Vec<ai_usage::AiFeature>) {
    let repo = InMemoryAgentSessionRepo::new();
    let sessions = AgentSessionServiceImpl::new(
        repo.clone(),
        FoldedMessageService::new(repo.clone()),
        NoOpRealtime,
        NoOpAgentSessionNameGenerator,
        Arc::new(NoOpTurnObserver),
        Arc::new(NoopLifecyclePublisher),
        ReplicaId::mint(),
    );
    let id = AgentSessionId::new();
    sessions
        .create_session(CreateAgentSessionParams {
            billing,
            origin: trigger_context::TriggerOrigin::Unknown,
            purpose: agent_session::domain::model::SessionPurpose::Standalone,
            repo_branch: None,
            id,
            owner_id: Owner::User(owner()),
            bot_id: BotId::TEST_A,
            thread_id: None,
            originating_message_id: None,
            model: "anthropic/claude-sonnet-5-5".to_owned(),
            harness: "macro-inmem".to_owned(),
            repo_url: None,
            workspace: "/workspace".to_owned(),
            sandbox_size: agent_session::domain::model::SandboxSize::Default,
            instructions: None,
            mcp_servers: Default::default(),
            egress_token_hash: None,
        })
        .await
        .unwrap();
    let engine = Arc::new(ScriptedEngine::new(vec![StreamPart::Content(
        "done".to_owned(),
    )]));
    let admission = Arc::new(TestAdmission::new(Ok(())));
    let manager = manager(&repo, engine.clone()).with_admission(admission.clone());
    // What the harness reads off the session row at attach.
    let facts = SessionFacts {
        billing: sessions.session_billing(id).await.unwrap(),
        ..facts(id)
    };
    let transport = manager.attach(facts, None).await.unwrap();
    sessions
        .attach_session(id, RuntimeAttachment::solo(transport))
        .await
        .unwrap();
    sessions
        .send_action(
            id,
            Some(owner()),
            AgentAction::prompt("hello"),
            AgentActionId::mint(),
        )
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while engine.requests().is_empty() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the prompt must reach the engine");
    let admitted = admission.calls.lock().unwrap().clone();
    let metered = engine
        .requests()
        .iter()
        .map(|request| request.feature)
        .collect();
    (admitted, metered)
}

#[tokio::test]
async fn a_non_billable_session_admits_and_meters_its_turns_as_non_billable() {
    let (admitted, metered) =
        turn_features(agent_session::domain::model::SessionBilling::NonBillable).await;
    assert_eq!(
        admitted,
        vec![(
            owner().to_string(),
            ai_usage::AiFeature::NonBillableAgentSession
        )]
    );
    assert_eq!(metered, vec![ai_usage::AiFeature::NonBillableAgentSession]);
}

#[tokio::test]
async fn a_default_session_still_admits_and_meters_its_turns_as_agent_session() {
    let (admitted, metered) = turn_features(Default::default()).await;
    assert_eq!(
        admitted,
        vec![(owner().to_string(), ai_usage::AiFeature::AgentSession)]
    );
    assert_eq!(metered, vec![ai_usage::AiFeature::AgentSession]);
}

/// Reports each ended turn, so a test waits for one instead of polling.
struct TurnEnds(tokio::sync::mpsc::UnboundedSender<AgentSessionId>);

impl agent_session::domain::ports::SessionTurnObserver for TurnEnds {
    fn signal(&self, id: AgentSessionId, signal: agent_fold::domain::model::TurnSignal) {
        if matches!(
            signal,
            agent_fold::domain::model::TurnSignal::TurnEnded { .. }
        ) {
            let _ = self.0.send(id);
        }
    }

    fn session_stopped(
        &self,
        _id: AgentSessionId,
        _reason: agent_session::domain::session::StopReason,
    ) {
    }

    fn runtime_closed(&self, _id: AgentSessionId) {}
}

/// The harness's idle release closes the session's actor and tears down its
/// state in this manager. The next attach on the same manager rebuilds the
/// conversation from the log, with every earlier message exactly once.
#[tokio::test]
async fn an_idle_release_rebuilds_the_conversation_without_losing_or_repeating_it() {
    let repo = InMemoryAgentSessionRepo::new();
    let (ended_tx, mut ended) = tokio::sync::mpsc::unbounded_channel();
    let sessions = AgentSessionServiceImpl::new(
        repo.clone(),
        FoldedMessageService::new(repo.clone()),
        NoOpRealtime,
        NoOpAgentSessionNameGenerator,
        Arc::new(TurnEnds(ended_tx)),
        Arc::new(NoopLifecyclePublisher),
        ReplicaId::mint(),
    );
    let id = AgentSessionId::new();
    sessions
        .create_session(CreateAgentSessionParams {
            billing: Default::default(),
            origin: trigger_context::TriggerOrigin::Unknown,
            purpose: agent_session::domain::model::SessionPurpose::Standalone,
            repo_branch: None,
            id,
            owner_id: Owner::User(owner()),
            bot_id: BotId::TEST_A,
            thread_id: None,
            originating_message_id: None,
            model: "anthropic/claude-sonnet-5-5".to_owned(),
            harness: "macro-inmem".to_owned(),
            repo_url: None,
            workspace: "/workspace".to_owned(),
            sandbox_size: agent_session::domain::model::SandboxSize::Default,
            instructions: None,
            mcp_servers: Default::default(),
            egress_token_hash: None,
        })
        .await
        .expect("the session row should create");
    let engine = Arc::new(ScriptedEngine::new(vec![StreamPart::Content(
        "a reply".to_owned(),
    )]));
    let manager = manager(&repo, Arc::clone(&engine));

    let transport = manager
        .attach(facts(id), Some("first-token".to_owned()))
        .await
        .expect("the conversation starts");
    sessions
        .attach_session(id, RuntimeAttachment::solo(transport))
        .await
        .expect("the transport attaches");
    for prompt in ["first question", "second question"] {
        sessions
            .send_action(
                id,
                Some(owner()),
                AgentAction::prompt(prompt),
                AgentActionId::mint(),
            )
            .await
            .expect("the prompt sends");
        assert_eq!(ended.recv().await, Some(id));
    }

    let row = sessions.get_session(id).await.expect("the row reads");
    let row_facts = SessionFacts {
        acp_session_id: row.acp_session_id.clone(),
        ..facts(id)
    };
    assert!(
        manager
            .rebuilds_identically(&row_facts)
            .await
            .expect("the log reads"),
        "the log rebuilds the live conversation exactly"
    );

    // What the harness's idle release does for an in-process session.
    let frames = repo.list_by_session(id).await.expect("the log reads").len();
    assert_eq!(
        sessions
            .release_session(id)
            .await
            .expect("the actor releases"),
        agent_session::domain::model::SessionRelease::Released
    );
    manager.teardown(id);
    assert_eq!(
        repo.list_by_session(id).await.expect("the log reads").len(),
        frames,
        "the release writes nothing to the log"
    );
    assert_eq!(manager.conversations(), 0);
    assert_eq!(manager.live_agents(), 0);
    assert_eq!(manager.session_token(id), None);

    // What its next prompt's resume does.
    let transport = manager
        .attach(row_facts, Some("second-token".to_owned()))
        .await
        .expect("the conversation rebuilds from the log");
    sessions
        .attach_session(id, RuntimeAttachment::solo(transport))
        .await
        .expect("the rebuilt transport attaches");
    sessions
        .send_action(
            id,
            Some(owner()),
            AgentAction::prompt("third question"),
            AgentActionId::mint(),
        )
        .await
        .expect("the prompt sends on the rebuilt session");
    assert_eq!(ended.recv().await, Some(id));

    assert!(
        !repo
            .list_by_session(id)
            .await
            .expect("the log reads")
            .iter()
            .any(|stored| matches!(
                &stored.entry.content,
                Message::ToServer(
                    agent_runtime_protocol::domain::schema::v0::ToServerMessage::Event {
                        event:
                            agent_runtime_protocol::domain::schema::v0::SystemEvent::Disconnected
                    }
                )
            )),
        "the session's history never shows it disconnecting"
    );
    // The transcript readers see: every message once, in order.
    let transcript = sessions
        .folded_session_log(id)
        .await
        .expect("the log folds")
        .messages
        .into_iter()
        .map(|message| {
            let text = message
                .parts
                .iter()
                .filter_map(|part| match part {
                    agent_fold::domain::model::MessagePart::Text { text } => {
                        Some(without_invocation_context(text).to_owned())
                    }
                    _ => None,
                })
                .collect::<String>();
            (message.author.kind(), text)
        })
        .collect::<Vec<_>>();
    use agent_fold::domain::model::AuthorKind::{Agent, User};
    assert_eq!(
        transcript,
        vec![
            (User, "first question".to_owned()),
            (Agent, "a reply".to_owned()),
            (User, "second question".to_owned()),
            (Agent, "a reply".to_owned()),
            (User, "third question".to_owned()),
            (Agent, "a reply".to_owned()),
        ]
    );
    let turns = engine.requests();
    assert_eq!(turns.len(), 3);
    assert_eq!(
        turns[2]
            .messages
            .iter()
            .map(|text| without_invocation_context(text).to_owned())
            .collect::<Vec<_>>(),
        vec![
            "first question".to_owned(),
            "a reply".to_owned(),
            "second question".to_owned(),
            "a reply".to_owned(),
            "third question".to_owned(),
        ]
    );
}

/// Summary state is not in the log, so a session holding any keeps it.
#[tokio::test]
async fn a_failed_summary_keeps_the_session_from_rebuilding_identically() {
    let repo = InMemoryAgentSessionRepo::new();
    let manager = manager(
        &repo,
        Arc::new(ScriptedEngine::new(vec![StreamPart::Content(
            "a reply".to_owned(),
        )])),
    );
    let id = AgentSessionId::new();
    let _transport = manager
        .attach(facts(id), None)
        .await
        .expect("an empty conversation starts");
    assert!(
        manager
            .rebuilds_identically(&facts(id))
            .await
            .expect("the log reads")
    );

    manager
        .store
        .get_mut(&id)
        .expect("the conversation is held")
        .summarizing
        .failed_at = Some(120_000);

    assert!(
        !manager
            .rebuilds_identically(&facts(id))
            .await
            .expect("the log reads")
    );
}

struct FixtureServer;
impl rmcp::ServerHandler for FixtureServer {}

/// A session that called MCP tools - a connected app's, and code mode's
/// `ExecuteCode` on Macro's own server - rebuilds from its log exactly as the
/// live agent recorded it, so the idle release lets it go.
///
/// The servers and the toolset are real: each call is named and routed by a
/// [`mcp_toolset::RemoteMcpToolSet`] over live MCP sessions, the way the agent
/// loop's hook names and routes the calls a model makes.
#[tokio::test]
async fn mcp_tool_calls_rebuild_identically_and_the_session_releases() {
    let mut servers = Vec::new();
    let mut listed = Vec::new();
    for (server_name, tool_name, title) in [
        ("Google Sheets", "add_row", Some("Add a row")),
        ("macro_internal", "ExecuteCode", None),
    ] {
        let (server_io, client_io) = tokio::io::duplex(4096);
        let (server, client) = tokio::join!(
            rmcp::ServiceExt::serve(FixtureServer, server_io),
            rmcp::ServiceExt::serve(mcp_toolset::client_info(), client_io),
        );
        let mut tool = rmcp::model::Tool::new(
            tool_name.to_owned(),
            "Fixture tool",
            Arc::new(
                serde_json::json!({"type": "object"})
                    .as_object()
                    .expect("an object schema")
                    .clone(),
            ),
        );
        tool.title = title.map(str::to_owned);
        servers.push(server.expect("the fixture server starts"));
        listed.push(mcp_toolset::ListedServer {
            name: server_name.to_owned(),
            client: Arc::new(client.expect("the client connects")),
            tools: vec![tool],
        });
    }
    let remote = mcp_toolset::RemoteMcpToolSet::from_listed(listed, None);
    // The context type is the toolset's caller's; naming and routing ignore it.
    let names = ai_toolset::ToolSet::<()>::request_schemas(&remote)
        .expect("the servers list tools")
        .into_iter()
        .map(|schema| schema.name)
        .collect::<Vec<_>>();
    let mangled = |tool: &str| {
        names
            .iter()
            .find(|name| name.ends_with(tool))
            .expect("the tool is listed")
            .clone()
    };
    let (sheets, execute_code) = (mangled("add_row"), mangled("ExecuteCode"));
    assert_eq!(execute_code, "mcp__macro_internal__ExecuteCode");
    let routed = |name: &str| {
        ai_toolset::ToolSet::<()>::routing_description(&remote, name).map(
            |ai_toolset::ToolInfo::ExternalTool {
                 service_name,
                 tool_name,
                 display_name,
             }| agent::McpInfo {
                service: service_name,
                tool_name,
                display_name,
            },
        )
    };

    let repo = InMemoryAgentSessionRepo::new();
    let (ended_tx, mut ended) = tokio::sync::mpsc::unbounded_channel();
    let sessions = AgentSessionServiceImpl::new(
        repo.clone(),
        FoldedMessageService::new(repo.clone()),
        NoOpRealtime,
        NoOpAgentSessionNameGenerator,
        Arc::new(TurnEnds(ended_tx)),
        Arc::new(NoopLifecyclePublisher),
        ReplicaId::mint(),
    );
    let id = AgentSessionId::new();
    sessions
        .create_session(CreateAgentSessionParams {
            billing: Default::default(),
            origin: trigger_context::TriggerOrigin::Unknown,
            purpose: agent_session::domain::model::SessionPurpose::Standalone,
            repo_branch: None,
            id,
            owner_id: Owner::User(owner()),
            bot_id: BotId::TEST_A,
            thread_id: None,
            originating_message_id: None,
            model: "anthropic/claude-sonnet-5-5".to_owned(),
            harness: "macro-inmem".to_owned(),
            repo_url: None,
            workspace: "/workspace".to_owned(),
            sandbox_size: agent_session::domain::model::SandboxSize::Default,
            instructions: None,
            mcp_servers: Default::default(),
            egress_token_hash: None,
        })
        .await
        .expect("the session row should create");
    let engine = Arc::new(ScriptedEngine::new(vec![
        StreamPart::Thinking("Add the row first.".to_owned()),
        StreamPart::Content("Adding it".to_owned()),
        StreamPart::ToolCall(agent::ToolCall {
            id: "call-sheets".to_owned(),
            name: sheets.clone(),
            json: serde_json::json!({"sheet": "Q4", "values": ["a", "b"]}),
            mcp: routed(&sheets),
        }),
        StreamPart::ToolResponse(agent::ToolResponse::Json {
            id: "call-sheets".to_owned(),
            json: serde_json::json!({"row": 7}),
            name: sheets.clone(),
        }),
        StreamPart::ToolCallStarted(agent::ToolCallStart {
            id: "call-code".to_owned(),
            name: execute_code.clone(),
            mcp: routed(&execute_code),
        }),
        StreamPart::ToolCall(agent::ToolCall {
            id: "call-code".to_owned(),
            name: execute_code.clone(),
            json: serde_json::json!({"code": "return 1 + 1"}),
            mcp: routed(&execute_code),
        }),
        StreamPart::ToolResponse(agent::ToolResponse::Json {
            id: "call-code".to_owned(),
            json: serde_json::json!({"result": 2}),
            name: execute_code.clone(),
        }),
        StreamPart::Content("Done: ".to_owned()),
        StreamPart::Thinking("Report it.".to_owned()),
        StreamPart::Content("row 7".to_owned()),
    ]));
    let manager = manager(&repo, Arc::clone(&engine));

    let transport = manager
        .attach(facts(id), Some("first-token".to_owned()))
        .await
        .expect("the conversation starts");
    sessions
        .attach_session(id, RuntimeAttachment::solo(transport))
        .await
        .expect("the transport attaches");
    sessions
        .send_action(
            id,
            Some(owner()),
            AgentAction::prompt("add a row"),
            AgentActionId::mint(),
        )
        .await
        .expect("the prompt sends");
    assert_eq!(ended.recv().await, Some(id));
    let live = manager
        .store
        .get(&id)
        .expect("the conversation is held")
        .history
        .clone();
    assert!(
        live.iter().any(|entry| matches!(
            entry,
            HistoryEntry::Assistant(parts) if parts.iter().any(|part| matches!(
                part,
                agent::types::AssistantMessagePart::McpToolCall { name, service, .. }
                    if name == "ExecuteCode" && service == "macro_internal"
            ))
        )),
        "the live agent recorded ExecuteCode as an MCP call: {live:#?}"
    );

    let row = sessions.get_session(id).await.expect("the row reads");
    let row_facts = SessionFacts {
        acp_session_id: row.acp_session_id.clone(),
        ..facts(id)
    };
    assert!(
        manager
            .rebuilds_identically(&row_facts)
            .await
            .expect("the log reads"),
        "the log rebuilds the live conversation exactly"
    );
    assert_eq!(
        sessions
            .release_session(id)
            .await
            .expect("the actor releases"),
        agent_session::domain::model::SessionRelease::Released
    );
    manager.teardown(id);

    let _transport = manager
        .attach(row_facts, None)
        .await
        .expect("the conversation rebuilds from the log");
    let rebuilt = manager
        .store
        .get(&id)
        .expect("the rebuilt conversation is held")
        .history
        .clone();
    assert_eq!(model_history(&rebuilt), model_history(&live));
    drop(servers);
}

/// Starts an MCP call, then fails the turn before it answers.
struct FailingMidCallEngine;

impl TurnEngine for FailingMidCallEngine {
    fn supported_models(&self) -> &[&str] {
        &["anthropic/claude-sonnet-5-5"]
    }

    fn run_turn(
        &self,
        _request: crate::domain::engine::TurnRequest,
    ) -> tokio::sync::mpsc::Receiver<Result<StreamPart, agent::AgentError>> {
        let (parts, receiver) = tokio::sync::mpsc::channel(4);
        tokio::spawn(async move {
            let _ = parts
                .send(Ok(StreamPart::ToolCall(agent::ToolCall {
                    id: "call-code".to_owned(),
                    name: "mcp__macro_internal__ExecuteCode".to_owned(),
                    json: serde_json::json!({"code": "return 1"}),
                    mcp: Some(agent::McpInfo {
                        service: "macro_internal".to_owned(),
                        tool_name: "ExecuteCode".to_owned(),
                        display_name: None,
                    }),
                })))
                .await;
            let _ = parts
                .send(Err(agent::AgentError::Other(anyhow::anyhow!(
                    "the provider went away"
                ))))
                .await;
        });
        receiver
    }
}

/// Says something, then fails the turn.
struct FailingEngine;

impl TurnEngine for FailingEngine {
    fn supported_models(&self) -> &[&str] {
        &["anthropic/claude-sonnet-5-5"]
    }

    fn run_turn(
        &self,
        _request: crate::domain::engine::TurnRequest,
    ) -> tokio::sync::mpsc::Receiver<Result<StreamPart, agent::AgentError>> {
        let (parts, receiver) = tokio::sync::mpsc::channel(4);
        tokio::spawn(async move {
            let _ = parts
                .send(Ok(StreamPart::Content("Looking into it".to_owned())))
                .await;
            let _ = parts
                .send(Err(agent::AgentError::Other(anyhow::anyhow!(
                    "the provider went away"
                ))))
                .await;
        });
        receiver
    }
}

/// A failed turn tells its reader so in a last text chunk the live agent never
/// keeps. The log rebuilds what the live agent kept, so a session with a
/// failed turn still releases.
#[tokio::test]
async fn a_failed_turn_rebuilds_as_the_live_agent_kept_it() {
    for engine in [
        Arc::new(FailingEngine) as Arc<dyn TurnEngine>,
        Arc::new(FailingMidCallEngine),
    ] {
        failed_turn_rebuilds_identically(engine).await;
    }
}

/// The turn `engine` fails, after which the log still rebuilds what the live
/// agent kept: the failure reply never in it, and an MCP call the failure
/// left unanswered closed the way the live agent closed it.
async fn failed_turn_rebuilds_identically(engine: Arc<dyn TurnEngine>) {
    let repo = InMemoryAgentSessionRepo::new();
    let (ended_tx, mut ended) = tokio::sync::mpsc::unbounded_channel();
    let sessions = AgentSessionServiceImpl::new(
        repo.clone(),
        FoldedMessageService::new(repo.clone()),
        NoOpRealtime,
        NoOpAgentSessionNameGenerator,
        Arc::new(TurnEnds(ended_tx)),
        Arc::new(NoopLifecyclePublisher),
        ReplicaId::mint(),
    );
    let id = AgentSessionId::new();
    sessions
        .create_session(CreateAgentSessionParams {
            billing: Default::default(),
            origin: trigger_context::TriggerOrigin::Unknown,
            purpose: agent_session::domain::model::SessionPurpose::Standalone,
            repo_branch: None,
            id,
            owner_id: Owner::User(owner()),
            bot_id: BotId::TEST_A,
            thread_id: None,
            originating_message_id: None,
            model: "anthropic/claude-sonnet-5-5".to_owned(),
            harness: "macro-inmem".to_owned(),
            repo_url: None,
            workspace: "/workspace".to_owned(),
            sandbox_size: agent_session::domain::model::SandboxSize::Default,
            instructions: None,
            mcp_servers: Default::default(),
            egress_token_hash: None,
        })
        .await
        .expect("the session row should create");
    let manager = InMemAgentManager::new(
        engine,
        Arc::new(LogFrameSource::new(repo.clone())),
        Arc::new(crate::domain::mcp::NoMcpServers),
        Arc::new(crate::testing::TestModelAccess::paid()),
    );
    let transport = manager
        .attach(facts(id), None)
        .await
        .expect("the conversation starts");
    sessions
        .attach_session(id, RuntimeAttachment::solo(transport))
        .await
        .expect("the transport attaches");
    let _ = sessions
        .send_action(
            id,
            Some(owner()),
            AgentAction::prompt("fix it"),
            AgentActionId::mint(),
        )
        .await;
    assert_eq!(ended.recv().await, Some(id));
    assert!(
        logged_frames(&repo, id)
            .await
            .iter()
            .any(|frame| frame.contains(crate::domain::agent::TURN_FAILED_REPLY)),
        "the reader was told the turn failed"
    );

    let row = sessions.get_session(id).await.expect("the row reads");
    assert!(
        manager
            .rebuilds_identically(&SessionFacts {
                acp_session_id: row.acp_session_id,
                ..facts(id)
            })
            .await
            .expect("the log reads"),
        "the rebuild keeps what the live agent kept, without the failure reply"
    );
}
