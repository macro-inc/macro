//! A summary over the real session machine and log: what the model reads
//! after a restart is what it read before one.

use std::sync::atomic::{AtomicUsize, Ordering};

use tokio::sync::{Notify, mpsc};

use super::*;
use crate::domain::engine::{TurnEngine, TurnPurpose, TurnRequest};
use crate::domain::session::SUMMARY_PREAMBLE;

/// The session's model: one the catalog has no window for, so it gets the
/// 128k-token fallback, and two 30,000-token messages start a summary.
const MODEL: &str = "other-model";

/// Answers its first turn with reasoning alone and every later one with
/// "ok", and finishes a summary only once `release` is notified, so a test
/// can land it after the turns that came meanwhile.
struct ReasonsFirst {
    turns: AtomicUsize,
    reasoning: ScriptedEngine,
    replies: ScriptedEngine,
    summaries: ScriptedEngine,
    release: Arc<Notify>,
}

impl TurnEngine for ReasonsFirst {
    fn supported_models(&self) -> &[&str] {
        crate::testing::TEST_MODELS
    }

    fn run_turn(
        &self,
        request: TurnRequest,
    ) -> mpsc::Receiver<Result<StreamPart, agent::AgentError>> {
        if request.purpose == TurnPurpose::Summary {
            let release = Arc::clone(&self.release);
            let mut summary = self.summaries.run_turn(request);
            let (parts, receiver) = mpsc::channel(8);
            tokio::spawn(async move {
                release.notified().await;
                while let Some(part) = summary.recv().await {
                    if parts.send(part).await.is_err() {
                        break;
                    }
                }
            });
            return receiver;
        }
        if self.turns.fetch_add(1, Ordering::Relaxed) == 0 {
            self.reasoning.run_turn(request)
        } else {
            self.replies.run_turn(request)
        }
    }
}

/// Block until the session's log satisfies `until`.
async fn await_log(
    repo: &InMemoryAgentSessionRepo,
    id: AgentSessionId,
    what: &str,
    until: impl Fn(&[String]) -> bool,
) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        if until(&logged_frames(repo, id).await) {
            return;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "{what} never reached the log"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn answers(frames: &[String]) -> usize {
    frames
        .iter()
        .filter(|frame| frame.contains("stopReason"))
        .count()
}

/// A long message as `<letter> x<bytes>`, so an assertion reads.
fn label(message: &str) -> String {
    if message.len() > 10_000 {
        format!("{} x{}", &message[..1], message.len())
    } else {
        message.to_owned()
    }
}

/// The live agent kept a turn that only reasoned as a reply of reasoning,
/// which replay leaves out, and a summary of that turn landed after the
/// turn that followed it. Counted by entries, the rebuilt history would
/// lose that following message; named by its last turn, the summary takes
/// the place of the same turn live and after the restart.
#[tokio::test]
async fn a_restarted_manager_reads_a_summary_in_place_of_the_turns_it_covered() {
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
            purpose: agent_session::domain::model::SessionPurpose::Standalone,
            repo_branch: None,
            id,
            owner_id: Owner::User(owner()),
            bot_id: BotId::TEST_A,
            thread_id: None,
            originating_message_id: None,
            model: MODEL.to_owned(),
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
    let on_model = |acp_session_id| SessionFacts {
        model: MODEL.to_owned(),
        acp_session_id,
        ..facts(id)
    };

    let release = Arc::new(Notify::new());
    let before = InMemAgentManager::new(
        Arc::new(ReasonsFirst {
            turns: AtomicUsize::new(0),
            reasoning: ScriptedEngine::new(vec![StreamPart::Thinking("weighing it".to_owned())]),
            replies: ScriptedEngine::new(vec![StreamPart::Content("ok".to_owned())]),
            summaries: ScriptedEngine::new(vec![StreamPart::Content("SUMMARY".to_owned())]),
            release: Arc::clone(&release),
        }),
        Arc::new(LogFrameSource::new(repo.clone())),
        Arc::new(crate::domain::mcp::NoMcpServers),
        Arc::new(crate::testing::TestModelAccess::paid()),
    );
    let transport = before
        .attach(on_model(None), None)
        .await
        .expect("history should restore");
    sessions
        .attach_session(id, RuntimeAttachment::solo(transport))
        .await
        .expect("the transport should attach");

    // The fourth message, short of a long one, brings the conversation to
    // 86,000 tokens: a summary of the first two turns starts, and the
    // message runs without waiting for it.
    for (sent, text) in [
        (1, "a".repeat(150_000)),
        (2, "b".repeat(36_000)),
        (3, "c".repeat(36_000)),
        (4, "d".repeat(36_000)),
    ] {
        sessions
            .send_action(
                id,
                Some(owner()),
                AgentAction::prompt(text),
                AgentActionId::mint(),
            )
            .await
            .expect("the prompt should send");
        await_log(&repo, id, "the answer", |frames| answers(frames) == sent).await;
    }
    release.notify_one();
    await_log(&repo, id, "the summary", |frames| {
        frames
            .iter()
            .any(|frame| frame.contains("_macro/context_summary"))
    })
    .await;

    // Restart: the next process rebuilds the conversation from the log.
    drop(before);
    let engine = Arc::new(ScriptedEngine::new(vec![StreamPart::Content(
        "ok".to_owned(),
    )]));
    let after = manager(&repo, Arc::clone(&engine));
    let row = sessions
        .get_session(id)
        .await
        .expect("the session row should read");
    attach_retrying(&sessions, id, &after, on_model(row.acp_session_id)).await;
    sessions
        .send_action(
            id,
            Some(owner()),
            AgentAction::prompt("after the restart"),
            AgentActionId::mint(),
        )
        .await
        .expect("the prompt should send on the resumed session");
    await_turns(&engine, "after the restart").await;

    let read: Vec<String> = engine.requests()[0]
        .messages
        .iter()
        .map(|message| label(without_invocation_context(message)))
        .collect();
    assert_eq!(
        read,
        [
            SUMMARY_PREAMBLE,
            "SUMMARY",
            "c x36000",
            "ok",
            "d x36000",
            "ok",
            "after the restart"
        ]
    );
}
