use super::*;
use crate::domain::service::ForwardedCommands;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

struct RecordingHarness {
    handles_origin: bool,
    calls: AtomicUsize,
}

impl ForwardedCommands for RecordingHarness {
    async fn execute_forwarded(
        &self,
        _session_id: AgentSessionId,
        _command: HarnessCommand,
        _harness: Option<HarnessId>,
        is_origin: bool,
    ) -> Option<Result<CommandOutcome>> {
        if self.handles_origin != is_origin {
            return None;
        }
        self.calls.fetch_add(1, Ordering::SeqCst);
        Some(Ok(CommandOutcome::Completed))
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
    let origin = ReplicaId::mint();
    let peer = ReplicaId::mint();
    let origin_harness = Arc::new(RecordingHarness {
        handles_origin: false,
        calls: AtomicUsize::new(0),
    });
    let peer_harness = Arc::new(RecordingHarness {
        handles_origin: false,
        calls: AtomicUsize::new(0),
    });
    let (origin_ready, mut origin_readiness) = tokio::sync::watch::channel(false);
    let origin_consumer = tokio::spawn(consume_runtime_commands(
        redis.clone(),
        origin,
        Arc::clone(&origin_harness),
        origin_ready,
    ));
    let (peer_ready, mut peer_readiness) = tokio::sync::watch::channel(false);
    let peer_consumer = tokio::spawn(consume_runtime_commands(
        redis.clone(),
        peer,
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

    let forwarder = RedisCommandForwarder::new(redis, origin);
    let outcome = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        forwarder.forward(AgentSessionId::TEST_A, HarnessCommand::Delete, None),
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
