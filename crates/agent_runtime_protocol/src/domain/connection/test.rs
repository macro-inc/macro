use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use agent_client_protocol::Channel as AcpChannel;
use agent_client_protocol::{RawJsonRpcMessage, TransportFrame};
use futures::StreamExt;
use serde_json::json;
use tokio::sync::Mutex;
use tokio::time::{Duration, timeout};

use super::*;

#[derive(Clone, Default)]
struct Events(Arc<Mutex<Vec<SystemEvent>>>);

impl SystemEventHandler for Events {
    async fn handle(&self, event: SystemEvent) {
        self.0.lock().await.push(event);
    }
}

/// Connect a server/runtime pair, discarding their ACP channels.
fn connections() -> (ServerConnection, RuntimeConnection, Events) {
    let (server_channel, runtime_channel) = Channel::duplex();
    let events = Events::default();
    let (server, _server_acp) = ServerConnection::connect(server_channel, events.clone());
    let (runtime, _runtime_acp) = RuntimeConnection::connect(runtime_channel);
    (server, runtime, events)
}

/// Unwrap a frame this test knows is a single valid message - the only shape
/// anything on either side of this relay ever sends.
fn expect_single(frame: TransportFrame) -> RawJsonRpcMessage {
    match frame {
        TransportFrame::Single(message) => message,
        other => panic!("expected a single message, got {other:?}"),
    }
}

/// Connect a server/runtime pair, keeping both ACP channels.
fn connections_with_acp() -> (
    ServerConnection,
    AcpChannel,
    RuntimeConnection,
    AcpChannel,
    Events,
) {
    let (server_channel, runtime_channel) = Channel::duplex();
    let events = Events::default();
    let (server, server_acp) = ServerConnection::connect(server_channel, events.clone());
    let (runtime, runtime_acp) = RuntimeConnection::connect(runtime_channel);
    (server, server_acp, runtime, runtime_acp, events)
}

#[tokio::test]
async fn unit_handlers_support_connections_that_only_use_acp() {
    let (server_channel, runtime_channel) = Channel::duplex();
    let (_server, _server_acp) = ServerConnection::connect(server_channel, ());
    let (_runtime, _runtime_acp) = RuntimeConnection::connect(runtime_channel);
}

#[tokio::test]
async fn system_event_is_dispatched_without_a_response() {
    let (_server, runtime, events) = connections();
    runtime
        .system_event(SystemEvent::Unknown("runtime/ready".to_owned()))
        .expect("event should send");

    timeout(Duration::from_secs(1), async {
        loop {
            if events.0.lock().await.len() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("event should be dispatched");

    assert_eq!(
        events.0.lock().await[0],
        SystemEvent::Unknown("runtime/ready".to_owned())
    );
}

#[tokio::test]
async fn acp_channels_carry_raw_sdk_messages_in_both_directions() {
    let (_server, mut server_acp, _runtime, mut runtime_acp, _events) = connections_with_acp();

    let initialize = RawJsonRpcMessage::request(
        "initialize".to_owned(),
        json!({ "protocolVersion": 1 }),
        agent_client_protocol::schema::v1::RequestId::Number(1),
    )
    .unwrap();
    server_acp
        .tx
        .unbounded_send(TransportFrame::Single(initialize))
        .unwrap();

    let delivered = expect_single(
        timeout(Duration::from_secs(1), runtime_acp.rx.next())
            .await
            .expect("ACP request should not hang")
            .expect("ACP channel should remain open"),
    );
    assert_eq!(
        serde_json::to_value(delivered).unwrap(),
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": { "protocolVersion": 1 },
        })
    );

    runtime_acp
        .tx
        .unbounded_send(TransportFrame::Single(RawJsonRpcMessage::response(
            agent_client_protocol::schema::v1::RequestId::Number(1),
            Ok(json!({ "protocolVersion": 1 })),
        )))
        .unwrap();
    let response = expect_single(
        timeout(Duration::from_secs(1), server_acp.rx.next())
            .await
            .expect("ACP response should not hang")
            .expect("ACP channel should remain open"),
    );
    assert_eq!(
        serde_json::to_value(response).unwrap(),
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": { "protocolVersion": 1 },
        })
    );
}

#[tokio::test]
async fn dropping_a_connection_closes_its_acp_channel() {
    let (_server, mut server_acp, _runtime, _runtime_acp, _events) = connections_with_acp();

    drop(_runtime);

    let closed = timeout(Duration::from_secs(1), server_acp.rx.next())
        .await
        .expect("ACP channel should close promptly");
    assert!(closed.is_none());
}

#[tokio::test]
async fn official_acp_client_and_agent_connect_directly_to_exposed_channels() {
    use agent_client_protocol::schema::ProtocolVersion;
    use agent_client_protocol::schema::v1::{InitializeRequest, InitializeResponse};
    use agent_client_protocol::{Agent, Client};

    let (_server, server_acp, _runtime, runtime_acp, _events) = connections_with_acp();

    let agent = tokio::spawn(async move {
        Agent
            .builder()
            .on_receive_request(
                async move |request: InitializeRequest, responder, _connection| {
                    responder.respond(InitializeResponse::new(request.protocol_version))
                },
                agent_client_protocol::on_receive_request!(),
            )
            .connect_to(runtime_acp)
            .await
    });

    let response = timeout(
        Duration::from_secs(1),
        Client.connect_with(server_acp, async |connection| {
            connection
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await
        }),
    )
    .await
    .expect("official ACP initialize should not hang")
    .expect("official ACP initialize should succeed");
    assert_eq!(response.protocol_version, ProtocolVersion::V1);

    agent.abort();
    assert!(
        agent
            .await
            .expect_err("agent task should be cancelled")
            .is_cancelled(),
        "the long-lived agent driver should only be stopped explicitly"
    );
}

struct ProbeHandler;

impl ModelProbeHandler for ProbeHandler {
    async fn probe(
        &self,
    ) -> Result<Vec<agent_client_protocol::schema::v1::SessionConfigOption>, String> {
        Ok(Vec::new())
    }
}

#[tokio::test]
async fn runtime_answers_each_model_probe_with_its_correlation_id() {
    let (mut service, runtime_channel) = Channel::duplex();
    let (_runtime, _runtime_acp) =
        RuntimeConnection::connect_with_model_probe_handler(runtime_channel, ProbeHandler);
    let request_id = crate::domain::schema::v0::ModelProbeId::from_string("probe-a".to_owned());

    service
        .tx
        .send(ToRuntimeMessage::ModelProbeRequest {
            request_id: request_id.clone(),
        })
        .expect("request should send");
    let response = timeout(Duration::from_secs(1), service.rx.recv())
        .await
        .expect("probe response should not hang")
        .expect("runtime should remain connected");

    assert!(matches!(
        response,
        ToServerMessage::ModelProbeResponse {
            request_id: actual,
            result: crate::domain::schema::v0::ModelProbeResult::Available { config_options },
        } if actual == request_id && config_options.is_empty()
    ));
}

struct ConcurrentProbeHandler {
    started: Arc<AtomicUsize>,
    release: Arc<tokio::sync::Notify>,
}

impl ModelProbeHandler for ConcurrentProbeHandler {
    async fn probe(
        &self,
    ) -> Result<Vec<agent_client_protocol::schema::v1::SessionConfigOption>, String> {
        self.started.fetch_add(1, Ordering::SeqCst);
        self.release.notified().await;
        Ok(Vec::new())
    }
}

#[tokio::test]
async fn runtime_model_probes_fan_out_without_serializing() {
    let (mut service, runtime_channel) = Channel::duplex();
    let started = Arc::new(AtomicUsize::new(0));
    let release = Arc::new(tokio::sync::Notify::new());
    let (_runtime, _runtime_acp) = RuntimeConnection::connect_with_model_probe_handler(
        runtime_channel,
        ConcurrentProbeHandler {
            started: Arc::clone(&started),
            release: Arc::clone(&release),
        },
    );

    for id in ["probe-a", "probe-b"] {
        service
            .tx
            .send(ToRuntimeMessage::ModelProbeRequest {
                request_id: crate::domain::schema::v0::ModelProbeId::from_string(id.to_owned()),
            })
            .expect("request should send");
    }
    timeout(Duration::from_secs(1), async {
        while started.load(Ordering::SeqCst) != 2 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("both probes should start while neither can finish");
    release.notify_waiters();

    for _ in 0..2 {
        assert!(matches!(
            timeout(Duration::from_secs(1), service.rx.recv())
                .await
                .expect("response should not hang"),
            Some(ToServerMessage::ModelProbeResponse { .. })
        ));
    }
}
