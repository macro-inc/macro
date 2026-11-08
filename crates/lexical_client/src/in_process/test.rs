use crate::parse_markdown::MarkdownTarget;
use crate::{LexicalClient, RawDocumentSource};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

struct FakeDocument {
    reads: AtomicUsize,
    fail: bool,
}
#[async_trait::async_trait]
impl RawDocumentSource for FakeDocument {
    async fn get_raw(&self, document_id: &str) -> anyhow::Result<String> {
        assert_eq!(document_id, "document-test");
        self.reads.fetch_add(1, Ordering::SeqCst);
        anyhow::ensure!(!self.fail, "source refused");
        Ok(serde_json::json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"$":{"id":"block-one"},"children":[{"type":"text","version":1,"text":"Hello","format":0,"mode":"normal","style":"","detail":0}],"direction":null,"format":"","indent":0}],"direction":null,"format":"","indent":0}}).to_string())
    }
}

#[tokio::test]
async fn live_exports_use_the_source_and_preserve_block_ids() {
    let source = Arc::new(FakeDocument {
        reads: AtomicUsize::new(0),
        fail: false,
    });
    let client = LexicalClient::new("test-key".into(), "http://127.0.0.1:1".into())
        .with_route_modes("markdown=in_process".parse().unwrap())
        .with_document_source(source.clone());
    assert_eq!(
        client
            .get_markdown("document-test", MarkdownTarget::Internal)
            .await
            .unwrap(),
        "Hello"
    );
    assert_eq!(
        client
            .get_embedding_markdown("document-test")
            .await
            .unwrap()
            .as_str(),
        "Hello"
    );
    let search = client.parse_markdown("document-test").await.unwrap();
    assert_eq!(search.len(), 1);
    assert_eq!(search[0].node_id, "block-one");
    assert_eq!(search[0].content, "Hello");
    let cognition = client.parse_cognition_v2("document-test").await.unwrap();
    assert_eq!(
        serde_json::to_value(cognition).unwrap(),
        serde_json::json!({"data":[{"type":"generic","nodeId":"block-one","content":"Hello","tag":"paragraph"}]})
    );
    assert!(
        client
            .resolve_comment_mark("document-test", "missing")
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(source.reads.load(Ordering::SeqCst), 5);
}

#[tokio::test]
async fn source_errors_never_fall_back_to_lexical_http() {
    let client = LexicalClient::new("test-key".into(), "http://127.0.0.1:1".into())
        .with_route_modes("markdown=in_process".parse().unwrap())
        .with_document_source(Arc::new(FakeDocument {
            reads: AtomicUsize::new(0),
            fail: true,
        }));
    let error = client
        .get_markdown("document-test", MarkdownTarget::Internal)
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "source refused");
}

#[tokio::test]
async fn html_public_route_matches_every_markdown_source_golden() {
    let client = LexicalClient::new("test-key".into(), "http://127.0.0.1:1".into())
        .with_route_modes("html=in_process".parse().unwrap());
    for line in
        include_str!("../../../client/lexical/macro_document_model/tests/corpus/html.jsonl").lines()
    {
        let row: serde_json::Value = serde_json::from_str(line).unwrap();
        if row["kind"] != "markdown" {
            continue;
        }
        let result = client
            .markdown_to_html(row["input"].as_str().unwrap())
            .await;
        if let Some(expected) = row["expected"].get("value") {
            assert_eq!(
                &serde_json::to_value(result.unwrap()).unwrap(),
                expected,
                "{}",
                row["name"]
            );
        } else {
            assert!(result.is_err(), "{}", row["name"]);
        }
    }
}

#[tokio::test]
async fn snapshot_empty_ancestor_and_extraction_match_source_boundaries() {
    let client = LexicalClient::new("test-key".into(), "http://127.0.0.1:1".into())
        .with_route_modes("snapshot=in_process".parse().unwrap());
    let snapshot = client.markdown_to_loro_snapshot("").await.unwrap();
    assert_eq!(
        snapshot,
        include_bytes!("../../../../static_assets/markdown-golden.1.bin")
    );
    assert!(
        client
            .extract_mentions("plain **text**")
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        client
            .extract_explicit_reply("> plain quote\n\nReply")
            .await
            .unwrap()
            .is_none()
    );
    let notion = client
        .notion_to_loro_snapshot(&crate::notion::NotionSnapshotRequest::default())
        .await
        .unwrap();
    assert_eq!(notion.snapshot, snapshot);
    assert_eq!(notion.markdown, "");
}

/// A hand-written HTTP adapter supplies fixed remote contract results; no model
/// code runs in the double, so a local-only path cannot accidentally pass via it.
#[tokio::test]
async fn public_route_groups_select_http_local_and_shadow_without_fallback() {
    use axum::{
        Json, Router,
        extract::State,
        routing::{get, post},
    };
    let requests = Arc::new(AtomicUsize::new(0));
    async fn markdown(State(calls): State<Arc<AtomicUsize>>) -> Json<serde_json::Value> {
        calls.fetch_add(1, Ordering::SeqCst);
        Json(serde_json::json!({"data":"Hello"}))
    }
    async fn html(State(calls): State<Arc<AtomicUsize>>) -> Json<serde_json::Value> {
        calls.fetch_add(1, Ordering::SeqCst);
        Json(serde_json::json!({"html":"<p><br></p>","text":""}))
    }
    async fn composer(State(calls): State<Arc<AtomicUsize>>) -> Json<serde_json::Value> {
        calls.fetch_add(1, Ordering::SeqCst);
        Json(serde_json::json!({"markdown":"Hello"}))
    }
    async fn snapshot(State(calls): State<Arc<AtomicUsize>>) -> &'static [u8] {
        calls.fetch_add(1, Ordering::SeqCst);
        include_bytes!("../../../../static_assets/markdown-golden.1.bin")
    }
    let app = Router::new()
        .route("/markdown/document-test", get(markdown))
        .route("/html", post(html))
        .route("/agent-context", post(composer))
        .route("/snapshot/markdown", post(snapshot))
        .with_state(requests.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (shutdown, stop) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = stop.await;
            })
            .await
            .unwrap()
    });
    for mode in ["http", "in_process", "shadow"] {
        let raw = Arc::new(FakeDocument {
            reads: AtomicUsize::new(0),
            fail: false,
        });
        let client = LexicalClient::new("test-key".into(), format!("http://{address}"))
            .with_route_modes(
                format!("markdown={mode},snapshot={mode},composers={mode},html={mode}")
                    .parse()
                    .unwrap(),
            )
            .with_document_source(raw.clone());
        let before = requests.load(Ordering::SeqCst);
        assert_eq!(
            client
                .get_markdown("document-test", MarkdownTarget::Internal)
                .await
                .unwrap(),
            "Hello"
        );
        assert_eq!(
            client.markdown_to_html("").await.unwrap().html,
            "<p><br></p>"
        );
        assert_eq!(
            client
                .compose_agent_context("Hello", None, None, None, None)
                .await
                .unwrap(),
            "Hello"
        );
        assert_eq!(
            client.markdown_to_loro_snapshot("").await.unwrap(),
            include_bytes!("../../../../static_assets/markdown-golden.1.bin")
        );
        assert_eq!(
            raw.reads.load(Ordering::SeqCst),
            usize::from(mode != "http")
        );
        assert_eq!(
            requests.load(Ordering::SeqCst) - before,
            if mode == "in_process" { 0 } else { 4 }
        );
    }
    shutdown.send(()).unwrap();
    server.await.unwrap();
}
