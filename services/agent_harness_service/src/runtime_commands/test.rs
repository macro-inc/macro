use super::*;
use agent_harness::domain::error::{HarnessError, Result};
use agent_harness::domain::model::{CommandOutcome, HarnessCommand};
use agent_harness::domain::ports::{CommandForwarder as _, CommandTarget};
use agent_harness::outbound::forward::RedisCommandForwarder;
use agent_session::domain::model::AgentSessionId;
use std::sync::atomic::{AtomicUsize, Ordering};

struct RecordingHarness {
    calls: AtomicUsize,
    fails: bool,
}

impl ForwardedCommands for RecordingHarness {
    async fn execute_forwarded(
        &self,
        session_id: AgentSessionId,
        _command: HarnessCommand,
    ) -> Result<CommandOutcome> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fails {
            return Err(HarnessError::Disconnected(session_id));
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

async fn ready(readiness: &mut tokio::sync::watch::Receiver<bool>) {
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        readiness.wait_for(|ready| *ready),
    )
    .await
    .expect("consumer becomes ready")
    .expect("readiness channel remains open");
}

async fn wait_for_calls(harness: &RecordingHarness, expected: usize) {
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while harness.calls.load(Ordering::SeqCst) != expected {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("command is processed");
}

fn harness(fails: bool) -> Arc<RecordingHarness> {
    Arc::new(RecordingHarness {
        calls: AtomicUsize::new(0),
        fails,
    })
}

fn harness_id() -> HarnessId {
    HarnessId::new_from_uuid(macro_uuid::generate_uuid_v7())
}

#[tokio::test]
async fn a_command_executes_on_exactly_one_responsible_replica() {
    let redis = redis_client();
    let origin = ReplicaId::mint();
    let peer = ReplicaId::mint();
    let origin_harness = harness(false);
    let peer_harness = harness(false);
    let (origin_ready, mut origin_readiness) = tokio::sync::watch::channel(false);
    let origin_consumer = tokio::spawn(consume_runtime_commands(
        redis.clone(),
        origin,
        Arc::new(|_| false),
        Arc::new(|_| false),
        no_agent_handoff(),
        Arc::clone(&origin_harness),
        origin_ready,
        empty_models(redis.clone()),
    ));
    let (peer_ready, mut peer_readiness) = tokio::sync::watch::channel(false);
    let peer_consumer = tokio::spawn(consume_runtime_commands(
        redis.clone(),
        peer,
        Arc::new(|_| false),
        Arc::new(|_| false),
        no_agent_handoff(),
        Arc::clone(&peer_harness),
        peer_ready,
        empty_models(redis.clone()),
    ));
    ready(&mut origin_readiness).await;
    ready(&mut peer_readiness).await;

    let outcome = RedisCommandForwarder::new(redis)
        .forward(
            AgentSessionId::TEST_A,
            HarnessCommand::Delete,
            CommandTarget::Replica(peer),
        )
        .await
        .unwrap();

    assert_eq!(outcome, CommandOutcome::Completed);
    wait_for_calls(&peer_harness, 1).await;
    assert_eq!(origin_harness.calls.load(Ordering::SeqCst), 0);
    origin_consumer.abort();
    peer_consumer.abort();
}

#[tokio::test]
async fn a_responsible_replicas_error_does_not_fail_the_publish() {
    let redis = redis_client();
    let replica = ReplicaId::mint();
    let harness = harness(true);
    let (ready_tx, mut readiness) = tokio::sync::watch::channel(false);
    let consumer = tokio::spawn(consume_runtime_commands(
        redis.clone(),
        replica,
        Arc::new(|_| false),
        Arc::new(|_| false),
        no_agent_handoff(),
        Arc::clone(&harness),
        ready_tx,
        empty_models(redis.clone()),
    ));
    ready(&mut readiness).await;

    let outcome = RedisCommandForwarder::new(redis)
        .forward(
            AgentSessionId::TEST_A,
            HarnessCommand::Delete,
            CommandTarget::Replica(replica),
        )
        .await
        .expect("the command publishes");

    assert_eq!(outcome, CommandOutcome::Completed);
    wait_for_calls(&harness, 1).await;
    consumer.abort();
}

#[tokio::test]
async fn publishing_without_an_owner_still_succeeds() {
    let redis = redis_client();
    let harness = harness(false);
    let (ready_tx, mut readiness) = tokio::sync::watch::channel(false);
    let consumer = tokio::spawn(consume_runtime_commands(
        redis.clone(),
        ReplicaId::mint(),
        Arc::new(|_| false),
        Arc::new(|_| false),
        no_agent_handoff(),
        Arc::clone(&harness),
        ready_tx,
        empty_models(redis.clone()),
    ));
    ready(&mut readiness).await;

    let target = harness_id();
    let outcome = RedisCommandForwarder::new(redis)
        .forward(
            AgentSessionId::TEST_A,
            HarnessCommand::Delete,
            CommandTarget::Harness(target),
        )
        .await
        .expect("the command publishes");

    assert_eq!(outcome, CommandOutcome::Completed);
    assert_eq!(harness.calls.load(Ordering::SeqCst), 0);
    consumer.abort();
}

#[tokio::test]
async fn overlapping_harness_connections_execute_once() {
    let redis = redis_client();
    let first = harness(false);
    let second = harness(false);
    let target = harness_id();
    let (first_ready, mut first_readiness) = tokio::sync::watch::channel(false);
    let first_consumer = tokio::spawn(consume_runtime_commands(
        redis.clone(),
        ReplicaId::mint(),
        Arc::new(move |harness| harness == target),
        Arc::new(|_| false),
        no_agent_handoff(),
        Arc::clone(&first),
        first_ready,
        empty_models(redis.clone()),
    ));
    let (second_ready, mut second_readiness) = tokio::sync::watch::channel(false);
    let second_consumer = tokio::spawn(consume_runtime_commands(
        redis.clone(),
        ReplicaId::mint(),
        Arc::new(move |harness| harness == target),
        Arc::new(|_| false),
        no_agent_handoff(),
        Arc::clone(&second),
        second_ready,
        empty_models(redis.clone()),
    ));
    ready(&mut first_readiness).await;
    ready(&mut second_readiness).await;

    RedisCommandForwarder::new(redis)
        .forward(
            AgentSessionId::TEST_A,
            HarnessCommand::Delete,
            CommandTarget::Harness(target),
        )
        .await
        .unwrap();

    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while first.calls.load(Ordering::SeqCst) + second.calls.load(Ordering::SeqCst) != 1 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("command is processed");
    assert_eq!(
        first.calls.load(Ordering::SeqCst) + second.calls.load(Ordering::SeqCst),
        1
    );
    first_consumer.abort();
    second_consumer.abort();
}

#[tokio::test]
async fn a_disconnect_reaches_every_replica_and_runs_no_command() {
    let redis = redis_client();
    let harness = harness(false);
    let target = harness_id();
    let (dropped_tx, mut dropped) = tokio::sync::mpsc::unbounded_channel();
    let (ready_tx, mut readiness) = tokio::sync::watch::channel(false);
    let consumer = tokio::spawn(consume_runtime_commands(
        redis.clone(),
        ReplicaId::mint(),
        Arc::new(|_| false),
        Arc::new(move |harness| dropped_tx.send(harness).is_ok()),
        no_agent_handoff(),
        Arc::clone(&harness),
        ready_tx,
        empty_models(redis.clone()),
    ));
    ready(&mut readiness).await;

    publish_disconnect(&redis, target).await.unwrap();

    let disconnected = tokio::time::timeout(std::time::Duration::from_secs(2), dropped.recv())
        .await
        .expect("the disconnect arrives")
        .expect("the consumer is running");
    assert_eq!(disconnected, target);
    assert_eq!(harness.calls.load(Ordering::SeqCst), 0);
    consumer.abort();
}

fn no_agent_handoff() -> super::ApplyAgent {
    Arc::new(|_| Box::pin(async {}))
}

fn handoff_request() -> super::ApplyAgentRuntime {
    super::ApplyAgentRuntime {
        apply_agent_harness: HarnessId::new_from_uuid(uuid::Uuid::from_u128(
            0x0000_0000_0000_7000_8000_0000_0000_0a9e,
        )),
        computer_id: hosted_runtimes::domain::ids::ComputerId::new_from_uuid(
            uuid::Uuid::from_u128(7),
        ),
        generation: hosted_runtimes::domain::enrollment::EnrollmentGeneration::new(2),
    }
}

#[tokio::test]
async fn an_agent_handoff_reaches_every_replica_with_no_credential_and_runs_no_command() {
    let redis = redis_client();
    let harness = harness(false);
    let (handed_tx, mut handed) = tokio::sync::mpsc::unbounded_channel();
    let (ready_tx, mut readiness) = tokio::sync::watch::channel(false);
    let consumer = tokio::spawn(consume_runtime_commands(
        redis.clone(),
        ReplicaId::mint(),
        Arc::new(|_| false),
        Arc::new(|_| false),
        Arc::new(move |request| {
            let handed_tx = handed_tx.clone();
            Box::pin(async move {
                let _ = handed_tx.send(request);
            })
        }),
        Arc::clone(&harness),
        ready_tx,
        empty_models(redis.clone()),
    ));
    ready(&mut readiness).await;

    super::publish_apply_agent(&redis, &handoff_request())
        .await
        .unwrap();

    let received = tokio::time::timeout(std::time::Duration::from_secs(2), handed.recv())
        .await
        .expect("the agent hand-off arrives")
        .expect("the consumer is running");
    assert_eq!(received, handoff_request());
    assert_eq!(harness.calls.load(Ordering::SeqCst), 0);
    consumer.abort();
}

/// Issues Ada's environment and counts the issues.
#[derive(Default)]
struct AdaAgent {
    issued: std::sync::Mutex<
        Vec<(
            hosted_runtimes::domain::ids::ComputerId,
            hosted_runtimes::domain::enrollment::EnrollmentGeneration,
        )>,
    >,
}

impl hosted_runtimes::domain::agent::AgentEnrollmentSource for AdaAgent {
    fn issue(
        &self,
        computer: hosted_runtimes::domain::ids::ComputerId,
        generation: hosted_runtimes::domain::enrollment::EnrollmentGeneration,
    ) -> hosted_runtimes::domain::agent::AgentEnrollmentFuture<'_> {
        self.issued.lock().unwrap().push((computer, generation));
        let env = hosted_runtimes::domain::agent::AgentEnv::new(
            [(
                hosted_runtimes::domain::agent::AgentEnvKey::new("MACRO_API_KEY").unwrap(),
                "mak_ada".to_owned(),
            )]
            .into_iter()
            .collect(),
        )
        .unwrap();
        Box::pin(async move {
            Ok(Some(hosted_runtimes::domain::agent::AgentEnrollment {
                agent_user_id: macro_user_id::user_id::MacroUserIdStr::try_from(
                    "macro|ada-1@agents.macro.invalid".to_owned(),
                )
                .unwrap(),
                env,
            }))
        })
    }
}

#[tokio::test]
async fn only_the_replica_holding_the_runtime_issues_and_sends_the_agent() {
    for holds_connection in [false, true] {
        let agents = Arc::new(AdaAgent::default());
        let sent = Arc::new(std::sync::Mutex::new(vec![]));

        super::hand_agent_to_runtime(
            handoff_request(),
            agents.clone(),
            Arc::new(move |_| holds_connection),
            {
                let sent = Arc::clone(&sent);
                Arc::new(move |harness, environment| {
                    sent.lock().unwrap().push((harness, environment));
                    Box::pin(async { true })
                })
            },
        )
        .await;

        let request = handoff_request();
        if holds_connection {
            assert_eq!(
                *agents.issued.lock().unwrap(),
                vec![(request.computer_id, request.generation)]
            );
            assert_eq!(
                *sent.lock().unwrap(),
                vec![(
                    request.apply_agent_harness,
                    agent_runtime_protocol::domain::schema::v0::AgentEnvironment(
                        [("MACRO_API_KEY".to_owned(), "mak_ada".to_owned())]
                            .into_iter()
                            .collect()
                    )
                )]
            );
        } else {
            // Issuing would retire the holder's credentials.
            assert!(agents.issued.lock().unwrap().is_empty());
            assert!(sent.lock().unwrap().is_empty());
        }
    }
}

fn empty_models(redis: redis::Client) -> MacrodModels {
    MacrodModels::new(
        agent_harness::outbound::runtime_registry::RuntimeRegistry::new(),
        redis,
        std::time::Duration::from_secs(2),
    )
}
