use super::*;
use std::time::Duration;

#[tokio::test]
async fn connection_failure_has_monitorable_context_and_preserves_cause() {
    // Reserve a port without listening so connection attempts are refused.
    let socket = tokio::net::TcpSocket::new_v4().unwrap();
    socket.bind("127.0.0.1:0".parse().unwrap()).unwrap();
    let client = ReqwestEditingWorkerClient::new(
        format!("http://{}", socket.local_addr().unwrap()),
        Arc::new(
            Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap(),
        ),
    );

    let error = client
        .edit(
            "test-document",
            &"test-token".to_owned().into(),
            "edit",
            EditMode::Supervised,
            None,
        )
        .await
        .err()
        .expect("a connection to a port that is not listening must fail");

    assert_eq!(error.to_string(), "editing worker request failed");
    assert!(error.downcast_ref::<reqwest::Error>().unwrap().is_connect());
}

#[tokio::test]
async fn timeout_has_monitorable_context_and_preserves_cause() {
    // Keep the connection queued without serving a response.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let client = ReqwestEditingWorkerClient::new(
        format!("http://{}", listener.local_addr().unwrap()),
        Arc::new(
            Client::builder()
                .no_proxy()
                .timeout(Duration::from_millis(100))
                .build()
                .unwrap(),
        ),
    );

    let error = client
        .edit(
            "test-document",
            &"test-token".to_owned().into(),
            "edit",
            EditMode::Supervised,
            None,
        )
        .await
        .err()
        .expect("a worker that never responds must time out");

    assert_eq!(error.to_string(), "editing worker request failed");
    assert!(error.downcast_ref::<reqwest::Error>().unwrap().is_timeout());
}
