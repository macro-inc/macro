use super::*;
use crate::{
    OpensearchClient,
    date_format::EpochMillis,
    test_support::{
        LOCAL_OPENSEARCH, count, delete_index, refresh, scratch_index_like, serve_once,
    },
    upsert::chat_message::UpsertChatMessageArgs,
};

fn message(chat_id: &str, message_id: &str) -> IndexedChatMessage {
    IndexedChatMessage {
        chat_id: chat_id.to_owned(),
        message_id: message_id.to_owned(),
    }
}

#[tokio::test]
async fn a_page_reads_message_documents_in_message_id_order() {
    let (url, server) = serve_once(
        "200 OK",
        r#"{"_shards":{"total":3,"successful":3,"failed":0},"hits":{"hits":[
            {"_index":"chats_v2","_id":"chat-1:message-a","_routing":"chat-1","sort":["message-a"]},
            {"_index":"chats_v2","_id":"chat-2:message-b","_routing":"chat-2","sort":["message-b"]}
        ]}}"#,
    );
    let client = OpensearchClient::new(url, String::new(), String::new()).unwrap();

    let page = chat_messages_after(&client.inner, "chats", Some("message-0"), 2)
        .await
        .unwrap();

    let (request_line, body) = server.join().unwrap();
    assert!(
        request_line.starts_with("POST /chats/_search"),
        "{request_line}"
    );
    let body: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(
        body,
        serde_json::json!({
            "size": 2,
            "_source": false,
            "track_total_hits": false,
            "query": { "term": { "chat_relation": "message" } },
            "sort": [{ "entity_id": "asc" }],
            "search_after": ["message-0"],
        })
    );
    assert_eq!(
        page,
        [
            message("chat-1", "message-a"),
            message("chat-2", "message-b")
        ]
    );
}

#[test]
fn a_page_missing_a_shard_is_an_error() {
    let body = r#"{"_shards":{"total":3,"successful":2,"failed":1},"hits":{"hits":[]}}"#;

    assert!(parse_chat_message_page(body).is_err());
}

#[test]
fn a_page_that_timed_out_is_an_error() {
    let body = r#"{"timed_out":true,"_shards":{"total":3,"successful":3,"failed":0},"hits":{"hits":[
        {"_id":"chat-1:message-a","_routing":"chat-1","sort":["message-a"]}
    ]}}"#;

    assert!(parse_chat_message_page(body).is_err());
}

#[test]
fn a_hit_without_routing_is_an_error() {
    let body = r#"{"_shards":{"failed":0},"hits":{"hits":[
        {"_id":"chat-1:message-a","sort":["message-a"]}
    ]}}"#;

    assert!(parse_chat_message_page(body).is_err());
}

#[test]
fn a_hit_whose_id_does_not_match_its_chat_and_message_is_an_error() {
    let body = r#"{"_shards":{"failed":0},"hits":{"hits":[
        {"_id":"chat-1","_routing":"chat-1","sort":["chat-1"]}
    ]}}"#;

    assert!(parse_chat_message_page(body).is_err());
}

#[tokio::test]
async fn a_delete_routes_each_message_to_its_chat_and_counts_what_happened() {
    let (url, server) = serve_once(
        "200 OK",
        r#"{"errors":true,"items":[
            {"delete":{"_id":"chat-1:message-a","status":200,"result":"deleted"}},
            {"delete":{"_id":"chat-1:message-b","status":404,"result":"not_found"}},
            {"delete":{"_id":"chat-2:message-c","status":200,"result":"deleted"}}
        ]}"#,
    );
    let client = OpensearchClient::new(url, String::new(), String::new()).unwrap();

    let result = delete_chat_messages(
        &client.inner,
        "chats",
        &[
            message("chat-1", "message-a"),
            message("chat-1", "message-b"),
            message("chat-2", "message-c"),
        ],
    )
    .await
    .unwrap();

    let (request_line, body) = server.join().unwrap();
    assert!(
        request_line.starts_with("POST /chats/_bulk"),
        "{request_line}"
    );
    let actions: Vec<serde_json::Value> = body
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(
        actions,
        [
            serde_json::json!({"delete": {"_id": "chat-1:message-a", "routing": "chat-1"}}),
            serde_json::json!({"delete": {"_id": "chat-1:message-b", "routing": "chat-1"}}),
            serde_json::json!({"delete": {"_id": "chat-2:message-c", "routing": "chat-2"}}),
        ]
    );
    assert_eq!(
        result,
        ChatMessageDeleteResult {
            deleted: 2,
            not_found: 1,
        }
    );
}

#[test]
fn a_failed_delete_item_fails_the_batch() {
    let body = r#"{"errors":true,"items":[
        {"delete":{"_id":"chat-1:message-a","status":200,"result":"deleted"}},
        {"delete":{"_id":"chat-2:message-c","status":409,"error":{"type":"version_conflict_engine_exception","reason":"conflict"}}}
    ]}"#;

    let error = classify_delete_response(200, body).unwrap_err();

    let OpensearchClientError::BulkItemsFailed {
        failed,
        total,
        refusal,
        ref errors,
        ..
    } = error
    else {
        panic!("expected failed items, got {error:?}");
    };
    assert_eq!((failed, total, refusal), (1, 2, None));
    assert_eq!(errors, &["version_conflict_engine_exception: conflict"]);
}

#[test]
fn a_refused_delete_item_refuses_the_batch() {
    let body = r#"{"errors":true,"items":[
        {"delete":{"_id":"chat-1:message-a","status":200,"result":"deleted"}},
        {"delete":{"_id":"chat-1:message-b","status":429,"error":{"type":"es_rejected_execution_exception"}}}
    ]}"#;

    let error = classify_delete_response(200, body).unwrap_err();

    assert!(
        matches!(error, OpensearchClientError::BulkItemsFailed { .. }) && error.refusal().is_some(),
        "{error:?}"
    );
}

#[test]
fn a_blocked_index_refuses_the_delete() {
    let body = r#"{"error":{"type":"cluster_block_exception","reason":"index [chats_v2] blocked by: [TOO_MANY_REQUESTS/12/disk usage exceeded flood-stage watermark, index has read-only-allow-delete block];"},"status":429}"#;

    assert!(matches!(
        classify_delete_response(429, body),
        Err(OpensearchClientError::WritesRefused { .. })
    ));
}

#[tokio::test]
async fn an_empty_batch_sends_nothing() {
    let client =
        OpensearchClient::new("http://127.0.0.1:9".into(), String::new(), String::new()).unwrap();

    let result = delete_chat_messages(&client.inner, "chats", &[])
        .await
        .unwrap();

    assert_eq!(result, ChatMessageDeleteResult::default());
}

fn upsert(chat_id: &str, message_id: &str) -> UpsertChatMessageArgs {
    UpsertChatMessageArgs {
        chat_id: chat_id.to_owned(),
        chat_message_id: message_id.to_owned(),
        user_id: "macro|chat-repair-test@example.com".to_owned(),
        role: "user".to_owned(),
        created_at_millis: EpochMillis::new(1_700_000_000_000).unwrap(),
        updated_at_millis: EpochMillis::new(1_700_000_000_000).unwrap(),
        title: "Chat".to_owned(),
        content: "zebrafish migration notes".to_owned(),
        properties: vec![],
    }
}

/// Two chats of messages, paged two at a time: every message comes back once,
/// in message id order, and deleting some leaves their chats and the others.
#[tokio::test]
#[ignore = "requires local OpenSearch at http://localhost:9200 with the search indices created"]
async fn paging_visits_every_message_once_and_a_delete_keeps_the_chats() {
    let client = OpensearchClient::new(LOCAL_OPENSEARCH.into(), "".into(), "".into()).unwrap();
    let index = scratch_index_like(&client, "chats", "chat-repair-test")
        .await
        .unwrap();
    let os = &client.inner;

    let observed: anyhow::Result<_> = async {
        for (chat_id, message_id) in [
            ("chat-1", "message-c"),
            ("chat-2", "message-a"),
            ("chat-1", "message-e"),
            ("chat-2", "message-b"),
            ("chat-1", "message-d"),
        ] {
            client
                .upsert_chat_message(&upsert(chat_id, message_id), Some(&index))
                .await?;
        }
        refresh(os, &index).await?;

        let mut pages = Vec::new();
        let mut after: Option<String> = None;
        loop {
            let page = chat_messages_after(os, &index, after.as_deref(), 2).await?;
            let Some(last) = page.last() else { break };
            after = Some(last.message_id.clone());
            pages.push(page);
        }

        let deleted = delete_chat_messages(
            os,
            &index,
            &[
                message("chat-1", "message-d"),
                message("chat-2", "message-a"),
                message("chat-2", "message-z"),
            ],
        )
        .await?;
        refresh(os, &index).await?;
        let messages_left = count(
            os,
            &index,
            serde_json::json!({"term": {"chat_relation": "message"}}),
        )
        .await?;
        let chats_left = count(
            os,
            &index,
            serde_json::json!({"term": {"chat_relation": "chat"}}),
        )
        .await?;
        Ok((pages, deleted, messages_left, chats_left))
    }
    .await;
    delete_index(os, &index).await;
    let (pages, deleted, messages_left, chats_left) = observed.unwrap();

    assert_eq!(
        pages,
        [
            vec![
                message("chat-2", "message-a"),
                message("chat-2", "message-b")
            ],
            vec![
                message("chat-1", "message-c"),
                message("chat-1", "message-d")
            ],
            vec![message("chat-1", "message-e")],
        ]
    );
    assert_eq!(
        deleted,
        ChatMessageDeleteResult {
            deleted: 2,
            not_found: 1,
        }
    );
    assert_eq!((messages_left, chats_left), (3, 2));
}
