use super::*;
use aws_sdk_sqs::config::{BehaviorVersion, Credentials, Region};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn client_with_response(status: &str, body: &str) -> aws_sdk_sqs::Client {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/x-amz-json-1.0\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0; 8192];
        socket.read(&mut request).await.unwrap();
        socket.write_all(response.as_bytes()).await.unwrap();
    });
    let config = aws_sdk_sqs::Config::builder()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new("us-east-1"))
        .credentials_provider(Credentials::new("test", "test", None, None, "test"))
        .endpoint_url(format!("http://{address}"))
        .build();
    aws_sdk_sqs::Client::from_conf(config)
}

#[tokio::test]
async fn failed_receive_is_delayed_before_returning_the_error() {
    let client = client_with_response(
        "400 Bad Request",
        r#"{"__type":"AWS.SimpleQueueService.NonExistentQueue","message":"missing queue"}"#,
    )
    .await;
    let start = tokio::time::Instant::now();

    let error = receive_messages(&client, "http://localstack:4566/queue", 1, 0)
        .await
        .unwrap_err();

    assert!(start.elapsed() >= RECEIVE_ERROR_DELAY);
    assert!(format!("{error:?}").contains("missing queue"));
}

#[tokio::test]
async fn successful_empty_receive_returns_without_the_error_delay() {
    let client = client_with_response("200 OK", r#"{"Messages":[]}"#).await;

    let messages = tokio::time::timeout(
        Duration::from_secs(2),
        receive_messages(&client, "http://localstack:4566/queue", 1, 0),
    )
    .await
    .expect("successful receives must not wait for the error delay")
    .unwrap();

    assert!(messages.is_empty());
}
