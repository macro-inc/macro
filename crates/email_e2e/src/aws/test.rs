use axum::http::StatusCode;

use super::{Aws, SQS_TARGET};

/// A refused send is answered by the endpoint and never reaches the SQS
/// server; the send after it is passed on.
#[tokio::test]
async fn a_refused_send_is_answered_once() {
    // Nothing listens here, so a request that is passed on answers 502.
    let aws = Aws::start("http://127.0.0.1:1", crate::evidence::Recorder::default())
        .await
        .unwrap();
    let queue_url = "http://127.0.0.1:1/000000000000/scheduled";
    aws.refuse_sends(queue_url, 1);

    let http = reqwest::Client::new();
    let send = || {
        http.post(aws.url())
            .header(SQS_TARGET, "AmazonSQS.SendMessage")
            .json(&serde_json::json!({ "QueueUrl": queue_url, "MessageBody": "{}" }))
            .send()
    };
    let other_queue = http
        .post(aws.url())
        .header(SQS_TARGET, "AmazonSQS.SendMessage")
        .json(&serde_json::json!({ "QueueUrl": "http://127.0.0.1:1/000000000000/other" }))
        .send()
        .await
        .unwrap();
    assert_eq!(other_queue.status(), StatusCode::BAD_GATEWAY);

    let refused = send().await.unwrap();
    assert_eq!(refused.status(), StatusCode::BAD_REQUEST);
    assert!(refused.text().await.unwrap().contains("KmsAccessDenied"));
    assert_eq!(send().await.unwrap().status(), StatusCode::BAD_GATEWAY);

    aws.stop().await;
}

/// A batch delete removes the objects it names and leaves the others.
#[tokio::test]
async fn a_batch_delete_removes_the_named_objects() {
    let aws = Aws::start("http://127.0.0.1:1", crate::evidence::Recorder::default())
        .await
        .unwrap();
    let http = reqwest::Client::new();
    for key in ["a&b.txt", "kept.txt", "dir/c.txt"] {
        let url = format!("{}/bucket/{}", aws.url(), urlencoding::encode(key));
        let stored = http.put(url).body("x").send().await.unwrap();
        assert_eq!(stored.status(), StatusCode::OK);
    }

    let deleted = http
        .post(format!("{}/bucket?delete", aws.url()))
        .body(
            "<Delete><Object><Key>a&amp;b.txt</Key></Object>\
             <Object><Key>dir/c.txt</Key></Object></Delete>",
        )
        .send()
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::OK);
    assert!(deleted.text().await.unwrap().contains("DeleteResult"));

    let left: Vec<String> = aws.objects().into_iter().map(|object| object.key).collect();
    assert_eq!(left, ["kept.txt"]);

    aws.stop().await;
}
