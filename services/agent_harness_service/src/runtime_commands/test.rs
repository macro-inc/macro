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
        Arc::clone(&origin_harness),
        origin_ready,
        empty_models(redis.clone()),
        no_delivery(),
        None,
    ));
    let (peer_ready, mut peer_readiness) = tokio::sync::watch::channel(false);
    let peer_consumer = tokio::spawn(consume_runtime_commands(
        redis.clone(),
        peer,
        Arc::new(|_| false),
        Arc::clone(&peer_harness),
        peer_ready,
        empty_models(redis.clone()),
        no_delivery(),
        None,
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
        Arc::clone(&harness),
        ready_tx,
        empty_models(redis.clone()),
        no_delivery(),
        None,
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
        Arc::clone(&harness),
        ready_tx,
        empty_models(redis.clone()),
        no_delivery(),
        None,
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
        Arc::clone(&first),
        first_ready,
        empty_models(redis.clone()),
        no_delivery(),
        None,
    ));
    let (second_ready, mut second_readiness) = tokio::sync::watch::channel(false);
    let second_consumer = tokio::spawn(consume_runtime_commands(
        redis.clone(),
        ReplicaId::mint(),
        Arc::new(move |harness| harness == target),
        Arc::clone(&second),
        second_ready,
        empty_models(redis.clone()),
        no_delivery(),
        None,
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

fn empty_models(redis: redis::Client) -> MacrodModels {
    MacrodModels::new(
        agent_harness::outbound::runtime_registry::RuntimeRegistry::new(),
        redis,
        std::time::Duration::from_secs(2),
    )
}

fn no_delivery()
-> Arc<dyn Fn(DeliverAgent) -> futures::future::BoxFuture<'static, ()> + Send + Sync> {
    Arc::new(|_| Box::pin(async {}))
}

const AGENT_HARNESS: HarnessId = HarnessId::new_from_uuid(uuid::Uuid::from_u128(
    0x0193_0000_0000_7000_8000_0000_0000_00a1,
));
const AGENT_COMPUTER: hosted_runtimes::domain::ids::ComputerId =
    hosted_runtimes::domain::ids::ComputerId::new_from_uuid(uuid::Uuid::from_u128(
        0x0193_0000_0000_7000_8000_0000_0000_00c1,
    ));

/// Issues Ada's environment and records each issue.
#[derive(Default)]
struct AdaAgent {
    issued: std::sync::Mutex<
        Vec<(
            hosted_runtimes::domain::ids::ComputerId,
            hosted_runtimes::domain::enrollment::EnrollmentGeneration,
        )>,
    >,
    /// How long the authentication service takes to answer.
    answers_after: std::time::Duration,
}

impl hosted_runtimes::domain::agent::AgentEnrollmentSource for AdaAgent {
    fn issue(
        &self,
        computer: hosted_runtimes::domain::ids::ComputerId,
        generation: hosted_runtimes::domain::enrollment::EnrollmentGeneration,
    ) -> hosted_runtimes::domain::agent::AgentEnrollmentFuture<'_> {
        self.issued.lock().unwrap().push((computer, generation));
        let answers_after = self.answers_after;
        Box::pin(async move {
            tokio::time::sleep(answers_after).await;
            let mut values = std::collections::BTreeMap::new();
            values.insert(
                hosted_runtimes::domain::agent::AgentEnvKey::new("MACRO_API_KEY").unwrap(),
                "mak_ada".to_owned(),
            );
            Ok(Some(hosted_runtimes::domain::agent::AgentEnrollment {
                agent_user_id: macro_user_id::user_id::MacroUserIdStr::try_from(
                    "macro|ada@agents.macro.invalid".to_owned(),
                )
                .unwrap(),
                env: hosted_runtimes::domain::agent::AgentEnv::new(values).unwrap(),
            }))
        })
    }
}

type Sent = Arc<std::sync::Mutex<Vec<(HarnessId, std::collections::BTreeMap<String, String>)>>>;

fn recording_send(sent: Sent) -> SendAgent {
    Arc::new(move |harness, environment, _traceparent| {
        sent.lock().unwrap().push((harness, environment.0.clone()));
        Box::pin(async { true })
    })
}

/// The dial macrod holds open on this replica throughout a test.
fn dial() -> agent_harness::domain::ports::RuntimeConnectionId {
    static DIAL: std::sync::LazyLock<agent_harness::domain::ports::RuntimeConnectionId> =
        std::sync::LazyLock::new(agent_harness::domain::ports::RuntimeConnectionId::generate);
    *DIAL
}

fn hand_off() -> DeliverAgent {
    DeliverAgent::new(
        AGENT_HARNESS,
        AGENT_COMPUTER,
        hosted_runtimes::domain::enrollment::EnrollmentGeneration::new(2),
    )
}

#[tokio::test]
async fn the_replica_holding_the_socket_issues_the_agent_and_sends_it_down() {
    let agents = Arc::new(AdaAgent::default());
    let sent = Sent::default();

    deliver_agent_to_runtime(
        hand_off(),
        agents.clone(),
        Arc::default(),
        Arc::new(|harness| (harness == AGENT_HARNESS).then_some(dial())),
        recording_send(Arc::clone(&sent)),
    )
    .await;

    assert_eq!(
        *agents.issued.lock().unwrap(),
        vec![(
            AGENT_COMPUTER,
            hosted_runtimes::domain::enrollment::EnrollmentGeneration::new(2)
        )]
    );
    assert_eq!(
        *sent.lock().unwrap(),
        vec![(
            AGENT_HARNESS,
            [("MACRO_API_KEY".to_owned(), "mak_ada".to_owned())]
                .into_iter()
                .collect()
        )]
    );
}

#[tokio::test]
async fn the_agent_is_handed_the_setup_trace_its_hand_off_carried() {
    use opentelemetry::trace::TracerProvider as _;
    use tracing_subscriber::layer::SubscriberExt as _;

    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );
    let provider = opentelemetry_sdk::trace::SdkTracerProvider::builder().build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
    let traceparents = Arc::new(std::sync::Mutex::new(Vec::new()));
    let send: SendAgent = {
        let traceparents = Arc::clone(&traceparents);
        Arc::new(move |_harness, _environment, traceparent| {
            traceparents.lock().unwrap().push(traceparent);
            Box::pin(async { true })
        })
    };
    let mut request = hand_off();
    request.trace_context = [(
        "traceparent".to_owned(),
        "00-11111111111111111111111111111111-2222222222222222-01".to_owned(),
    )]
    .into_iter()
    .collect();

    let _guard = tracing::subscriber::set_default(subscriber);
    deliver_agent_to_runtime(
        request,
        Arc::new(AdaAgent::default()),
        Arc::default(),
        Arc::new(|harness| (harness == AGENT_HARNESS).then_some(dial())),
        send,
    )
    .await;

    let traceparents = traceparents.lock().unwrap();
    let [Some(traceparent)] = traceparents.as_slice() else {
        panic!("expected one hand-off with a traceparent, got {traceparents:?}");
    };
    assert!(
        traceparent.starts_with("00-11111111111111111111111111111111-"),
        "{traceparent}"
    );
}

/// Each issue retires the agent's previous key, so a replica without the
/// socket must not issue.
#[tokio::test]
async fn a_replica_without_the_socket_issues_nothing() {
    let agents = Arc::new(AdaAgent::default());
    let sent = Sent::default();

    deliver_agent_to_runtime(
        hand_off(),
        agents.clone(),
        Arc::default(),
        Arc::new(|_| None),
        recording_send(Arc::clone(&sent)),
    )
    .await;

    assert!(agents.issued.lock().unwrap().is_empty());
    assert!(sent.lock().unwrap().is_empty());
}

/// The bus carries ids only, and a hand-off is told apart from the other
/// runtime bus events.
#[test]
fn a_hand_off_on_the_bus_carries_no_credential_and_reads_back_as_one() {
    let wire = serde_json::to_value(hand_off()).unwrap();
    let mut keys: Vec<&str> = wire
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "computer_id",
            "deliver_agent_harness",
            "generation",
            "trace_context"
        ]
    );

    let read: RuntimeBusEvent = serde_json::from_value(wire).unwrap();
    assert!(matches!(read, RuntimeBusEvent::DeliverAgent(request) if request == hand_off()));
}

/// A hand-off sent again (the lifecycle repeats it until the agent reports
/// online) re-sends what this replica issued: issuing again would rotate the
/// key the starting agent already holds.
#[tokio::test]
async fn a_repeated_hand_off_sends_the_same_environment_without_issuing_again() {
    let agents = Arc::new(AdaAgent::default());
    let issued = Arc::new(IssuedAgents::default());
    let sent = Sent::default();

    for _ in 0..2 {
        deliver_agent_to_runtime(
            hand_off(),
            agents.clone(),
            Arc::clone(&issued),
            Arc::new(|harness| (harness == AGENT_HARNESS).then_some(dial())),
            recording_send(Arc::clone(&sent)),
        )
        .await;
    }

    assert_eq!(agents.issued.lock().unwrap().len(), 1);
    let sent = sent.lock().unwrap();
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[0], sent[1]);
}

/// Two hand-offs for one enrollment in flight at once (the first and its
/// redelivery) issue once: a second issue would rotate the key the first sent.
#[tokio::test(start_paused = true)]
async fn hand_offs_racing_for_one_enrollment_issue_it_once() {
    let agents = Arc::new(AdaAgent {
        answers_after: std::time::Duration::from_secs(1),
        ..AdaAgent::default()
    });
    let issued = Arc::new(IssuedAgents::default());
    let sent = Sent::default();
    let deliver = || {
        deliver_agent_to_runtime(
            hand_off(),
            agents.clone(),
            Arc::clone(&issued),
            Arc::new(|harness| (harness == AGENT_HARNESS).then_some(dial())),
            recording_send(Arc::clone(&sent)),
        )
    };

    tokio::join!(deliver(), deliver());

    assert_eq!(agents.issued.lock().unwrap().len(), 1);
    let sent = sent.lock().unwrap();
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[0], sent[1]);
}

/// macrod redialing while its agent starts may have met another replica,
/// which issued and so revoked the key kept here: a new dial issues again.
#[tokio::test]
async fn a_hand_off_on_a_new_dial_issues_again() {
    let agents = Arc::new(AdaAgent::default());
    let issued = Arc::new(IssuedAgents::default());
    let sent = Sent::default();
    let redial = agent_harness::domain::ports::RuntimeConnectionId::generate();

    for connection in [dial(), redial] {
        deliver_agent_to_runtime(
            hand_off(),
            agents.clone(),
            Arc::clone(&issued),
            Arc::new(move |harness| (harness == AGENT_HARNESS).then_some(connection)),
            recording_send(Arc::clone(&sent)),
        )
        .await;
    }

    assert_eq!(agents.issued.lock().unwrap().len(), 2);
    assert_eq!(sent.lock().unwrap().len(), 2);
}

/// A recheck on the bus names only its machine, and is told apart from a
/// teammate change.
#[test]
fn a_recheck_on_the_bus_reads_back_as_one() {
    let recheck = crate::teammates::TeammateHostRecheck::new(AGENT_HARNESS);
    let wire = serde_json::to_value(&recheck).unwrap();
    let mut keys: Vec<&str> = wire
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(keys, ["recheck_teammate_host", "trace_context"]);

    let read: RuntimeBusEvent = serde_json::from_value(wire).unwrap();
    assert!(matches!(read, RuntimeBusEvent::TeammateHostRecheck(read) if read == recheck));
}
