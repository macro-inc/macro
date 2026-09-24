//! A chat agent's mention is answered in its thread by one message: posted
//! as a pending reply when the turn is announced, resolved into the answer
//! when that turn ends. The announcer is a recorder here, so what is checked
//! is what the domain asked of it and when.

use super::*;
use crate::domain::model::{ReplyOutcome, ResolvedReply};
use crate::domain::notifications::PlannedNotification;

/// A mention of a bot whose sessions the in-memory runtime serves.
fn chat_open_command() -> OpenSession {
    let mut command = open_command();
    command.runtime.kind = AgentKind::InMemory;
    command.runtime.harness = "macro-inmem".to_owned();
    command
}

/// Open a chat session and leave its first turn running.
async fn chat_session_with_a_running_turn(
    service: &TestHarness,
    containers: &MockContainerManager,
    id: AgentSessionId,
) -> ContainerMock {
    let open = service.execute(id, HarnessCommand::Open(chat_open_command()));
    let drive = async {
        loop {
            if containers.spawned() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let container = containers
            .container(session_of(containers))
            .expect("the spawned container is findable");
        complete_session_handshake(&container).await;
        // initialize, session/new, and the opening prompt.
        container.agent().wait_for_requests(3).await;
        container
    };
    let (opened, container) = tokio::join!(open, drive);
    opened.expect("the chat session opens");
    container
}

/// The agent streams one text part of its answer.
fn says(agent: &FakeAgent, text: &str) {
    agent.sends_raw(
        RawJsonRpcMessage::notification(
            "session/update".to_owned(),
            serde_json::json!({
                "sessionId": "acp-test",
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {"type": "text", "text": text}
                }
            }),
        )
        .expect("notification params are an object"),
    );
}

fn one_resolved(announcer: &AnnouncerMock) -> ResolvedReply {
    match announcer.resolved().as_slice() {
        [resolved] => resolved.clone(),
        other => panic!("expected exactly one resolved reply, got {other:#?}"),
    }
}

#[tokio::test]
async fn a_chat_mention_is_announced_as_a_pending_reply_and_resolved_with_the_answer() {
    let ((service, _, containers, announcer, _), turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = chat_session_with_a_running_turn(&service, &containers, id).await;
    let agent = container.agent();

    says(&agent, "Hello there.");
    agent.completes_prompt().await;
    // Opened, TurnStarted, TurnEnded, Settled: the reply resolves before
    // the turn's end is published, so once it is, the resolve has happened.
    turns.lifecycle_published(4).await;

    let announced = announcer.announced();
    assert_eq!(announced.len(), 1);
    assert_eq!(announced[0].kind, AgentKind::InMemory);
    let pending = announcer.announced_messages()[0];
    let resolved = one_resolved(&announcer);
    assert_eq!(resolved.kind, AgentKind::InMemory);
    assert_eq!(resolved.message_id, pending.message_id);
    // The same bot, into the same parent, for the same person who asked.
    assert_eq!(resolved.bot_id, announced[0].bot_id);
    assert_eq!(resolved.origin_parent, announced[0].origin_parent);
    assert_eq!(resolved.triggered_by, sender());
    assert_eq!(
        resolved.outcome,
        ReplyOutcome::Answered("Hello there.".to_owned())
    );
}

/// The patched reply notifies the thread as a post, so `settled` on top
/// would tell the same people twice.
#[tokio::test]
async fn a_chat_turn_settles_without_a_settled_notification() {
    let ((service, _, containers, _, _), turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = chat_session_with_a_running_turn(&service, &containers, id).await;

    says(&container.agent(), "Hello there.");
    container.agent().completes_prompt().await;
    turns.lifecycle_published(4).await;

    assert!(
        matches!(
            turns.lifecycle().last(),
            Some(AgentSessionLifecycleEvent::Settled(_))
        ),
        "the fact is still published: {:#?}",
        turns.lifecycle()
    );
    assert!(
        turns.notifier.notified().is_empty(),
        "nobody is notified twice: {:#?}",
        turns.notifier.notified()
    );
}

#[tokio::test]
async fn a_silent_chat_turn_resolves_as_empty_rather_than_spinning() {
    let ((service, _, containers, announcer, _), turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = chat_session_with_a_running_turn(&service, &containers, id).await;

    container.agent().completes_prompt().await;
    turns.lifecycle_published(4).await;

    assert_eq!(one_resolved(&announcer).outcome, ReplyOutcome::Empty);
}

#[tokio::test]
async fn a_chat_session_that_dies_mid_turn_resolves_its_reply_as_failed() {
    let ((service, _, containers, announcer, _), turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = chat_session_with_a_running_turn(&service, &containers, id).await;

    container.disconnects();
    // Opened, TurnStarted, Stopped - and no TurnEnded to resolve on.
    turns.lifecycle_published(3).await;

    assert!(
        matches!(
            turns.lifecycle().last(),
            Some(AgentSessionLifecycleEvent::Stopped(_))
        ),
        "{:#?}",
        turns.lifecycle()
    );
    let resolved = one_resolved(&announcer);
    assert_eq!(resolved.outcome, ReplyOutcome::Failed);
    assert_eq!(
        resolved.message_id,
        announcer.announced_messages()[0].message_id
    );
}

/// Two mentions in quick succession are two messages, each resolved when
/// its own turn ends - not both when the queue finally drains.
#[tokio::test]
async fn each_turns_reply_resolves_when_that_turn_ends() {
    let ((service, _, containers, announcer, _), turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = chat_session_with_a_running_turn(&service, &containers, id).await;
    let agent = container.agent();

    // A channel follow-up on a running turn steers: it is announced at once
    // and cancels the turn in progress.
    let outcome = service
        .execute(
            id,
            HarnessCommand::Deliver(forward_message("actually, this")),
        )
        .await
        .expect("the follow-up is accepted");
    assert_eq!(outcome, CommandOutcome::Queued);
    assert_eq!(
        announcer.announced().len(),
        2,
        "both mentions have a message"
    );
    assert!(announcer.resolved().is_empty(), "nothing has ended yet");

    // The first turn ends: only its reply resolves, and the second dispatches.
    says(&agent, "First answer.");
    agent.completes_prompt().await;
    // Opened, TurnStarted, TurnEnded (first), TurnStarted (second).
    turns.lifecycle_published(4).await;
    let messages = announcer.announced_messages();
    let resolved = announcer.resolved();
    assert_eq!(resolved.len(), 1, "{resolved:#?}");
    assert_eq!(resolved[0].message_id, messages[0].message_id);
    assert_eq!(
        resolved[0].outcome,
        ReplyOutcome::Answered("First answer.".to_owned())
    );

    says(&agent, "Second answer.");
    agent.completes_prompt().await;
    turns.lifecycle_published(6).await;
    let resolved = announcer.resolved();
    assert_eq!(resolved.len(), 2, "{resolved:#?}");
    assert_eq!(resolved[1].message_id, messages[1].message_id);
    assert_eq!(resolved[1].triggered_by, staff_sender());
    assert_eq!(
        resolved[1].outcome,
        ReplyOutcome::Answered("Second answer.".to_owned())
    );
}

/// The domain does not know a coding kind has nothing to patch - that is the
/// announcer's call - so it asks for every announced turn, naming the kind,
/// and the audience still hears `settled` for a coder.
#[tokio::test]
async fn a_coding_turn_is_offered_to_the_announcer_as_a_coder_and_still_notifies() {
    let ((service, _, containers, announcer, _), turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = live_sandboxed_coder_session(&service, &containers, id).await;
    drop(container);
    turns.lifecycle_published(4).await;

    let resolved = one_resolved(&announcer);
    assert_eq!(resolved.kind, AgentKind::SandboxedCoder);
    assert_eq!(
        resolved.message_id,
        announcer.announced_messages()[0].message_id
    );
    assert!(
        matches!(
            turns.notifier.notified().as_slice(),
            [PlannedNotification::Settled(_)]
        ),
        "{:#?}",
        turns.notifier.notified()
    );
}

/// A question the agent asks through ACP is held for the session view; the
/// thread's spinner has no way of knowing that on its own.
mod elicitation {
    use super::*;
    use agent_client_protocol::schema::v1::{
        CreateElicitationRequest, ElicitationFormMode, ElicitationSchema, ElicitationSessionScope,
        RequestId,
    };
    use agent_runtime_protocol::domain::action::{ElicitationAnswer, ElicitationRequestId};

    fn ask(agent: &FakeAgent, request_id: i64, question: &str) {
        let request = CreateElicitationRequest::new(
            ElicitationFormMode::new(
                ElicitationSessionScope::new(SessionId::new("acp-test")),
                ElicitationSchema::new(),
            ),
            question,
        );
        let (method, params) = request
            .to_untyped_message()
            .expect("an elicitation serializes")
            .into_parts();
        agent.sends_raw(
            RawJsonRpcMessage::request(method, params, RequestId::Number(request_id))
                .expect("elicitation params are an object"),
        );
    }

    /// Raised: the reply says it is waiting and what for. Cleared: the reply
    /// is pending again. Ended: the reply is the answer. One message, three
    /// patches, and no `waiting_for_input` notification on top of the first -
    /// the patch already told the thread.
    #[tokio::test]
    async fn a_question_is_told_in_the_thread_and_withdrawn_when_answered() {
        let ((service, _, containers, announcer, _), turns) =
            harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
        let id = AgentSessionId::new();
        let container = chat_session_with_a_running_turn(&service, &containers, id).await;
        let agent = container.agent();
        let pending = announcer.announced_messages()[0].message_id;

        ask(&agent, 7, "Which inbox should I send from?");
        // Opened, TurnStarted, WaitingForInput.
        turns.lifecycle_published(3).await;
        let resolved = announcer.resolved();
        assert_eq!(resolved.len(), 1, "{resolved:#?}");
        assert_eq!(resolved[0].message_id, pending);
        assert_eq!(resolved[0].session_id, id);
        assert_eq!(
            resolved[0].outcome,
            ReplyOutcome::NeedsInput {
                question: "Which inbox should I send from?".to_owned(),
            }
        );
        assert!(
            turns.notifier.notified().is_empty(),
            "the patch is the notification: {:#?}",
            turns.notifier.notified()
        );

        service
            .execute(
                id,
                HarnessCommand::Deliver(DeliverAction::control(ControlEvent {
                    action: AgentAction::respond_elicitation(
                        ElicitationRequestId::Number(7),
                        ElicitationAnswer::Decline,
                    ),
                    action_id: None,
                    actor: Some(sender()),
                })),
            )
            .await
            .expect("the answer is delivered");
        // InputReceived.
        turns.lifecycle_published(4).await;
        let resolved = announcer.resolved();
        assert_eq!(resolved.len(), 2, "{resolved:#?}");
        assert_eq!(resolved[1].message_id, pending);
        assert_eq!(resolved[1].outcome, ReplyOutcome::Resumed);

        says(&agent, "Sent from your primary inbox.");
        agent.completes_prompt().await;
        // TurnEnded, Settled.
        turns.lifecycle_published(6).await;
        let resolved = announcer.resolved();
        assert_eq!(resolved.len(), 3, "{resolved:#?}");
        assert_eq!(resolved[2].message_id, pending);
        assert_eq!(
            resolved[2].outcome,
            ReplyOutcome::Answered("Sent from your primary inbox.".to_owned())
        );
    }
}
