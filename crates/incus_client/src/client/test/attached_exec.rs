use std::collections::HashMap;

use futures::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::{WebSocketStream, accept_hdr_async};

use super::*;
use crate::attached_exec::ExecSecrets;

const OPERATION: &str = "5b7c2e10-3333-4e4e-8a8a-dddddddddddd";

fn timeouts() -> IncusTimeouts {
    IncusTimeouts {
        request: Duration::from_secs(90),
        connect: Duration::from_secs(10),
        operation_wait_secs: 60,
        operation_waits: 15,
        state_change_secs: 60,
    }
}

fn harnessd() -> ExecCommand {
    ExecCommand {
        command: vec!["harnessd".to_owned()],
        environment: BTreeMap::from([
            ("HOME".to_owned(), "/home/macro".to_owned()),
            (
                "PATH".to_owned(),
                "/run/wrappers/bin:/run/current-system/sw/bin".to_owned(),
            ),
        ]),
        user: 1000,
        group: 1000,
        cwd: "/home/macro".to_owned(),
    }
}

/// Answers the exec POST with the four websocket secrets, and the operation
/// wait with `exit_code`.
async fn exec_operation(exit_code: i64) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(
            "/1.0/instances/mc-01900000000070008000000000000001/exec",
        ))
        .and(body_json(json!({
            "command": ["harnessd"],
            "environment": {
                "HOME": "/home/macro",
                "PATH": "/run/wrappers/bin:/run/current-system/sw/bin"
            },
            "user": 1000,
            "group": 1000,
            "cwd": "/home/macro",
            "interactive": false,
            "wait-for-websocket": true,
            "record-output": false
        })))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({
            "type": "async",
            "status": "Operation created",
            "status_code": 100,
            "operation": "/1.0/operations/5b7c2e10-3333-4e4e-8a8a-dddddddddddd",
            "error_code": 0,
            "error": "",
            "metadata": {
                "id": "5b7c2e10-3333-4e4e-8a8a-dddddddddddd",
                "class": "websocket",
                "description": "Executing command",
                "status": "Running",
                "status_code": 103,
                "resources": {"instances": ["/1.0/instances/mc-01900000000070008000000000000001"]},
                "metadata": {
                    "command": ["harnessd"],
                    "environment": {"HOME": "/home/macro"},
                    "fds": {
                        "0": "secret-stdin",
                        "1": "secret-stdout",
                        "2": "secret-stderr",
                        "control": "secret-control"
                    },
                    "interactive": false
                },
                "may_cancel": false,
                "err": "",
                "location": "none"
            }
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(
            "/1.0/operations/5b7c2e10-3333-4e4e-8a8a-dddddddddddd/wait",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "type": "sync",
            "status": "Success",
            "status_code": 200,
            "metadata": {
                "id": "5b7c2e10-3333-4e4e-8a8a-dddddddddddd",
                "class": "websocket",
                "status": "Success",
                "status_code": 200,
                "metadata": {"return": exit_code},
                "err": ""
            }
        })))
        .mount(&server)
        .await;
    server
}

/// Accepts the four exec websockets, keyed by the secret each one presents.
async fn accept_websockets(listener: &TcpListener) -> HashMap<String, WebSocketStream<TcpStream>> {
    let mut sockets = HashMap::new();
    for _ in 0..4 {
        let (stream, _) = listener.accept().await.unwrap();
        let mut target = String::new();
        let socket = accept_hdr_async(stream, |request: &Request, response: Response| {
            target = request.uri().to_string();
            Ok::<_, ErrorResponse>(response)
        })
        .await
        .unwrap();
        let secret = target
            .strip_prefix("/1.0/operations/5b7c2e10-3333-4e4e-8a8a-dddddddddddd/websocket?secret=")
            .unwrap_or_else(|| panic!("unexpected websocket target {target}"))
            .to_owned();
        sockets.insert(secret, socket);
    }
    sockets
}

async fn read_until_close(socket: &mut WebSocketStream<TcpStream>) -> Vec<u8> {
    let mut received = Vec::new();
    while let Some(message) = socket.next().await {
        match message.unwrap() {
            Message::Binary(bytes) => received.extend_from_slice(&bytes),
            Message::Close(_) => break,
            other => panic!("unexpected stdin message {other:?}"),
        }
    }
    received
}

#[test]
fn exec_secrets_come_from_the_operation_metadata() {
    let operation: types::Operation = serde_json::from_value(json!({
        "id": "5b7c2e10-3333-4e4e-8a8a-dddddddddddd",
        "status_code": 103,
        "metadata": {
            "fds": {
                "0": "secret-stdin",
                "1": "secret-stdout",
                "2": "secret-stderr",
                "control": "secret-control"
            }
        }
    }))
    .unwrap();

    assert_eq!(
        exec_secrets(&operation).unwrap(),
        ExecSecrets {
            stdin: "secret-stdin".to_owned(),
            stdout: "secret-stdout".to_owned(),
            stderr: "secret-stderr".to_owned(),
            control: "secret-control".to_owned(),
        }
    );

    let without_control: types::Operation = serde_json::from_value(json!({
        "id": "5b7c2e10-3333-4e4e-8a8a-dddddddddddd",
        "status_code": 103,
        "metadata": {"fds": {"0": "secret-stdin", "1": "secret-stdout", "2": "secret-stderr"}}
    }))
    .unwrap();
    assert!(matches!(
        exec_secrets(&without_control),
        Err(IncusError::MalformedResponse(message)) if message == "missing exec control secret"
    ));
}

#[test]
fn websocket_urls_follow_the_api_scheme() {
    assert_eq!(
        operation_websocket_url("https://10.200.0.2:8443", OPERATION, "secret-stdin").unwrap(),
        "wss://10.200.0.2:8443/1.0/operations/5b7c2e10-3333-4e4e-8a8a-dddddddddddd/websocket?secret=secret-stdin"
    );
    assert_eq!(
        operation_websocket_url("http://127.0.0.1:4000/", OPERATION, "secret-stdin").unwrap(),
        "ws://127.0.0.1:4000/1.0/operations/5b7c2e10-3333-4e4e-8a8a-dddddddddddd/websocket?secret=secret-stdin"
    );
}

#[tokio::test]
async fn attached_exec_bridges_stdin_and_stdout_and_waits_for_the_exit_code() {
    let server = exec_operation(3).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let websocket_base = format!("http://{}", listener.local_addr().unwrap());
    let guest = async {
        let mut sockets = accept_websockets(&listener).await;
        let mut stdin = sockets.remove("secret-stdin").unwrap();
        let mut stdout = sockets.remove("secret-stdout").unwrap();
        let mut stderr = sockets.remove("secret-stderr").unwrap();
        let control = sockets.remove("secret-control").unwrap();
        let received = read_until_close(&mut stdin).await;
        stdout.send(Message::binary(received)).await.unwrap();
        stdout.close(None).await.unwrap();
        stderr
            .send(Message::binary(b"harnessd: no such agent\n".to_vec()))
            .await
            .unwrap();
        stderr.close(None).await.unwrap();
        control
    };
    let client = IncusClient::with_http_client(&server.uri(), reqwest::Client::new(), timeouts())
        .with_websocket_base(websocket_base);
    let run = async {
        let mut process = client
            .exec_attached(
                &InstanceName::try_new("mc-01900000000070008000000000000001").unwrap(),
                harnessd(),
            )
            .await
            .unwrap();
        process
            .stdin
            .write_all(b"{\"command\":\"status\",\"agent\":\"claude\"}\n")
            .await
            .unwrap();
        process.stdin.shutdown().await.unwrap();
        let mut stdout = String::new();
        process.stdout.read_to_string(&mut stdout).await.unwrap();
        let mut stderr = String::new();
        process.stderr.read_to_string(&mut stderr).await.unwrap();
        (stdout, stderr, process.exit.await.unwrap())
    };

    let (_control, (stdout, stderr, exit_code)) = tokio::join!(guest, run);

    assert_eq!(stdout, "{\"command\":\"status\",\"agent\":\"claude\"}\n");
    assert_eq!(stderr, "harnessd: no such agent\n");
    assert_eq!(exit_code, 3);
}

#[tokio::test]
async fn dropping_an_attached_exec_ends_the_programs_stdin() {
    let server = exec_operation(0).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let websocket_base = format!("http://{}", listener.local_addr().unwrap());
    let client = IncusClient::with_http_client(&server.uri(), reqwest::Client::new(), timeouts())
        .with_websocket_base(websocket_base);
    let (process, mut sockets) = tokio::join!(
        client.exec_attached(
            &InstanceName::try_new("mc-01900000000070008000000000000001").unwrap(),
            harnessd(),
        ),
        accept_websockets(&listener),
    );

    drop(process.unwrap());

    let mut stdin = sockets.remove("secret-stdin").unwrap();
    assert_eq!(read_until_close(&mut stdin).await, b"");
}
