use super::*;
use crate::test_support::{Reply, serve_script};

async fn delete_answered_with(body: &'static str) -> Result<()> {
    let (url, server) = serve_script(vec![
        Reply::Respond(
            "200 OK",
            r#"{"_shards":{"total":1,"successful":1,"failed":0}}"#,
        ),
        Reply::Respond("200 OK", body),
    ]);
    let client = crate::OpensearchClient::new(url, String::new(), String::new()).unwrap();
    let result = delete_matching(
        &client.inner,
        "chats",
        serde_json::json!({ "match_all": {} }),
        OpensearchOperation::DeleteChatById,
    )
    .await;
    let requests = server.join().unwrap();
    assert_eq!(
        requests
            .iter()
            .map(|(line, _)| line.split(' ').take(2).collect::<Vec<_>>().join(" "))
            .collect::<Vec<_>>(),
        [
            "GET /chats/_refresh",
            "POST /chats/_delete_by_query?refresh=true"
        ],
        "the index is refreshed before the delete searches it"
    );
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

#[tokio::test]
async fn a_cancelled_delete_fails() {
    assert!(
        delete_answered_with(
            r#"{"deleted":1,"timed_out":false,"canceled":"by user request","failures":[]}"#
        )
        .await
        .is_err()
    );
}
