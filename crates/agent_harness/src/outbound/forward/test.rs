use super::*;
use crate::domain::service::ForwardedCommands;
use agent_runtime_protocol::domain::channel::Channel;
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Default)]
struct RecordingHarness {
    calls: AtomicUsize,
}

impl ForwardedCommands for RecordingHarness {
    async fn execute_forwarded(
        &self,
        _session_id: AgentSessionId,
        _command: HarnessCommand,
    ) -> Result<CommandOutcome> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(CommandOutcome::Completed)
    }
}

fn redis_client() -> redis::Client {
    let url = macro_env_var::optional_read_env_var("REDIS_URL")
        .ok()
        .flatten()
        .unwrap_or_else(|| "redis://127.0.0.1:6379".to_owned());
    redis::Client::open(url).expect("valid Redis URL")
}

#[tokio::test]
async fn a_runtime_command_executes_on_the_replica_with_the_socket() {
    let redis = redis_client();
    let runtimes = crate::outbound::runtime_registry::RuntimeRegistry::new();
    let (socket, _runtime) = Channel::<ToRuntimeMessage, ToServerMessage>::duplex();
    runtimes.attach(HarnessId::TEST_A, socket);
    let harness = Arc::new(RecordingHarness::default());
    let consumer = tokio::spawn(consume_runtime_commands(
        redis.clone(),
        Arc::clone(&runtimes),
        Arc::clone(&harness),
    ));
    tokio::task::yield_now().await;

    let forwarder = HttpCommandForwarder::new("unused".to_owned(), redis).unwrap();
    let outcome = forwarder
        .forward_to_runtime(
            HarnessId::TEST_A,
            AgentSessionId::TEST_A,
            HarnessCommand::Delete,
        )
        .await
        .unwrap();

    assert_eq!(outcome, CommandOutcome::Completed);
    assert_eq!(harness.calls.load(Ordering::SeqCst), 1);
    consumer.abort();
}
