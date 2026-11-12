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

/// A session the worker could not release at its idle timeout used to lose
/// its worker anyway, and with it every later try: it was held until its next
/// command, which for most sessions never comes. The worker now stays and
/// tries again, backing off, because each try reads and replays the log.
#[tokio::test]
async fn a_session_kept_at_its_idle_timeout_is_tried_again_until_it_releases() {
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
    // What the runtime gauges read (`ahs.harness.workers`,
    // `ahs.harness.hydrated`, `ahs.agent_session.active`).
    assert_eq!(service.command_workers(), 1);
    assert_eq!(service.hydrated_sessions(), 1);
    assert_eq!(service.inner.sessions.active_sessions(), 1);

    tokio::time::pause();
    let idle_since = tokio::time::Instant::now();
    let patience = WORKER_IDLE_TIMEOUT * 40;
    for (tries, after) in [(1, 1), (2, 3), (3, 7), (4, 23)] {
        tokio::time::timeout(patience, containers.wait_for_lossless_checks(id, tries))
            .await
            .expect("the worker tries again");
        let waited = idle_since.elapsed();
        assert!(
            waited >= WORKER_IDLE_TIMEOUT * after
                && waited < WORKER_IDLE_TIMEOUT * after + Duration::from_secs(60),
            "try {tries} comes {after} idle timeouts in, not {waited:?}"
        );
        assert_eq!(
            service.command_workers(),
            1,
            "the worker of a session still held stays to try again"
        );
        assert!(containers.released().is_empty());
    }

    containers.allow_release(id);
    tokio::time::timeout(patience, containers.wait_for_release(id))
        .await
        .expect("the next try releases it");
    let waited = idle_since.elapsed();
    assert!(
        waited >= WORKER_IDLE_TIMEOUT * 39
            && waited < WORKER_IDLE_TIMEOUT * 39 + Duration::from_secs(60),
        "tries settle at sixteen idle timeouts apart, not {waited:?}"
    );
    // On the paused clock this returns only once every task is idle, the
    // worker included.
    tokio::time::sleep(Duration::from_secs(1)).await;
    tokio::time::resume();

    assert_eq!(
        service.command_workers(),
        0,
        "the worker retires once nothing is held"
    );
    assert_eq!(
        service.hydrated_sessions(),
        0,
        "its queue copy is forgotten"
    );
    assert_eq!(
        service.inner.sessions.active_sessions(),
        0,
        "its actor is gone"
    );
    assert!(
        service.inner.sessions.attached_mcp_servers(id).is_none(),
        "its actor is closed"
    );
}

/// With the kill switch on for the session's owner, a release that kept the
/// session is not tried again: its worker retires after the one try, as
/// before retries existed, and the session stays held until its next command.
#[tokio::test]
async fn with_the_kill_switch_on_a_kept_session_is_tried_once_and_its_worker_retires() {
    let mut flags = feature_flags::outbound::fake::FakeFeatureFlags::default();
    flags.set(
        sender(),
        Ok(feature_flags::FlagSnapshot::new([(
            crate::domain::service::IDLE_RELEASE_NO_RETRY_FLAG.to_owned(),
            feature_flags::FlagValue::Boolean(true),
        )])),
    );
    let ((service, repo, containers, _announcer, _runtimes), mut signals) =
        harness_with_journal_and_policy(
            PromptContextMock::default(),
            PromptComposerMock::default(),
            KindDefaultPolicies,
            HarnessDefaultCodingAgents,
            PromptMentionsMock::new(),
            EgressProvisionerMock::new(),
            None,
            None,
            None,
            Some(flags),
        );
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
    tokio::time::timeout(
        WORKER_IDLE_TIMEOUT * 2,
        containers.wait_for_lossless_checks(id, 1),
    )
    .await
    .expect("the worker tries once");
    tokio::time::sleep(WORKER_IDLE_TIMEOUT * 40).await;
    tokio::time::resume();

    assert_eq!(service.command_workers(), 0, "its worker retires");
    assert_eq!(containers.lossless_checks(id), 1, "nothing tries again");
    assert!(containers.released().is_empty());
    assert_eq!(
        service.inner.sessions.active_sessions(),
        1,
        "the session stays held"
    );
}

/// Every field of the idle release's span is exported once
/// (`rust-span-field-recorded-once`); every release read `released=false`
/// before.
#[tokio::test]
async fn each_idle_release_span_field_is_exported_once() {
    let (exporter, provider, _guard) = span_exporter();
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
    let patience = WORKER_IDLE_TIMEOUT * 10;
    tokio::time::timeout(patience, containers.wait_for_lossless_checks(id, 1))
        .await
        .expect("the first try runs");
    containers.allow_release(id);
    tokio::time::timeout(patience, containers.wait_for_release(id))
        .await
        .expect("the next try releases it");
    tokio::time::sleep(Duration::from_secs(1)).await;
    tokio::time::resume();

    provider.force_flush().expect("the spans flush");
    let spans: Vec<_> = exporter
        .get_finished_spans()
        .expect("finished spans")
        .into_iter()
        .filter(|span| span.name == "agent.session.idle_release")
        .collect();
    let exported: Vec<Vec<(String, String)>> = spans
        .iter()
        .map(|span| {
            span.attributes
                .iter()
                .filter(|kv| kv.key.as_str().starts_with("agent.session.idle_release."))
                .map(|kv| (kv.key.to_string(), kv.value.to_string()))
                .collect()
        })
        .collect();
    let field = |name: &str, value: &str| {
        (
            format!("agent.session.idle_release.{name}"),
            value.to_owned(),
        )
    };
    assert_eq!(
        exported,
        vec![
            vec![
                field("attempt", "0"),
                field("quiet", "true"),
                field("lossless", "false"),
                field("closed_actor", "false"),
                field("released", "false"),
                field("outcome", "not_lossless"),
            ],
            vec![
                field("attempt", "1"),
                field("quiet", "true"),
                field("lossless", "true"),
                field("closed_actor", "true"),
                field("released", "true"),
                field("outcome", "released"),
            ],
        ],
        "each try's fields, each once"
    );
}

/// A try that finds a turn still running replays nothing, so it is not what
/// the backoff is for: the worker tries again at the plain timeout for as
/// long as the turn runs, and the session is released soon after it ends.
#[tokio::test]
async fn a_session_kept_for_a_running_turn_is_tried_again_at_the_plain_timeout() {
    let (exporter, provider, _guard) = span_exporter();
    let (service, repo, containers, _announcer, _runtimes) = harness();
    let id = disconnected_in_memory_session(&repo, &containers).await;
    let container = {
        let (prompted, container) = tokio::join!(
            service.execute(id, HarnessCommand::Deliver(forward_message("long task"))),
            async {
                let container = containers.wait_for_resumes(id, 1).await;
                resume_and_hold_the_prompt(&container).await;
                container
            },
        );
        prompted.expect("the prompt is on the wire");
        container
    };

    tokio::time::pause();
    tokio::time::sleep(WORKER_IDLE_TIMEOUT * 24 + Duration::from_secs(1)).await;
    provider.force_flush().expect("the spans flush");
    let tries: Vec<String> = exporter
        .get_finished_spans()
        .expect("finished spans")
        .into_iter()
        .filter(|span| span.name == "agent.session.idle_release")
        .filter_map(|span| {
            span.attributes
                .iter()
                .find(|kv| kv.key.as_str() == "agent.session.idle_release.outcome")
                .map(|kv| kv.value.to_string())
        })
        .collect();
    assert_eq!(
        tries,
        vec!["not_quiet".to_owned(); 24],
        "one try every idle timeout while the turn runs"
    );
    assert!(
        containers.released().is_empty(),
        "the turn is still running"
    );

    container.agent().completes_prompt().await;
    tokio::time::timeout(WORKER_IDLE_TIMEOUT * 2, containers.wait_for_release(id))
        .await
        .expect("a try after the turn ends releases it");
    tokio::time::sleep(Duration::from_secs(1)).await;
    tokio::time::resume();

    assert_eq!(service.command_workers(), 0, "its worker retires");
}

/// A session whose row was deleted elsewhere while this process still held
/// it has nothing left to keep: the worker drops what is held and retires,
/// rather than failing to read the row on every try for the life of the
/// process.
#[tokio::test]
async fn a_session_whose_row_is_gone_is_released() {
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
    assert!(service.inner.sessions.attached_mcp_servers(id).is_some());

    agent_session::domain::ports::AgentSessionRepo::delete(&repo, id)
        .await
        .expect("the row is deleted");

    tokio::time::pause();
    tokio::time::timeout(WORKER_IDLE_TIMEOUT * 2, containers.wait_for_release(id))
        .await
        .expect("the idle session is released");
    tokio::time::sleep(Duration::from_secs(1)).await;
    tokio::time::resume();

    assert_eq!(service.command_workers(), 0, "its worker retires");
    assert!(
        service.inner.sessions.attached_mcp_servers(id).is_none(),
        "its actor is closed"
    );
    assert_eq!(service.inner.sessions.active_sessions(), 0);
}

#[tokio::test]
async fn a_kill_switch_aimed_at_dev_leaves_prod_retrying_for_the_same_owner() {
    use feature_flags::outbound::posthog::PostHogFeatureFlags;
    use macro_env::Environment;
    use wiremock::matchers::body_partial_json;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use crate::domain::service::IDLE_RELEASE_NO_RETRY_FLAG;
    use crate::domain::service::idle::{FlaggedIdleReleaseRetry, IdleReleaseRetry as _};

    let server = MockServer::start().await;
    // PostHog's side: the switch targets the person property `environment = dev`.
    Mock::given(body_partial_json(serde_json::json!({
        "distinct_id": sender().as_ref(),
        "person_properties": {"environment": "dev"},
    })))
    .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
        "flags": {IDLE_RELEASE_NO_RETRY_FLAG: {"key": IDLE_RELEASE_NO_RETRY_FLAG, "enabled": true}},
        "errorsWhileComputingFlags": false,
    })))
    .with_priority(1)
    .mount(&server)
    .await;
    Mock::given(wiremock::matchers::method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "flags": {IDLE_RELEASE_NO_RETRY_FLAG: {"key": IDLE_RELEASE_NO_RETRY_FLAG, "enabled": false}},
            "errorsWhileComputingFlags": false,
        })))
        .mount(&server)
        .await;
    let in_environment = |environment| {
        FlaggedIdleReleaseRetry(
            PostHogFeatureFlags::new(
                &server.uri(),
                "test-project-key".into(),
                Duration::from_secs(2),
                environment,
            )
            .unwrap(),
        )
    };

    assert!(
        in_environment(Environment::Production)
            .retries(&sender())
            .await
    );
    assert!(
        !in_environment(Environment::Develop)
            .retries(&sender())
            .await
    );
}
