use super::*;
use crate::test_support::serve_once;

async fn delete_answered_with(body: &'static str) -> Result<()> {
    let (url, server) = serve_once("200 OK", body);
    let client = crate::OpensearchClient::new(url, String::new(), String::new()).unwrap();
    let result = delete_matching(
        &client.inner,
        "chats",
        serde_json::json!({ "match_all": {} }),
        OpensearchOperation::DeleteChatById,
    )
    .await;
    server.join().unwrap();
    result
}

#[tokio::test]
async fn a_delete_that_deleted_everything_matched_succeeds() {
    delete_answered_with(r#"{"deleted":3,"timed_out":false,"failures":[]}"#)
        .await
        .unwrap();
}

#[tokio::test]
async fn a_delete_with_failed_documents_fails() {
    assert!(
        delete_answered_with(
            r#"{"deleted":1,"timed_out":false,"failures":[{"index":"chats","id":"c:m","cause":{"type":"es_rejected_execution_exception"},"status":429}]}"#
        )
        .await
        .is_err()
    );
}

#[tokio::test]
async fn a_delete_that_timed_out_fails() {
    assert!(
        delete_answered_with(r#"{"deleted":1,"timed_out":true,"failures":[]}"#)
            .await
            .is_err()
    );
}
