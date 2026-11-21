//! A session requested the instant a Macro computer reports Ready.
//!
//! The control plane binds the computer's agent when macrod first connects
//! its runtime, which is also when the computer reads Ready. A requester who
//! prompts at once has their session request published before macrod's
//! trigger stream covers the new agent. It must still reach macrod, and
//! promptly: the request is waited on for a few minutes, the requester
//! watches every second of it.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use agent_session::domain::model::AgentSessionId;
use agent_trigger::domain::broker_events::{
    AgentSessionRequestedEvent, AgentTriggerTopicEvent, NewAgentSessionEvent,
};
use bot_id::BotId;
use futures::StreamExt as _;
use macro_uuid::Uuid;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Notify, broadcast, mpsc};

use super::*;

const AGENT: BotId = BotId::TEST_A;
const REQUESTER: &str = "macro|requester@example.com";

/// The harness record `/harnesses/me` answers with: personal, so the stream
/// is user-scoped.
const HARNESS: &str = "{\"allow_permission_bypass\":false,\
     \"id\":\"00000000-0000-0000-0000-00000000000a\",\"kind\":\"macrod\",\"name\":\"computer\",\
     \"owner\":{\"type\":\"user\",\"user_id\":\"macro|buyer@example.com\"},\
     \"shared_team_ids\":[],\"created_by\":\"macro|buyer@example.com\",\
     \"created_at\":\"2026-11-01T00:00:00Z\",\"updated_at\":\"2026-11-01T00:00:00Z\",\
     \"connected\":true,\"last_connected_at\":null}";

/// The service side of one computer: its agent bindings, the agent-trigger
/// stream as the storage service serves it, and the runtime gateway.
struct ControlPlane {
    bound: std::sync::atomic::AtomicBool,
    /// Raised each time macrod reads its agents.
    agents_read: Notify,
    /// Every event published on the trigger topic, oldest first.
    published: Mutex<Vec<(Uuid, String)>>,
    live: broadcast::Sender<(Uuid, String)>,
    /// Bodies of the session creates macrod sends.
    creates: mpsc::UnboundedSender<String>,
    /// Streams are served only once this is true, so a test can publish
    /// before any stream that covers the agent exists.
    streams_open: tokio::sync::watch::Sender<bool>,
}

impl ControlPlane {
    /// Publish one trigger event: to every open stream, and to the log a
    /// stream resuming with `Last-Event-ID` replays.
    fn publish(&self, event: &macro_event_broker::Event<AgentTriggerTopicEvent>) {
        let mut published = self.published.lock().unwrap();
        let entry = (event.event_id, serde_json::to_string(event).unwrap());
        published.push(entry.clone());
        let _ = self.live.send(entry);
    }

    /// Subscribe to live events and take the logged ones after `cursor`:
    /// exactly after that event when it is logged, else from the time the
    /// UUIDv7 encodes.
    fn resume(
        &self,
        cursor: Option<Uuid>,
    ) -> (Vec<(Uuid, String)>, broadcast::Receiver<(Uuid, String)>) {
        let published = self.published.lock().unwrap();
        let live = self.live.subscribe();
        let Some(cursor) = cursor else {
            return (Vec::new(), live);
        };
        let replay = match published.iter().position(|(id, _)| *id == cursor) {
            Some(seen) => published[seen + 1..].to_vec(),
            None => published
                .iter()
                .filter(|(id, _)| minted(id) >= minted(&cursor))
                .cloned()
                .collect(),
        };
        (replay, live)
    }
}

/// When a UUIDv7 was minted, as Unix seconds and nanoseconds.
fn minted(id: &Uuid) -> Option<(u64, u32)> {
    id.get_timestamp().map(|timestamp| timestamp.to_unix())
}

struct Request {
    line: String,
    headers: HashMap<String, String>,
    body: String,
}

async fn read_request(socket: &mut TcpStream) -> Request {
    let mut buffer = Vec::new();
    let mut chunk = [0; 4096];
    let head_end = loop {
        let read = socket.read(&mut chunk).await.unwrap();
        assert!(read > 0, "the request ended before its head");
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(end) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            break end;
        }
    };
    let head = String::from_utf8_lossy(&buffer[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let line = lines.next().unwrap_or_default().to_owned();
    let headers: HashMap<String, String> = lines
        .filter_map(|header| header.split_once(':'))
        .map(|(name, value)| (name.trim().to_lowercase(), value.trim().to_owned()))
        .collect();
    let length: usize = headers
        .get("content-length")
        .map_or(0, |length| length.parse().unwrap());
    let mut body = buffer[head_end + 4..].to_vec();
    while body.len() < length {
        let read = socket.read(&mut chunk).await.unwrap();
        assert!(read > 0, "the request ended before its body");
        body.extend_from_slice(&chunk[..read]);
    }
    Request {
        line,
        headers,
        body: String::from_utf8_lossy(&body).into_owned(),
    }
}

async fn answer_json(socket: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\
         Connection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = socket.write_all(response.as_bytes()).await;
}

/// The storage service: agent bindings, the harness record, and the
/// agent-trigger SSE stream, which delivers an event only to a stream whose
/// filters name its agent.
async fn serve_storage(listener: TcpListener, plane: Arc<ControlPlane>) {
    loop {
        let Ok((mut socket, _)) = listener.accept().await else {
            return;
        };
        let plane = Arc::clone(&plane);
        tokio::spawn(async move {
            let request = read_request(&mut socket).await;
            if request.line.starts_with("GET /harnesses/me/agents ") {
                let agents = if plane.bound.load(std::sync::atomic::Ordering::SeqCst) {
                    format!("[{{\"bot_id\":\"{AGENT}\",\"name\":\"Agent\",\"handle\":\"agent\"}}]")
                } else {
                    "[]".to_owned()
                };
                answer_json(&mut socket, "200 OK", &agents).await;
                plane.agents_read.notify_one();
            } else if request.line.starts_with("GET /harnesses/me ") {
                answer_json(&mut socket, "200 OK", HARNESS).await;
            } else if request.line.starts_with("GET /webhook/events/stream?") {
                let covers_agent = request.line.contains(&AGENT.to_string());
                let cursor = request
                    .headers
                    .get("last-event-id")
                    .map(|cursor| Uuid::parse_str(cursor).expect("a cursor is an event id"));
                let mut open = plane.streams_open.subscribe();
                if open.wait_for(|open| *open).await.is_err() {
                    return;
                }
                let (replay, mut live) = plane.resume(cursor);
                let _ = socket
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\
                          Connection: close\r\n\r\n",
                    )
                    .await;
                if !covers_agent {
                    // Held open, delivering nothing this test publishes.
                    std::future::pending::<()>().await;
                }
                for (id, data) in replay {
                    let frame = format!("id: {id}\nevent: agent_trigger.new\ndata: {data}\n\n");
                    if socket.write_all(frame.as_bytes()).await.is_err() {
                        return;
                    }
                }
                while let Ok((id, data)) = live.recv().await {
                    let frame = format!("id: {id}\nevent: agent_trigger.new\ndata: {data}\n\n");
                    if socket.write_all(frame.as_bytes()).await.is_err() {
                        return;
                    }
                }
            } else {
                answer_json(&mut socket, "404 Not Found", "{}").await;
            }
        });
    }
}

/// The runtime gateway and the API behind the same address. The first
/// runtime dial is the computer reporting Ready: the control plane binds the
/// agent, tells the runtime its agents changed, and the requester prompts in
/// the same instant.
async fn serve_gateway(listener: TcpListener, plane: Arc<ControlPlane>, ready: Arc<Notify>) {
    loop {
        let Ok((mut socket, _)) = listener.accept().await else {
            return;
        };
        let mut start = [0; 15];
        let peeked = socket.peek(&mut start).await.unwrap_or(0);
        if start[..peeked].starts_with(b"GET /runtime/ws") {
            // The losing interleaving, made certain: macrod has read its
            // agents, found none, and only then does its runtime connect.
            plane.agents_read.notified().await;
            let mut runtime = tokio_tungstenite::accept_async(socket).await.unwrap();
            plane.bound.store(true, std::sync::atomic::Ordering::SeqCst);
            use futures::SinkExt as _;
            // Raw on the wire, so it reaches a macrod of any version.
            runtime
                .send(tokio_tungstenite::tungstenite::Message::Text(
                    "{\"type\":\"agentsChanged\"}".into(),
                ))
                .await
                .unwrap();
            ready.notify_one();
            tokio::spawn(async move { while let Some(Ok(_)) = runtime.next().await {} });
        } else {
            let plane = Arc::clone(&plane);
            tokio::spawn(async move {
                let request = read_request(&mut socket).await;
                if request.line.starts_with("POST /agent-sessions ") {
                    let _ = plane.creates.send(request.body);
                }
                answer_json(
                    &mut socket,
                    "503 Service Unavailable",
                    "{\"message\":\"test\"}",
                )
                .await;
            });
        }
    }
}

/// A daemon whose computer has just reported Ready: its agent is bound and
/// it has been told so. Returns the control plane and the session creates
/// the daemon sends. With `hold_streams`, no stream is served until the test
/// opens them.
async fn computer_ready(
    hold_streams: bool,
) -> (Daemon, Arc<ControlPlane>, mpsc::UnboundedReceiver<String>) {
    let gateway = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let storage = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut config: Config = toml::from_str(include_str!("../../../config.example.toml")).unwrap();
    config.macro_api.api_url = format!("http://{}", gateway.local_addr().unwrap());
    config.macro_api.storage_url = format!("http://{}", storage.local_addr().unwrap());
    config.workspace.path = std::env::current_dir().unwrap();
    config.workspace.repo_url = None;
    config.harness.command = "python3".to_owned();
    config.harness.args = vec!["-c".to_owned(), include_str!("../test_acp.py").to_owned()];
    let credentials = HarnessCredentials {
        harness_id: harness_id::HarnessId::TEST_A,
        token: "mhns_test".to_owned(),
        pairing_id: None,
    };

    let (creates, created) = mpsc::unbounded_channel();
    let plane = Arc::new(ControlPlane {
        bound: std::sync::atomic::AtomicBool::new(false),
        agents_read: Notify::new(),
        published: Mutex::new(Vec::new()),
        live: broadcast::channel(16).0,
        creates,
        streams_open: tokio::sync::watch::Sender::new(!hold_streams),
    });
    let ready = Arc::new(Notify::new());
    tokio::spawn(serve_storage(storage, Arc::clone(&plane)));
    tokio::spawn(serve_gateway(
        gateway,
        Arc::clone(&plane),
        Arc::clone(&ready),
    ));

    let daemon = Daemon::start(config, credentials, Path::new("macrod.toml"), None)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(5), ready.notified())
        .await
        .expect("the runtime connects");
    (daemon, plane, created)
}

/// The composer asking `AGENT` for a new session.
fn session_request(session: AgentSessionId) -> macro_event_broker::Event<AgentTriggerTopicEvent> {
    macro_event_broker::Event::new(AgentTriggerTopicEvent::New(
        NewAgentSessionEvent::Requested(AgentSessionRequestedEvent {
            repo_url: None,
            bot_id: AGENT,
            session_id: session,
            owner: REQUESTER.to_owned(),
            origin: trigger_context::TriggerOrigin::Unknown,
            context: None,
            runtime_user: Some("macro|buyer@example.com".to_owned()),
        }),
    ))
}

#[tokio::test]
async fn a_session_requested_the_instant_the_computer_is_ready_reaches_macrod() {
    let (daemon, plane, mut created) = computer_ready(true).await;
    let session = AgentSessionId::new_from_uuid(Uuid::now_v7());
    // Published before any stream that covers the agent is served, so only a
    // stream that replays it can deliver it.
    plane.publish(&session_request(session));
    plane.streams_open.send_replace(true);

    // Well inside the 10 s bound-agent poll: the requester is watching.
    let body = tokio::time::timeout(Duration::from_secs(5), created.recv())
        .await
        .expect("macrod creates the session requested the instant its computer was ready")
        .unwrap();
    let create: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(create["id"], session.to_string());
    assert_eq!(create["botId"], AGENT.as_uuid().to_string());

    daemon.stop().await;
}

/// A resumed stream may repeat events around its cursor, and one served by
/// another replica may repeat what the last one delivered. Each event is
/// still handled once.
#[tokio::test]
async fn an_event_delivered_twice_is_handled_once() {
    let (daemon, plane, mut created) = computer_ready(false).await;
    let request = session_request(AgentSessionId::new_from_uuid(Uuid::now_v7()));
    plane.publish(&request);
    tokio::time::timeout(Duration::from_secs(5), created.recv())
        .await
        .expect("the first delivery creates the session")
        .unwrap();

    plane.publish(&request);
    let later = AgentSessionId::new_from_uuid(Uuid::now_v7());
    plane.publish(&session_request(later));

    // In order on one stream: the next create is the later request's.
    let body = tokio::time::timeout(Duration::from_secs(5), created.recv())
        .await
        .expect("the later request creates its session")
        .unwrap();
    let create: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(
        create["id"],
        later.to_string(),
        "the repeat was handled again"
    );

    daemon.stop().await;
}
