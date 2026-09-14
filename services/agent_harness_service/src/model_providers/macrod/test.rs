use super::*;
use agent_client_protocol::schema::v1::{SessionConfigOption, SessionConfigSelectOption};
use agent_harness::domain::error::Result as HarnessResult;
use agent_harness::domain::model::{CommandOutcome, HarnessCommand};
use agent_harness::domain::service::ForwardedCommands;
use agent_runtime_protocol::domain::channel::Channel;
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_session::domain::model::{AgentSessionId, ReplicaId};

struct NoCommands;

impl ForwardedCommands for NoCommands {
    async fn execute_forwarded(
        &self,
        _: AgentSessionId,
        _: HarnessCommand,
    ) -> HarnessResult<CommandOutcome> {
        panic!("model discovery must not create or execute session commands")
    }
}

struct Peer {
    models: MacrodModels,
    registry: Arc<RuntimeRegistry<GatewaySender>>,
    consumer: tokio::task::JoinHandle<anyhow::Result<()>>,
}

impl Drop for Peer {
    fn drop(&mut self) {
        self.consumer.abort();
    }
}

async fn peer() -> Peer {
    let url = macro_env_var::optional_read_env_var("REDIS_URI")
        .ok()
        .flatten()
        .unwrap_or_else(|| "redis://127.0.0.1:6379".to_owned());
    let redis = redis::Client::open(url).unwrap();
    let registry = RuntimeRegistry::new();
    let models = MacrodModels::new(Arc::clone(&registry), redis.clone(), Duration::from_secs(2));
    let (ready, mut readiness) = tokio::sync::watch::channel(false);
    let consumer = tokio::spawn(crate::runtime_commands::consume_runtime_commands(
        redis,
        ReplicaId::mint(),
        {
            let registry = Arc::clone(&registry);
            Arc::new(move |harness| registry.is_connected(harness))
        },
        Arc::new(NoCommands),
        ready,
        models.clone(),
    ));
    tokio::time::timeout(Duration::from_secs(2), readiness.wait_for(|ready| *ready))
        .await
        .unwrap()
        .unwrap();
    Peer {
        models,
        registry,
        consumer,
    }
}

fn harness_id() -> HarnessId {
    HarnessId::new_from_uuid(macro_uuid::generate_uuid_v7())
}

fn options() -> Vec<SessionConfigOption> {
    vec![SessionConfigOption::select(
        "model",
        "Model",
        "fast",
        vec![SessionConfigSelectOption::new("fast", "Fast")],
    )]
}

async fn probe_through_bus(remote: bool) {
    let origin = peer().await;
    let other = peer().await;
    let owner = if remote { &other } else { &origin };
    let harness = harness_id();
    let (carrier, mut runtime) = Channel::duplex();
    owner.registry.attach(harness, carrier);

    let (result, ()) = tokio::time::timeout(Duration::from_secs(3), async {
        tokio::join!(origin.models.probe(harness), async {
            assert!(matches!(
                runtime.rx.recv().await.unwrap(),
                ToRuntimeMessage::ModelProbeRequest
            ));
            runtime
                .tx
                .send(ToServerMessage::ModelProbeResponse {
                    result: ModelProbeResult::Available {
                        config_options: options(),
                    },
                })
                .unwrap();
        })
    })
    .await
    .expect("probe crosses Redis and returns");

    let RawModelProbe::Options(actual) = result.unwrap() else {
        panic!("the runtime advertised options");
    };
    assert_eq!(actual, options());
    assert!(runtime.rx.try_recv().is_err(), "only one replica probes");
}

#[tokio::test]
async fn remote_socket_owner_probes_and_broadcasts_models_to_origin() {
    probe_through_bus(true).await;
}

#[tokio::test]
async fn local_socket_owner_uses_the_same_bus_path() {
    probe_through_bus(false).await;
}

#[tokio::test]
async fn remote_probe_errors_reach_the_waiting_replica() {
    let origin = peer().await;
    let owner = peer().await;
    let harness = harness_id();
    let (carrier, mut runtime) = Channel::duplex();
    owner.registry.attach(harness, carrier);
    let (result, ()) = tokio::time::timeout(Duration::from_secs(3), async {
        tokio::join!(origin.models.probe(harness), async {
            runtime.rx.recv().await.unwrap();
            runtime
                .tx
                .send(ToServerMessage::ModelProbeResponse {
                    result: ModelProbeResult::Error {
                        message: "probe failed".to_owned(),
                    },
                })
                .unwrap();
        })
    })
    .await
    .unwrap();
    assert!(matches!(result, Err(ModelProbeError::Failed(_))));
}

#[tokio::test]
async fn absent_owner_waits_for_caller_timeout_and_ignores_other_harness_results() {
    let origin = peer().await;
    let harness = harness_id();
    let result = tokio::time::timeout(Duration::from_millis(100), async {
        tokio::join!(origin.models.probe(harness), async {
            origin
                .models
                .publish(ModelProbeEvent::ModelsProbed {
                    harness: harness_id(),
                    result: ModelProbeResult::Available {
                        config_options: options(),
                    },
                })
                .await
                .unwrap();
        })
    })
    .await;
    assert!(
        result.is_err(),
        "an unrelated harness cannot satisfy the probe"
    );
    assert_eq!(
        origin.models.observations.receiver_count(),
        0,
        "cancellation removes the waiter"
    );
}

#[tokio::test]
async fn concurrent_callers_can_observe_the_same_fresh_harness_result() {
    let first = peer().await;
    let second = peer().await;
    let owner = peer().await;
    let harness = harness_id();
    // Use a controlled observation to exercise fanout independently of the
    // runtime's probe serialization.
    let one = first.models.probe(harness);
    let two = second.models.probe(harness);
    let (one, two, ()) = tokio::time::timeout(Duration::from_secs(3), async {
        tokio::join!(one, two, async {
            while first.models.observations.receiver_count() == 0
                || second.models.observations.receiver_count() == 0
            {
                tokio::task::yield_now().await;
            }
            owner
                .models
                .publish(ModelProbeEvent::ModelsProbed {
                    harness,
                    result: ModelProbeResult::Available {
                        config_options: options(),
                    },
                })
                .await
                .unwrap();
        })
    })
    .await
    .unwrap();
    assert!(matches!(one, Ok(RawModelProbe::Options(_))));
    assert!(matches!(two, Ok(RawModelProbe::Options(_))));
}
