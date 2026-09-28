use serde_json::json;

use super::*;

fn args() -> ReconcileAgentSessionArgs {
    ReconcileAgentSessionArgs {
        agent_session_id: "session-1".to_owned(),
        name: "Investigate indexing".to_owned(),
        owner_id: "user-1".to_owned(),
        bot_id: "bot-1".to_owned(),
        thread_id: Some("thread-1".to_owned()),
        originating_message_id: None,
        created_at_millis: EpochMillis::new(10).unwrap(),
        updated_at_millis: EpochMillis::new(20).unwrap(),
        projection_generation: "generation-1".to_owned(),
        messages: vec![AgentSessionMessageDocument {
            turn: 3,
            author: AgentSessionMessageAuthor::Agent,
            author_user_id: None,
            content: "Folded output".to_owned(),
        }],
    }
}

#[test]
fn parent_and_child_documents_share_session_and_generation() {
    let args = args();

    assert_eq!(
        serde_json::to_value(parent_document(&args)).unwrap(),
        json!({
            "agent_session_id": "session-1",
            "projection_generation": "generation-1",
            "name": "Investigate indexing",
            "owner_id": "user-1",
            "bot_id": "bot-1",
            "thread_id": "thread-1",
            "originating_message_id": null,
            "created_at_millis": 10,
            "updated_at_millis": 20,
            "agent_session_relation": "agent_session",
        })
    );
    assert_eq!(
        serde_json::to_value(child_document(&args, &args.messages[0])).unwrap(),
        json!({
            "agent_session_id": "session-1",
            "projection_generation": "generation-1",
            "message_turn": 3,
            "author": "agent",
            "author_user_id": null,
            "content": "Folded output",
            "agent_session_relation": {
                "name": "message",
                "parent": "session-1",
            },
        })
    );
    assert_eq!(
        child_id("session-1", &args.messages[0]),
        "session-1:3:agent"
    );
}

#[test]
fn index_override_selects_a_physical_backfill_index() {
    assert_eq!(resolve_destination(None), "agent_sessions");
    assert_eq!(
        resolve_destination(Some("agent_sessions_v2")),
        "agent_sessions_v2"
    );
}

/// Capture actual HTTP requests so both index and bulk serialization are covered.
async fn capture_reconcile_requests(index_override: Option<&str>) -> Vec<String> {
    use std::io::{BufRead, Read, Write};
    use std::net::TcpListener;
    use std::time::Duration;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let mut requests = Vec::new();
        for body in [
            r#"{}"#,
            r#"{"errors":false}"#,
            r#"{"failures":[],"timed_out":false}"#,
        ] {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut reader = std::io::BufReader::new(&mut stream);
            let mut request = String::new();
            reader.read_line(&mut request).unwrap();
            requests.push(request);
            let mut content_length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    content_length = value.trim().parse::<usize>().unwrap();
                }
            }
            reader.read_exact(&mut vec![0; content_length]).unwrap();
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        }
        requests
    });
    let client =
        crate::OpensearchClient::new(format!("http://{address}"), "".into(), "".into()).unwrap();
    let result = client
        .reconcile_agent_session(&args(), index_override)
        .await;
    result.unwrap();
    server.join().unwrap()
}

#[tokio::test]
async fn normal_parent_and_bulk_writes_require_an_alias() {
    let requests = capture_reconcile_requests(None).await;
    assert!(
        requests[0].starts_with("POST /agent_sessions/_doc/session-1?"),
        "{requests:?}"
    );
    assert!(requests[1].starts_with("POST /agent_sessions/_bulk?"));
    for request in &requests[..2] {
        assert!(request.contains("require_alias=true"), "{request}");
    }
}

#[tokio::test]
async fn explicit_backfill_overrides_allow_a_physical_index() {
    let requests = capture_reconcile_requests(Some("scratch-index")).await;
    assert!(
        requests[0].starts_with("POST /scratch-index/_doc/session-1?"),
        "{requests:?}"
    );
    assert!(requests[1].starts_with("POST /scratch-index/_bulk?"));
    for request in &requests[..2] {
        assert!(request.contains("require_alias=false"), "{request}");
    }
}

/// Uses only a uniquely named scratch index; never changes application indices.
#[tokio::test]
#[ignore = "requires local OpenSearch at http://localhost:9200"]
async fn empty_index_accepts_both_authors_and_prunes_replaced_transcripts() {
    use crate::OpensearchClient;
    use opensearch::{SearchParts, indices::IndicesDeleteParts};

    let client =
        OpensearchClient::new("http://localhost:9200".into(), "".into(), "".into()).unwrap();
    let index = format!("agent-session-indexing-test-{}", uuid::Uuid::new_v4());
    client.ensure_index_exists(&index, json!({
        "settings": {"number_of_shards": 1, "number_of_replicas": 0, "refresh_interval": "100ms"},
        "mappings": {"properties": {
            "agent_session_id": {"type": "keyword"},
            "projection_generation": {"type": "keyword"},
            "content": {"type": "text"},
            "agent_session_relation": {"type": "join", "relations": {"agent_session": "message"}}
        }}
    })).await.unwrap();

    let result: anyhow::Result<()> = async {
        let mut projection = args();
        projection.messages[0].content = "quartzresponse".into();
        projection.messages.push(AgentSessionMessageDocument {
            turn: 3, author: AgentSessionMessageAuthor::User, author_user_id: Some("user-1".into()),
            content: "cobaltquestion".into(),
        });
        client.reconcile_agent_session(&projection, Some(&index)).await?;
        // Both terms must join back to the same parent, across different authors.
        let hits: serde_json::Value = client.inner.search(SearchParts::Index(&[&index]))
            .body(json!({"query": {"bool": {"must": [
                {"has_child": {"type": "message", "query": {"match": {"content": "quartzresponse"}}}},
                {"has_child": {"type": "message", "query": {"match": {"content": "cobaltquestion"}}}}
            ]}}})).send().await?.error_for_status_code()?.json().await?;
        assert_eq!(hits["hits"]["total"]["value"], 1);

        // History replacement removes the old user child and replaces agent text.
        projection.projection_generation = "generation-2".into();
        projection.messages.truncate(1);
        projection.messages[0].content = "newhistory".into();
        client.reconcile_agent_session(&projection, Some(&index)).await?;
        client.reconcile_agent_session(&projection, Some(&index)).await?;
        let hits: serde_json::Value = client.inner.search(SearchParts::Index(&[&index]))
            .body(json!({"query": {"match_all": {}}})).send().await?.error_for_status_code()?.json().await?;
        assert_eq!(hits["hits"]["total"]["value"], 2);
        let content: Vec<_> = hits["hits"]["hits"].as_array().unwrap().iter()
            .filter_map(|hit| hit["_source"]["content"].as_str()).collect();
        assert_eq!(content, vec!["newhistory"]);

        client.delete_agent_session(&projection.agent_session_id, Some(&index)).await?;
        let hits: serde_json::Value = client.inner.search(SearchParts::Index(&[&index]))
            .body(json!({"query": {"match_all": {}}})).send().await?.error_for_status_code()?.json().await?;
        assert_eq!(hits["hits"]["total"]["value"], 0);
        Ok(())
    }.await;
    client
        .inner
        .indices()
        .delete(IndicesDeleteParts::Index(&[&index]))
        .send()
        .await
        .unwrap()
        .error_for_status_code()
        .unwrap();
    result.unwrap();
}
