use super::*;

#[tokio::test]
async fn stop_does_not_wait_for_in_flight_work() {
    let daemon = Daemon {
        cancel: CancellationToken::new(),
        task: tokio::spawn(std::future::pending()),
    };

    tokio::time::timeout(Duration::from_secs(1), daemon.stop())
        .await
        .expect("daemon shutdown should abort in-flight work");
}

#[tokio::test]
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
    let daemon = Daemon::start(config, credentials, Path::new("macrod.toml"))
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
