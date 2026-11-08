use std::time::Duration;

use super::http_client;

#[tokio::test]
async fn a_service_that_never_answers_times_out() {
    // Accepts the connection, then never writes a byte.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let _server = tokio::spawn(async move {
        let mut held = Vec::new();
        while let Ok((stream, _)) = listener.accept().await {
            held.push(stream);
        }
    });
    let client = http_client(Duration::from_millis(200)).unwrap();
    let error = tokio::time::timeout(
        Duration::from_secs(10),
        client.get(format!("http://{address}/harnesses/me")).send(),
    )
    .await
    .expect("the client's own timeout should fire first")
    .unwrap_err();
    assert!(error.is_timeout(), "{error}");
}
