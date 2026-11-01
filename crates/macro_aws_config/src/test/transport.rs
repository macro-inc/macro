//! Exercise the SDK's selected default connector, not an injected HTTP client.
//! Only loopback servers and the SDK's test credentials are used.

use super::*;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

#[cfg(feature = "s3")]
#[tokio::test]
async fn s3_default_transport_works_without_the_legacy_rustls_feature() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            "<ListAllMyBucketsResult><Buckets><Bucket><Name>fixture-bucket</Name></Bucket></Buckets></ListAllMyBucketsResult>",
            "application/xml",
        ))
        .expect(1)
        .mount(&server)
        .await;
    let config = local_aws_config(&server.uri()).await;
    let client = aws_sdk_s3::Client::from_conf(
        aws_sdk_s3::config::Builder::from(&config)
            .force_path_style(true)
            .build(),
    );
    let result = client.list_buckets().send().await.unwrap();
    assert_eq!(result.buckets().len(), 1);
    assert_eq!(result.buckets()[0].name(), Some("fixture-bucket"));
}

#[cfg(feature = "sqs")]
#[tokio::test]
async fn sqs_default_transport_works_without_the_legacy_rustls_feature() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/"))
        .and(wiremock::matchers::header(
            "x-amz-target",
            "AmazonSQS.ListQueues",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            r#"{"QueueUrls":["http://localhost/fixture-queue"]}"#,
            "application/x-amz-json-1.0",
        ))
        .expect(1)
        .mount(&server)
        .await;
    let config = local_aws_config(&server.uri()).await;
    let client = aws_sdk_sqs::Client::new(&config);
    let result = client.list_queues().send().await.unwrap();
    assert_eq!(result.queue_urls(), ["http://localhost/fixture-queue"]);
}
