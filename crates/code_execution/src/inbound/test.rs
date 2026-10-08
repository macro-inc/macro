use super::*;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Error, client::IntoClientRequest},
};

struct NeverRun;
#[async_trait::async_trait]
impl CodeRunner for NeverRun {
    async fn run(
        &self,
        _job: ExecutionJob,
        _events: &mut EventSink,
        _replies: tokio::sync::mpsc::Receiver<HostReply>,
        _cancellation: tokio_util::sync::CancellationToken,
    ) -> Outcome {
        panic!("unauthenticated request must not execute");
    }
}

#[tokio::test]
async fn rejects_missing_and_incorrect_credentials_before_upgrade() {
    let service = ExecutionService::new(Arc::new(NeverRun), Limits::default()).unwrap();
    let app = router(
        service.clone(),
        ServiceToken::new("test-token-long-enough-for-runner-auth".into()).unwrap(),
        4,
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("ws://{}/v1/execute", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    for token in [None, Some("Bearer incorrect-token-long-enough-for-auth")] {
        let mut request = endpoint.as_str().into_client_request().unwrap();
        if let Some(token) = token {
            request
                .headers_mut()
                .insert("authorization", token.parse().unwrap());
        }
        match connect_async(request).await {
            Err(Error::Http(response)) => assert_eq!(response.status(), StatusCode::UNAUTHORIZED),
            _ => panic!("invalid token was not rejected with HTTP 401"),
        }
    }
    server.abort();
    service.shutdown().await;
}
