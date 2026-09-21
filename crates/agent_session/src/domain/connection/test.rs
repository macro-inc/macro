//! The routing rules, exercised without a socket or an actor.
//!
//! Attribution is the whole point: every frame is logged to a session's
//! transcript, so "which session owns this" is a correctness question about
//! that session's durable history.

use std::time::Duration;

use super::*;
use agent_runtime_protocol::domain::channel::Channel;
use agent_runtime_protocol::domain::schema::v0::ModelProbeResult;
use agent_runtime_protocol::domain::schema::v0::SystemEvent;

const OTHER: AgentSessionId = AgentSessionId::TEST_B;

#[test]
fn mapping_an_attachment_preserves_activation_and_handshake() {
    use crate::domain::model::{ManagerFence, ReplicaId};
    let claim = SessionClaim {
        session: OTHER,
        replica: ReplicaId::from_uuid(macro_uuid::Uuid::from_u128(2)),
        fence: ManagerFence(7),
    };
    let called = Arc::new(AtomicBool::new(false));
    let observed = called.clone();
    let attachment = RuntimeAttachment::solo(1).on_activate(Box::new(move |actual| {
        assert_eq!(actual.session, claim.session);
        assert_eq!(actual.replica, claim.replica);
        assert_eq!(actual.fence, claim.fence);
        observed.store(true, Ordering::SeqCst);
        Ok(())
    }));
    let handshake = attachment.handshake.clone();
    let mut mapped = attachment.map_transport(|n| n.to_string());
    assert_eq!(mapped.connector, "1");
    assert!(mapped.handshake.same_channel(&handshake));
    mapped.activation.take().unwrap()(claim).unwrap();
    assert!(mapped.activation.is_none());
    assert!(called.load(Ordering::SeqCst));
}

fn request(id: &str, method: &str, params: serde_json::Value) -> ToServerMessage {
    ToServerMessage::Acp(AcpMessage(
        RawJsonRpcMessage::request(method.to_owned(), params, RequestId::Str(id.to_owned()))
            .expect("a serializable request"),
    ))
}

fn notification(method: &str, params: serde_json::Value) -> ToServerMessage {
    ToServerMessage::Acp(AcpMessage(
        RawJsonRpcMessage::notification(method.to_owned(), params)
            .expect("a serializable notification"),
    ))
}

fn response(id: &str, result: serde_json::Value) -> ToServerMessage {
    ToServerMessage::Acp(AcpMessage(RawJsonRpcMessage::response(
        RequestId::Str(id.to_owned()),
        Ok(result),
    )))
}

fn ready() -> ToServerMessage {
    ToServerMessage::Event {
        event: SystemEvent::AcpReady,
    }
}

#[test]
fn a_response_goes_to_whoever_asked() {
    let mut routes = Routes::default();
    routes.expect_response(RequestId::Str("mine".to_owned()), AgentSessionId::TEST_A);
    routes.expect_response(RequestId::Str("theirs".to_owned()), OTHER);

    assert_eq!(
        routes.route(&response("theirs", serde_json::json!({}))),
        Routed::Session(OTHER)
    );
    assert_eq!(
        routes.route(&response("mine", serde_json::json!({}))),
        Routed::Session(AgentSessionId::TEST_A)
    );
}

#[test]
fn a_second_answer_to_one_request_belongs_to_nobody() {
    let mut routes = Routes::default();
    routes.expect_response(RequestId::Str("once".to_owned()), AgentSessionId::TEST_A);

    routes.route(&response("once", serde_json::json!({})));

    // Delivering a duplicate would write the same entry into the transcript
    // twice, which is worse than dropping it loudly.
    assert_eq!(
        routes.route(&response("once", serde_json::json!({}))),
        Routed::Orphan
    );
}

#[test]
fn session_scoped_traffic_routes_on_its_acp_session() {
    let mut routes = Routes::default();
    routes.bind_acp_session("acp-mine".into(), AgentSessionId::TEST_A);
    routes.bind_acp_session("acp-theirs".into(), OTHER);

    let update = notification(
        "session/update",
        serde_json::json!({ "sessionId": "acp-theirs", "update": {} }),
    );
    let permission = request(
        "agent:1",
        "session/request_permission",
        serde_json::json!({ "sessionId": "acp-mine", "options": [] }),
    );

    assert_eq!(routes.route(&update), Routed::Session(OTHER));
    assert_eq!(
        routes.route(&permission),
        Routed::Session(AgentSessionId::TEST_A)
    );
}

#[test]
fn traffic_for_an_unknown_session_is_an_orphan() {
    let mut routes = Routes::default();
    routes.bind_acp_session("acp-mine".into(), AgentSessionId::TEST_A);

    let stray = notification(
        "session/update",
        serde_json::json!({ "sessionId": "acp-nobody", "update": {} }),
    );

    assert_eq!(routes.route(&stray), Routed::Orphan);
}

#[test]
fn a_frame_naming_no_session_is_an_orphan() {
    let mut routes = Routes::default();

    let anonymous = notification("something/agentwide", serde_json::json!({}));

    assert_eq!(routes.route(&anonymous), Routed::Orphan);
}

#[test]
fn system_events_belong_to_the_connection() {
    let mut routes = Routes::default();

    // Every session needs to see the runtime come up; only one acts on it.
    assert_eq!(routes.route(&ready()), Routed::Connection);
}

#[test]
fn model_probe_responses_belong_to_the_connection_waiters() {
    let mut routes = Routes::default();

    assert_eq!(
        routes.route(&ToServerMessage::ModelProbeResponse {
            result: ModelProbeResult::Available {
                config_options: Vec::new(),
            },
        }),
        Routed::Probe
    );
}

#[test]
fn a_finished_session_stops_owning_anything() {
    let mut routes = Routes::default();
    routes.expect_response(RequestId::Str("pending".to_owned()), AgentSessionId::TEST_A);
    routes.bind_acp_session("acp-mine".into(), AgentSessionId::TEST_A);
    routes.expect_response(RequestId::Str("survives".to_owned()), OTHER);

    routes.forget(AgentSessionId::TEST_A);

    assert_eq!(
        routes.route(&response("pending", serde_json::json!({}))),
        Routed::Orphan
    );
    assert_eq!(
        routes.route(&notification(
            "session/update",
            serde_json::json!({ "sessionId": "acp-mine" })
        )),
        Routed::Orphan
    );
    assert_eq!(
        routes.route(&response("survives", serde_json::json!({}))),
        Routed::Session(OTHER),
        "another session's expectations are its own"
    );
}

#[test]
fn an_opening_response_announces_the_acp_session_it_created() {
    let ToServerMessage::Acp(AcpMessage(frame)) =
        response("open", serde_json::json!({ "sessionId": "acp-new" }))
    else {
        unreachable!("built as an acp frame")
    };

    assert_eq!(
        opened_acp_session(&frame).map(|id| id.to_string()),
        Some("acp-new".to_owned())
    );
}

/// A double for the shared socket that records nothing and never answers.
#[derive(Default)]
struct SilentSocket;

/// Its sending half: accepts everything, remembers nothing.
#[derive(Clone, Default)]
struct SilentSender;

/// Its receiving half: a socket that is open and simply never speaks.
struct SilentReceiver;

impl Transport<ToRuntimeMessage, ToServerMessage> for SilentSocket {
    type Sender = SilentSender;
    type Receiver = SilentReceiver;

    fn split(self) -> (Self::Sender, Self::Receiver) {
        (SilentSender, SilentReceiver)
    }
}

impl TransportSender<ToRuntimeMessage> for SilentSender {
    async fn send(&self, _message: ToRuntimeMessage) -> Result<(), TransportError> {
        Ok(())
    }
}

impl TransportReceiver<ToServerMessage> for SilentReceiver {
    async fn recv(&mut self) -> Result<Option<ToServerMessage>, TransportError> {
        std::future::pending().await
    }
}

#[tokio::test]
async fn a_session_binding_after_the_runtime_reported_ready_is_told_so() {
    let connection = RuntimeConnection::connect(SilentSocket);
    // The runtime dials and reports ready with nothing bound yet - the
    // ordinary case, since a session only binds once somebody mentions the
    // bot, which is usually later.
    connection
        .on_connection_message(ToServerMessage::Event {
            event: SystemEvent::AcpReady,
        })
        .await;

    let attachment = connection.bind(AgentSessionId::TEST_A).await;

    // Handed the readiness it missed, so it can run the handshake rather than
    // booting forever with its prompt queued behind a signal already spent.
    let (_outbound, mut inbound) = attachment.connector.split();
    let first = inbound.recv().await.expect("a frame");
    assert!(matches!(
        first,
        ToServerMessage::Event {
            event: SystemEvent::AcpReady
        }
    ));
}

#[tokio::test]
async fn evicting_ends_the_sessions_a_displaced_connection_was_carrying() {
    let connection = RuntimeConnection::connect(SilentSocket);
    let attachment = connection.bind(AgentSessionId::TEST_A).await;
    let (_outbound, mut inbound) = attachment.connector.split();

    // `SilentSocket` never closes, which is the case eviction exists for: a
    // displaced runtime whose socket is still perfectly healthy. Nothing else
    // would ever end this connection.
    connection.evict();

    assert!(
        inbound.recv().await.is_none(),
        "the displaced session's queue should be closed at once"
    );
}

#[tokio::test]
async fn only_one_session_is_asked_to_run_the_handshake() {
    let connection = RuntimeConnection::connect(SilentSocket);
    connection
        .on_connection_message(ToServerMessage::Event {
            event: SystemEvent::AcpReady,
        })
        .await;

    let first = connection.bind(AgentSessionId::TEST_A).await;
    let second = connection.bind(OTHER).await;

    let (_first_outbound, mut first_inbound) = first.connector.split();
    let (_second_outbound, mut second_inbound) = second.connector.split();
    assert!(first_inbound.recv().await.is_some());
    // A connection takes exactly one `initialize`, so the second session waits
    // for the first one's answer instead of sending its own.
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), second_inbound.recv())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn a_session_bound_before_ready_still_runs_the_handshake() {
    let connection = RuntimeConnection::connect(SilentSocket);

    let attachment = connection.bind(AgentSessionId::TEST_A).await;
    connection
        .on_connection_message(ToServerMessage::Event {
            event: SystemEvent::AcpReady,
        })
        .await;

    let (_outbound, mut inbound) = attachment.connector.split();
    let first = inbound.recv().await.expect("a frame");
    assert!(matches!(
        first,
        ToServerMessage::Event {
            event: SystemEvent::AcpReady
        }
    ));
}

fn resume_request(acp_session: &str) -> ToRuntimeMessage {
    ToRuntimeMessage::Acp(AcpMessage(
        RawJsonRpcMessage::request(
            "session/resume".to_owned(),
            serde_json::json!({ "sessionId": acp_session, "cwd": "/workspace" }),
            RequestId::Str("agent_session:resume".to_owned()),
        )
        .expect("a serializable request"),
    ))
}

#[tokio::test]
async fn a_resumed_session_owns_the_updates_that_follow() {
    let connection = RuntimeConnection::connect(SilentSocket);
    let attachment = connection.bind(AgentSessionId::TEST_A).await;

    // Resuming is the reconnect path: the request names the ACP session and
    // the answer does not echo it, so this send is the only chance to learn
    // whose it is. Miss it and every later update for that session is an
    // orphan - the session goes silent on exactly the path that restores it.
    let (outbound, _inbound) = attachment.connector.split();
    outbound
        .send(resume_request("acp-42"))
        .await
        .expect("the send is accepted");

    let update = notification(
        "session/update",
        serde_json::json!({ "sessionId": "acp-42", "update": {} }),
    );
    assert_eq!(
        connection.routes.lock().await.route(&update),
        Routed::Session(AgentSessionId::TEST_A)
    );
}

#[tokio::test]
async fn a_model_probe_answer_reaches_the_waiter_and_no_session() {
    let (carrier, mut runtime) = Channel::duplex();
    let connection = RuntimeConnection::connect(carrier);
    let attachment = connection.bind(AgentSessionId::TEST_A).await;
    let (_session_outbound, mut session_inbound) = attachment.connector.split();
    let probing = {
        let connection = Arc::clone(&connection);
        tokio::spawn(async move { connection.probe_models().await })
    };
    assert!(matches!(
        runtime.rx.recv().await,
        Some(ToRuntimeMessage::ModelProbeRequest)
    ));

    runtime
        .tx
        .send(ToServerMessage::ModelProbeResponse {
            result: ModelProbeResult::Available {
                config_options: Vec::new(),
            },
        })
        .expect("response should send");

    assert!(
        probing
            .await
            .expect("probe task")
            .expect("the answer should succeed")
            .is_empty()
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(20), session_inbound.recv())
            .await
            .is_err(),
        "probe responses must not be broadcast into a session transcript"
    );
}

/// Concurrent probes ask one parameterless question of one harness, so a
/// single answer is the truth for all of them.
#[tokio::test]
async fn one_model_probe_answer_serves_every_concurrent_waiter() {
    let (carrier, mut runtime) = Channel::duplex();
    let connection = RuntimeConnection::connect(carrier);
    let probes = (0..2)
        .map(|_| {
            let connection = Arc::clone(&connection);
            tokio::spawn(async move { connection.probe_models().await })
        })
        .collect::<Vec<_>>();
    for _ in 0..2 {
        assert!(matches!(
            runtime.rx.recv().await,
            Some(ToRuntimeMessage::ModelProbeRequest)
        ));
    }

    runtime
        .tx
        .send(ToServerMessage::ModelProbeResponse {
            result: ModelProbeResult::Available {
                config_options: Vec::new(),
            },
        })
        .expect("response should send");

    for probe in probes {
        assert!(
            tokio::time::timeout(Duration::from_secs(1), probe)
                .await
                .expect("probe should not hang")
                .expect("probe task")
                .expect("the one answer should serve this waiter")
                .is_empty()
        );
    }
}

#[tokio::test]
async fn an_evicted_connection_stops_waiting_probes() {
    let (carrier, mut runtime) = Channel::duplex();
    let connection = RuntimeConnection::connect(carrier);
    let probing = {
        let connection = Arc::clone(&connection);
        tokio::spawn(async move { connection.probe_models().await })
    };
    assert!(matches!(
        runtime.rx.recv().await,
        Some(ToRuntimeMessage::ModelProbeRequest)
    ));

    connection.evict();

    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(1), probing)
            .await
            .expect("an evicted probe should not hang")
            .expect("probe task"),
        Err(ModelProbeError::Closed)
    ));
}

#[tokio::test]
async fn pending_model_probe_ends_when_the_connection_closes() {
    let (carrier, mut runtime) = Channel::duplex();
    let connection = RuntimeConnection::connect(carrier);
    let probing = {
        let connection = Arc::clone(&connection);
        tokio::spawn(async move { connection.probe_models().await })
    };

    assert!(matches!(
        runtime.rx.recv().await,
        Some(ToRuntimeMessage::ModelProbeRequest)
    ));
    drop(runtime);

    assert!(matches!(
        probing.await.expect("probe task"),
        Err(ModelProbeError::Closed)
    ));
}
