use agent_client_protocol::schema::v1::{
    SessionConfigOption, SessionConfigSelectOption, SessionConfigValueId,
};
use agent_harness::domain::model_load::{MacrodModelProbe as _, ModelProbeError, RawModelProbe};
use agent_runtime_protocol::domain::channel::Channel;
use agent_runtime_protocol::domain::schema::v0::{
    ModelProbeResult, ToRuntimeMessage, ToServerMessage,
};

use super::*;

#[tokio::test]
async fn disconnected_runtime_is_reported_without_creating_session_state() {
    let provider = MacrodModels::new(RuntimeRegistry::new());

    assert!(matches!(
        provider.probe(HarnessId::TEST_A).await,
        Err(ModelProbeError::Disconnected)
    ));
}

#[tokio::test]
async fn connected_runtime_returns_its_fresh_probe_options() {
    let registry = RuntimeRegistry::new();
    let (carrier, mut runtime) = Channel::duplex();
    registry.attach(HarnessId::TEST_A, carrier);
    let provider = MacrodModels::new(registry);
    let (release, held) = tokio::sync::oneshot::channel();

    let response = tokio::spawn(async move {
        let ToRuntimeMessage::ModelProbeRequest { request_id } =
            runtime.rx.recv().await.expect("probe request")
        else {
            panic!("expected model probe request");
        };
        runtime
            .tx
            .send(ToServerMessage::ModelProbeResponse {
                request_id,
                result: ModelProbeResult::Available {
                    config_options: vec![SessionConfigOption::select(
                        "model",
                        "Model",
                        SessionConfigValueId::new("fast"),
                        vec![SessionConfigSelectOption::new("fast", "Fast")],
                    )],
                },
            })
            .unwrap();
        let _ = held.await;
    });

    let RawModelProbe::Options(options) = provider.probe(HarnessId::TEST_A).await.unwrap() else {
        panic!("connected macrod should advertise options");
    };
    let _ = release.send(());
    response.await.unwrap();
    assert_eq!(options.len(), 1);
}
