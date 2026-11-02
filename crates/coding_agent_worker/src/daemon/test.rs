use super::*;

#[tokio::test]
async fn stop_does_not_wait_for_in_flight_work() {
    let daemon = Daemon {
        cancel: CancellationToken::new(),
        task: tokio::spawn(std::future::pending()),
        turns: ActiveTurns::default(),
        handoff: crate::harness::Handoffs::channel().1,
    };

    tokio::time::timeout(Duration::from_secs(1), daemon.stop())
        .await
        .expect("daemon shutdown should abort in-flight work");
}

#[tokio::test]
#[expect(
    clippy::result_large_err,
    reason = "the handshake callback's error type is fixed by tungstenite's Callback trait"
)]
async fn startup_without_agents_serves_model_probes_and_stop_closes_the_runtime() {
    use agent_runtime_protocol::domain::schema::v0::{
        ModelProbeResult, SystemEvent, ToRuntimeMessage, ToServerMessage,
    };
    use futures::{SinkExt as _, StreamExt as _};
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::Message;

    let gateway = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let storage = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut config: Config = toml::from_str(include_str!("../../config.example.toml")).unwrap();
    config.macro_api.api_url = format!("http://{}", gateway.local_addr().unwrap());
    config.macro_api.storage_url = format!("http://{}", storage.local_addr().unwrap());
    config.workspace.path = std::env::current_dir().unwrap();
    config.harness.command = "python3".to_owned();
    config.harness.args = vec!["-c".to_owned(), include_str!("test_acp.py").to_owned()];
    let credentials = HarnessCredentials {
        harness_id: harness_id::HarnessId::TEST_A,
        token: "mhns_test".to_owned(),
        scope: crate::config::HarnessScope::User,
    };
    let storage_task = tokio::spawn(async move {
        let (mut socket, _) = storage.accept().await.unwrap();
        let mut request = [0; 4096];
        let read = socket.read(&mut request).await.unwrap();
        assert!(String::from_utf8_lossy(&request[..read]).contains("/harnesses/me/agents"));
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]").await.unwrap();
    });
    let daemon = Daemon::start(config, credentials, Path::new("macrod.toml"), None)
        .await
        .unwrap();
    let (socket, _) = tokio::time::timeout(Duration::from_secs(2), gateway.accept())
        .await
        .expect("the runtime must connect before an agent exists")
        .unwrap();
    let mut socket = tokio_tungstenite::accept_hdr_async(
        socket,
        |request: &tokio_tungstenite::tungstenite::handshake::server::Request, response| {
            assert_eq!(request.uri().path(), "/runtime/ws");
            assert_eq!(request.headers()["x-macro-harness-token"], "mhns_test");
            Ok(response)
        },
    )
    .await
    .unwrap();
    storage_task.await.unwrap();
    socket
        .send(Message::Text(
            serde_json::to_string(&ToRuntimeMessage::ModelProbeRequest)
                .unwrap()
                .into(),
        ))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        let mut ready = false;
        loop {
            if let Message::Text(text) = socket.next().await.unwrap().unwrap() {
                match serde_json::from_str::<ToServerMessage>(&text).unwrap() {
                    ToServerMessage::Event {
                        event: SystemEvent::AcpReady,
                    } => ready = true,
                    ToServerMessage::ModelProbeResponse { result } => {
                        assert!(
                            ready,
                            "the bridge must announce itself before answering probes"
                        );
                        let ModelProbeResult::Available { config_options } = result else {
                            panic!("model discovery failed: {result:?}");
                        };
                        let options = serde_json::to_value(config_options).unwrap();
                        assert_eq!(options[0]["currentValue"], "test-model");
                        break;
                    }
                    message => panic!("unexpected runtime message: {message:?}"),
                }
            }
        }
    })
    .await
    .expect("model discovery must work before any trigger");

    daemon.stop().await;
    tokio::time::timeout(Duration::from_secs(2), async {
        while let Some(Ok(_)) = socket.next().await {}
    })
    .await
    .expect("stopping must close the runtime socket");
    assert!(
        tokio::time::timeout(Duration::from_millis(1100), gateway.accept())
            .await
            .is_err(),
        "stopped daemon must not reconnect"
    );
}

/// A runtime gateway and storage stand-in for one daemon: storage answers
/// every request with no bound agents.
#[cfg(unix)]
async fn serve_storage(storage: tokio::net::TcpListener) {
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
    loop {
        let Ok((mut socket, _)) = storage.accept().await else {
            return;
        };
        tokio::spawn(async move {
            let mut request = [0; 4096];
            let _ = socket.read(&mut request).await;
            let _ = socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]").await;
        });
    }
}

#[cfg(unix)]
#[tokio::test]
async fn a_handed_off_agent_keeps_running_and_streaming_under_the_next_daemon() {
    use agent_runtime_protocol::domain::schema::v0::{
        AcpMessage, SystemEvent, ToRuntimeMessage, ToServerMessage,
    };
    use futures::{SinkExt as _, StreamExt as _};
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::Message;

    let gateway = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let storage = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut config: Config = toml::from_str(include_str!("../../config.example.toml")).unwrap();
    config.macro_api.api_url = format!("http://{}", gateway.local_addr().unwrap());
    config.macro_api.storage_url = format!("http://{}", storage.local_addr().unwrap());
    config.workspace.path = std::env::current_dir().unwrap();
    config.harness.command = "python3".to_owned();
    config.harness.args = vec!["-c".to_owned(), include_str!("test_ticker.py").to_owned()];
    let credentials = HarnessCredentials {
        harness_id: harness_id::HarnessId::TEST_A,
        token: "mhns_test".to_owned(),
        scope: crate::config::HarnessScope::User,
    };
    tokio::spawn(serve_storage(storage));

    /// Read frames into `ticks` (`(n, pid)`) until `limit` new ticks arrived
    /// or `until` accepts a frame.
    async fn read_ticks(
        socket: &mut tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
        ticks: &mut Vec<(u64, u64)>,
        limit: usize,
        mut until: impl FnMut(&ToServerMessage) -> bool,
    ) {
        let start = ticks.len();
        tokio::time::timeout(Duration::from_secs(10), async {
            while let Some(Ok(frame)) = socket.next().await {
                let Message::Text(text) = frame else { continue };
                let message: ToServerMessage = serde_json::from_str(&text).unwrap();
                if let ToServerMessage::Acp(AcpMessage(raw)) = &message {
                    let value = serde_json::to_value(raw).unwrap();
                    if value["method"] == "tick" {
                        ticks.push((
                            value["params"]["n"].as_u64().unwrap(),
                            value["params"]["pid"].as_u64().unwrap(),
                        ));
                    }
                }
                if until(&message) || ticks.len() - start >= limit {
                    return;
                }
            }
        })
        .await
        .expect("the gateway kept receiving frames");
    }

    let first = Daemon::start(
        config.clone(),
        credentials.clone(),
        Path::new("macrod.toml"),
        None,
    )
    .await
    .unwrap();
    let (socket, _) = gateway.accept().await.unwrap();
    let mut socket = tokio_tungstenite::accept_async(socket).await.unwrap();
    let mut ticks = Vec::new();
    read_ticks(&mut socket, &mut ticks, 50, |_| false).await;

    // Hand off while the agent streams. The first socket carries every line
    // read before the stop, then the disconnect, then closes.
    let handing_off = tokio::spawn(first.hand_off());
    let mut disconnected = false;
    read_ticks(&mut socket, &mut ticks, usize::MAX, |message| {
        disconnected = matches!(
            message,
            ToServerMessage::Event {
                event: SystemEvent::Disconnected
            }
        );
        disconnected
    })
    .await;
    assert!(disconnected, "the handoff announces the disconnect");
    let agent = handing_off
        .await
        .unwrap()
        .expect("the running agent is handed off");
    let handed_pid = u64::try_from(agent.pid().as_raw_nonzero().get()).unwrap();

    let second = Daemon::start(config, credentials, Path::new("macrod.toml"), Some(agent))
        .await
        .unwrap();
    let (socket, _) = gateway.accept().await.unwrap();
    let mut socket = tokio_tungstenite::accept_async(socket).await.unwrap();
    read_ticks(&mut socket, &mut ticks, 50, |_| false).await;

    // No tick lost or repeated across the two relays, and one agent process
    // produced them all.
    for (index, (n, _)) in ticks.iter().enumerate() {
        assert_eq!(
            *n, index as u64,
            "tick {index} arrived out of order or was lost"
        );
    }
    assert!(ticks.iter().all(|(_, pid)| *pid == handed_pid));

    // The adopted agent still takes requests.
    socket
        .send(Message::Text(
            serde_json::to_string(&ToRuntimeMessage::Acp(AcpMessage(
                serde_json::from_value(
                    serde_json::json!({"jsonrpc": "2.0", "id": 1, "method": "echo"}),
                )
                .unwrap(),
            )))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
    let mut echoed = false;
    read_ticks(&mut socket, &mut ticks, usize::MAX, |message| {
        let ToServerMessage::Acp(AcpMessage(raw)) = message else {
            return false;
        };
        let value = serde_json::to_value(raw).unwrap();
        echoed = value["id"] == 1 && value["result"]["echo"] == "echo";
        echoed
    })
    .await;
    assert!(echoed);

    second.stop().await;
}
