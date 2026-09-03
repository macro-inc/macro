use super::*;
use crate::domain::service::ForwardedCommands;
use crate::inbound::redis_commands::consume_runtime_commands;
use agent_session::domain::model::ReplicaId;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

struct RecordingHarness {
    calls: AtomicUsize,
    fails: bool,
}

impl ForwardedCommands for RecordingHarness {
    async fn execute_forwarded(
        &self,
        _session_id: AgentSessionId,
        _command: HarnessCommand,
    ) -> Result<CommandOutcome> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fails {
            return Err(HarnessError::Disconnected(_session_id));
        }
        Ok(CommandOutcome::Completed)
    }
}

fn redis_client() -> redis::Client {
    let url = macro_env_var::optional_read_env_var("REDIS_URI")
        .ok()
        .flatten()
        .unwrap_or_else(|| "redis://127.0.0.1:6379".to_owned());
    redis::Client::open(url).expect("valid Redis URL")
}

#[tokio::test]
async fn a_command_executes_on_exactly_one_responsible_replica() {
    let redis = redis_client();
    let key = macro_uuid::Uuid::new_v4().to_string();
    let origin = ReplicaId::mint();
    let peer = ReplicaId::mint();
    let origin_harness = Arc::new(RecordingHarness {
        calls: AtomicUsize::new(0),
        fails: false,
    });
    let peer_harness = Arc::new(RecordingHarness {
        calls: AtomicUsize::new(0),
        fails: false,
    });
    let (origin_ready, mut origin_readiness) = tokio::sync::watch::channel(false);
    let origin_consumer = tokio::spawn(consume_runtime_commands(
        redis.clone(),
        origin,
        key.clone(),
        Arc::new(|_| false),
        Arc::clone(&origin_harness),
        origin_ready,
    ));
    let (peer_ready, mut peer_readiness) = tokio::sync::watch::channel(false);
    let peer_consumer = tokio::spawn(consume_runtime_commands(
        redis.clone(),
        peer,
        key.clone(),
        Arc::new(|_| false),
        Arc::clone(&peer_harness),
        peer_ready,
    ));
    for readiness in [&mut origin_readiness, &mut peer_readiness] {
        tokio::time::timeout(
            std::time::Duration::from_secs(2),
            readiness.wait_for(|ready| *ready),
        )
        .await
        .expect("consumer becomes ready")
        .expect("readiness channel remains open");
    }

    let forwarder = RedisCommandForwarder::new(redis, key);
    let outcome = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        forwarder.forward(
            AgentSessionId::TEST_A,
            HarnessCommand::Delete,
            CommandTarget::Replica(peer),
        ),
    )
    .await
    .expect("command receives a response")
    .unwrap();

    assert_eq!(outcome, CommandOutcome::Completed);
    assert_eq!(origin_harness.calls.load(Ordering::SeqCst), 0);
    assert_eq!(peer_harness.calls.load(Ordering::SeqCst), 1);
    origin_consumer.abort();
    peer_consumer.abort();
}

#[tokio::test]
async fn a_responsible_replicas_error_returns_immediately() {
    let redis = redis_client();
    let key = macro_uuid::Uuid::new_v4().to_string();
    let replica = ReplicaId::mint();
    let harness = Arc::new(RecordingHarness {
        calls: AtomicUsize::new(0),
        fails: true,
    });
    let (ready, mut readiness) = tokio::sync::watch::channel(false);
    let consumer = tokio::spawn(consume_runtime_commands(
        redis.clone(),
        replica,
        key.clone(),
        Arc::new(|_| false),
        harness,
        ready,
    ));
    readiness.wait_for(|ready| *ready).await.unwrap();

    let error = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        RedisCommandForwarder::new(redis, key).forward(
            AgentSessionId::TEST_A,
            HarnessCommand::Delete,
            CommandTarget::Replica(replica),
        ),
    )
    .await
    .expect("error response is immediate")
    .expect_err("the remote command fails");

    assert!(error.to_string().contains("no longer connected"));
    consumer.abort();
}

#[tokio::test]
async fn all_replicas_declining_returns_disconnected_immediately() {
    let redis = redis_client();
    let key = macro_uuid::Uuid::new_v4().to_string();
    let replica = ReplicaId::mint();
    let harness = Arc::new(RecordingHarness {
        calls: AtomicUsize::new(0),
        fails: false,
    });
    let (ready, mut readiness) = tokio::sync::watch::channel(false);
    let consumer = tokio::spawn(consume_runtime_commands(
        redis.clone(),
        replica,
        key.clone(),
        Arc::new(|_| false),
        harness,
        ready,
    ));
    readiness.wait_for(|ready| *ready).await.unwrap();

    let error = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        RedisCommandForwarder::new(redis, key).forward(
            AgentSessionId::TEST_A,
            HarnessCommand::Delete,
            CommandTarget::Harness(HarnessId::TEST_A),
        ),
    )
    .await
    .expect("declines are immediate")
    .expect_err("no replica owns the harness");

    assert!(matches!(
        error,
        HarnessError::Disconnected(AgentSessionId::TEST_A)
    ));
    consumer.abort();
}

#[tokio::test]
async fn overlapping_harness_connections_execute_once() {
    let redis = redis_client();
    let key = macro_uuid::Uuid::new_v4().to_string();
    let first = Arc::new(RecordingHarness {
        calls: AtomicUsize::new(0),
        fails: false,
    });
    let second = Arc::new(RecordingHarness {
        calls: AtomicUsize::new(0),
        fails: false,
    });
    let (first_ready, mut first_readiness) = tokio::sync::watch::channel(false);
    let first_consumer = tokio::spawn(consume_runtime_commands(
        redis.clone(),
        ReplicaId::mint(),
        key.clone(),
        Arc::new(|harness| harness == HarnessId::TEST_A),
        Arc::clone(&first),
        first_ready,
    ));
    let (second_ready, mut second_readiness) = tokio::sync::watch::channel(false);
    let second_consumer = tokio::spawn(consume_runtime_commands(
        redis.clone(),
        ReplicaId::mint(),
        key.clone(),
        Arc::new(|harness| harness == HarnessId::TEST_A),
        Arc::clone(&second),
        second_ready,
    ));
    first_readiness.wait_for(|ready| *ready).await.unwrap();
    second_readiness.wait_for(|ready| *ready).await.unwrap();

    RedisCommandForwarder::new(redis, key)
        .forward(
            AgentSessionId::TEST_A,
            HarnessCommand::Delete,
            CommandTarget::Harness(HarnessId::TEST_A),
        )
        .await
        .unwrap();

    assert_eq!(
        first.calls.load(Ordering::SeqCst) + second.calls.load(Ordering::SeqCst),
        1
    );
    first_consumer.abort();
    second_consumer.abort();
}
