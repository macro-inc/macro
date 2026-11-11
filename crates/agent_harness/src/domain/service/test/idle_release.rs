//! An in-process session nobody has used for a while gives back what this
//! process holds for it: its actor and its runtime state. Its next prompt
//! resumes it from the durable log, as after a restart.

use std::time::Duration;

use agent_session::domain::ports::{AgentSessionLogRepo as _, SessionOwnership as _};

use super::*;
use crate::domain::service::queue::WORKER_IDLE_TIMEOUT;

/// Play the agent's half of a resume up to the prompt, leaving that prompt's
/// turn running.
async fn resume_and_hold_the_prompt(container: &ContainerMock) {
    let agent = container.agent();
    container.sends_ready();
    agent.wait_for_requests(1).await;
    agent.completes_initialize(
        InitializeResponse::new(PROTOCOL_VERSION).agent_capabilities(
            AgentCapabilities::new().session_capabilities(
                SessionCapabilities::new().resume(SessionResumeCapabilities::new()),
            ),
        ),
    );
    agent.wait_for_requests(2).await;
    agent.resumes_session(ResumeSessionResponse::new());
    agent.wait_for_requests(3).await;
}

#[tokio::test]
async fn an_idle_in_process_session_is_released_and_its_next_prompt_resumes_it() {
    let ((service, repo, containers, _announcer, _runtimes), mut signals) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = disconnected_in_memory_session(&repo, &containers).await;
    let (prompted, ()) = tokio::join!(
        service.execute(id, HarnessCommand::Deliver(forward_message("first"))),
        async {
            complete_resume(&containers.wait_for_resumes(id, 1).await).await;
        },
    );
    prompted.expect("the first prompt resumes the session and runs");
    signals.settled(id).await;
    assert!(service.inner.sessions.attached_mcp_servers(id).is_some());
    let lifecycle = signals.lifecycle();
    let frames = repo.list_by_session(id).await.expect("the log reads").len();
    let row = repo.get(id).await.expect("the row reads");
    let turn_state = repo.turn_state(id);

    tokio::time::pause();
    tokio::time::timeout(WORKER_IDLE_TIMEOUT * 2, containers.wait_for_release(id))
        .await
        .expect("the idle session is released");
    tokio::time::resume();

    assert_eq!(containers.released(), vec![id]);
    assert!(
        service.inner.sessions.attached_mcp_servers(id).is_none(),
        "the session's actor is closed"
    );
    // Nobody outside this process can tell: no lifecycle event (so no
    // `agent_session.stopped` webhook), nothing in the log, and the state the
    // app shows is as it was.
    assert_eq!(signals.lifecycle(), lifecycle);
    assert_eq!(
        repo.list_by_session(id).await.expect("the log reads").len(),
        frames,
        "the release writes no frame"
    );
    let released = repo.get(id).await.expect("the row reads");
    assert_eq!(released.status, row.status);
    assert_eq!(released.modified_at, row.modified_at);
    assert_eq!(repo.turn_state(id), turn_state);

    let (prompted, resumed) = tokio::join!(
        service.execute(
            id,
            HarnessCommand::Deliver(forward_message("after a while"))
        ),
        async {
            let resumed = containers.wait_for_resumes(id, 2).await;
            complete_resume(&resumed).await;
            resumed
        },
    );
    prompted.expect("the next prompt resumes the released session");
    assert_eq!(containers.resumed(), 2);
    assert!(
        !signals
            .lifecycle()
            .iter()
            .any(|event| matches!(event, AgentSessionLifecycleEvent::Stopped(_))),
        "nothing ever says the session stopped"
    );
    assert_eq!(
        prompts(&resumed.agent()),
        vec![vec![ContentBlock::from(context_prompt("after a while"))]],
        "the resumed runtime gets the new prompt, once"
    );
}

#[tokio::test]
async fn a_session_with_a_turn_running_and_a_prompt_queued_is_never_released() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    let id = disconnected_in_memory_session(&repo, &containers).await;
    let (prompted, ()) = tokio::join!(
        service.execute(id, HarnessCommand::Deliver(forward_message("long task"))),
        async {
            resume_and_hold_the_prompt(&containers.wait_for_resumes(id, 1).await).await;
        },
    );
    prompted.expect("the first prompt is on the wire");
    service
        .execute(id, HarnessCommand::Deliver(forward_message("next")))
        .await
        .expect("the second prompt queues behind the running turn");
    assert_eq!(service.inner.queues.list(id).len(), 1);

    tokio::time::pause();
    tokio::time::sleep(WORKER_IDLE_TIMEOUT * 3).await;
    tokio::time::resume();

    assert!(containers.released().is_empty());
    assert!(service.inner.sessions.attached_mcp_servers(id).is_some());
    assert_eq!(service.inner.queues.list(id).len(), 1, "the queue is kept");

    // The actor refuses on its own too: its turn is still on the wire.
    let frames = repo.list_by_session(id).await.expect("the log reads").len();
    assert_eq!(
        service
            .inner
            .sessions
            .release_session(id)
            .await
            .expect("the actor answers"),
        agent_session::domain::model::SessionRelease::Busy
    );
    assert!(service.inner.sessions.attached_mcp_servers(id).is_some());
    assert_eq!(
        repo.list_by_session(id).await.expect("the log reads").len(),
        frames
    );
}

/// A replica that took the session over holds its lease under a newer fence.
/// Closing this replica's stale actor gives back only this replica's claim.
#[tokio::test]
async fn releasing_a_session_another_replica_took_over_keeps_that_replicas_lease() {
    let ((service, repo, containers, _announcer, _runtimes), mut signals) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = disconnected_in_memory_session(&repo, &containers).await;
    let (prompted, ()) = tokio::join!(
        service.execute(id, HarnessCommand::Deliver(forward_message("first"))),
        async {
            complete_resume(&containers.wait_for_resumes(id, 1).await).await;
        },
    );
    prompted.expect("the first prompt runs here");
    signals.settled(id).await;

    // This replica starts draining and a peer takes the session over.
    repo.begin_draining(service.inner.sessions.replica_id())
        .await
        .expect("this replica drains");
    let peer = claim_as_peer(&repo, id).await;
    let lifecycle = signals.lifecycle();
    let frames = repo.list_by_session(id).await.expect("the log reads").len();

    tokio::time::pause();
    tokio::time::timeout(WORKER_IDLE_TIMEOUT * 2, containers.wait_for_release(id))
        .await
        .expect("the idle session is released");
    tokio::time::resume();

    let lease = repo
        .lease_view(id, peer.replica)
        .await
        .expect("the lease reads");
    assert_eq!(
        lease.holder.map(|holder| holder.replica),
        Some(peer.replica),
        "the peer still manages the session"
    );
    // Nothing that would reach the peer's viewers or its held tool calls.
    assert_eq!(signals.lifecycle(), lifecycle);
    assert_eq!(
        repo.list_by_session(id).await.expect("the log reads").len(),
        frames
    );
}

#[tokio::test]
async fn a_session_whose_rebuild_would_differ_is_never_released() {
    let ((service, repo, containers, _announcer, _runtimes), mut signals) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = disconnected_in_memory_session(&repo, &containers).await;
    let (prompted, ()) = tokio::join!(
        service.execute(id, HarnessCommand::Deliver(forward_message("first"))),
        async {
            complete_resume(&containers.wait_for_resumes(id, 1).await).await;
        },
    );
    prompted.expect("the first prompt runs");
    signals.settled(id).await;
    containers.keep_on_release(id);

    tokio::time::pause();
    tokio::time::sleep(WORKER_IDLE_TIMEOUT * 3).await;
    tokio::time::resume();

    assert!(containers.released().is_empty());
    assert!(
        service.inner.sessions.attached_mcp_servers(id).is_some(),
        "its actor keeps running"
    );
}

#[tokio::test]
async fn a_session_another_replica_manages_is_left_alone() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    let id = disconnected_in_memory_session(&repo, &containers).await;
    let peer = claim_as_peer(&repo, id).await;
    // Whatever this process still holds for it is behind the peer's log.
    containers.keep_on_release(id);
    let _ = service
        .execute(id, HarnessCommand::Deliver(forward_message("for the peer")))
        .await;
    assert_eq!(service.command_workers(), 1);

    tokio::time::pause();
    tokio::time::sleep(WORKER_IDLE_TIMEOUT + Duration::from_secs(1)).await;
    tokio::time::resume();

    assert_eq!(service.command_workers(), 0, "this replica's worker exits");
    assert_eq!(
        containers.released(),
        vec![id],
        "the copy left behind is dropped"
    );
    assert_eq!(
        containers.resumed(),
        0,
        "nothing here resumed or rotated it"
    );
    assert!(
        repo.list_by_session(id)
            .await
            .expect("the log reads")
            .is_empty(),
        "nothing was written to its log"
    );
    let lease = repo
        .lease_view(id, peer.replica)
        .await
        .expect("the lease reads");
    assert_eq!(
        lease.holder.map(|holder| holder.replica),
        Some(peer.replica)
    );
}
