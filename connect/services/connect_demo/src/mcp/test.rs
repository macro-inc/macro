use super::*;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

#[tokio::test]
async fn reads_sse_result_before_stream_closes() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (release, wait_for_release) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0_u8; 1024];
        socket.read_exact(&mut request[..1]).await.unwrap();
        let event =
            "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[]}}\n\n";
        socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{event}\r\n", event.len()).as_bytes()).await.unwrap();
        wait_for_release.await.unwrap();
        socket.write_all(b"0\r\n\r\n").await.unwrap();
    });
    let client = ConnectClient::new(&format!("http://{address}"), "test-key").unwrap();
    let upstream = client.mcp_upstream("user", "app");
    let http = reqwest::Client::new();
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        request(
            &http,
            &upstream,
            None,
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
        ),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(result, json!({"tools":[]}));
    release.send(()).unwrap();
    server.await.unwrap();
}
