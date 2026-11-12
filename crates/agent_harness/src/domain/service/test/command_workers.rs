//! A session's command worker lives only while it has work: it exits after
//! sitting idle, and with the session it deletes.

use std::time::Duration;

use super::*;
use crate::domain::service::queue::WORKER_IDLE_TIMEOUT;

#[tokio::test]
async fn an_idle_command_worker_exits_and_the_next_command_starts_a_new_one() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    let id = disconnected_session(&repo, &containers).await;

    service
        .execute(
            id,
            HarnessCommand::SessionStopped {
                reason: "first".to_owned(),
            },
        )
        .await
        .expect("the first command runs");
    assert_eq!(service.command_workers(), 1);

    tokio::time::pause();
    tokio::time::sleep(WORKER_IDLE_TIMEOUT + Duration::from_secs(1)).await;
    assert_eq!(service.command_workers(), 0, "the idle worker exited");

    service
        .execute(
            id,
            HarnessCommand::SessionStopped {
                reason: "second".to_owned(),
            },
        )
        .await
        .expect("a command after the exit runs on a new worker");
    assert_eq!(service.command_workers(), 1);
}

#[tokio::test]
async fn a_worker_busy_inside_its_idle_window_does_not_exit() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    let id = disconnected_session(&repo, &containers).await;
    service
        .execute(
            id,
            HarnessCommand::SessionStopped {
                reason: "first".to_owned(),
            },
        )
        .await
        .expect("the first command runs");

    tokio::time::pause();
    tokio::time::sleep(WORKER_IDLE_TIMEOUT - Duration::from_secs(1)).await;
    service
        .execute(
            id,
            HarnessCommand::SessionStopped {
                reason: "second".to_owned(),
            },
        )
        .await
        .expect("the second command runs");
    tokio::time::sleep(Duration::from_secs(2)).await;

    assert_eq!(
        service.command_workers(),
        1,
        "the second command restarted the idle window"
    );
}

#[tokio::test]
async fn deleting_a_session_removes_its_command_worker() {
    let (service, repo, containers, _announcer, _runtimes) = harness();
    let id = disconnected_session(&repo, &containers).await;

    service
        .execute(id, HarnessCommand::Delete)
        .await
        .expect("the delete succeeds");

    assert_eq!(service.command_workers(), 0);
}

/// The race the exit has to win: a command sent at the instant the idle
/// timeout fires. Whichever happens first under the entry's lock decides it,
/// and neither order drops the command.
#[tokio::test]
async fn a_command_sent_as_the_worker_retires_is_never_lost() {
    use crate::domain::service::queue::{QueuedCommand, SessionWorkers, retire_worker};

    let workers = SessionWorkers::new();
    let id = AgentSessionId::new();
    let (commands, mut receiver) = mpsc::unbounded_channel();
    let own = commands.downgrade();
    workers.insert(id, commands);

    // The command is in the channel when the worker tries to leave.
    let (completed, _result) = tokio::sync::oneshot::channel();
    workers
        .get(&id)
        .expect("the worker is registered")
        .send(QueuedCommand {
            command: HarnessCommand::Delete,
            completed,
            span: tracing::Span::none(),
            route: false,
        })
        .unwrap_or_else(|_| panic!("the worker's channel is open"));
    assert!(
        !retire_worker(&workers, id, &own, &receiver),
        "a worker with a command waiting stays"
    );
    assert!(workers.contains_key(&id));
    assert!(
        matches!(
            receiver.recv().await,
            Some(QueuedCommand {
                command: HarnessCommand::Delete,
                ..
            })
        ),
        "and still runs it"
    );

    // Nothing waiting: the worker leaves, and its entry with it, so the next
    // command finds no channel to strand itself in.
    assert!(retire_worker(&workers, id, &own, &receiver));
    assert!(!workers.contains_key(&id));
}

#[tokio::test]
async fn a_worker_never_retires_an_entry_that_is_not_its_own() {
    use crate::domain::service::queue::{SessionWorkers, retire_worker};

    let workers = SessionWorkers::new();
    let id = AgentSessionId::new();
    let (old, old_receiver) = mpsc::unbounded_channel();
    let own = old.downgrade();
    let (replacement, _replacement_receiver) = mpsc::unbounded_channel();
    workers.insert(id, replacement);

    assert!(!retire_worker(&workers, id, &own, &old_receiver));
    assert!(workers.contains_key(&id), "the newer worker's entry stays");
    drop(old);
}

#[tokio::test]
async fn a_host_set_idle_timeout_retires_workers_on_its_schedule() {
    let repo = InMemoryAgentSessionRepo::new();
    let id = AgentSessionId::new();
    repo.insert_session(agent_session::testing::test_agent_session(id));
    let service = harness_sharing_repo(repo).with_worker_idle_timeout(Duration::from_secs(60));
    service
        .execute_here(
            id,
            HarnessCommand::SessionStopped {
                reason: "first".to_owned(),
            },
        )
        .await
        .expect("the command runs");

    tokio::time::pause();
    tokio::time::sleep(Duration::from_secs(59)).await;
    assert_eq!(service.command_workers(), 1, "still inside the window");
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert_eq!(service.command_workers(), 0, "retired after 60 seconds");
}
