use super::*;
use crate::toolset::web_search::{WebSearchQuery, search_web};
use crate::types::response::web_search::{SearchResult, WebSearchContent, WebSearchToolError};
use crate::types::response::{Content, MessageResponse, ResponseContentKind};
use ai_billing::domain::{
    DenyReason,
    admission::{AdmissionFuture, AiAdmissionError, AiAdmissionService},
};
use ai_usage::financial::{FinancialError, WriteDisposition};
use ai_usage::{FinancialFuture, UsageTracking};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Mutex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

struct Refuse {
    error: AiAdmissionError,
    callers: Mutex<Vec<(String, ai_usage::AiFeature)>>,
}
impl AiAdmissionService for Refuse {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: ai_usage::AiFeature,
    ) -> AdmissionFuture<'a> {
        Box::pin(async move {
            self.callers
                .lock()
                .unwrap()
                .push((user.to_string(), feature));
            Err(self.error)
        })
    }
}

#[tokio::test]
async fn direct_tools_refuse_before_both_provider_branches_and_observation() {
    use ai_toolset::{AsyncTool, ServiceContext};
    for tracked in [false, true] {
        for error in [
            AiAdmissionError::Denied(DenyReason::AllowanceExhausted),
            AiAdmissionError::Unavailable,
        ] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let mut context = AnthropicToolContext::new(
                Client::with_config(crate::config::Config {
                    api_base: format!("http://{}", listener.local_addr().unwrap()),
                    ..Default::default()
                }),
                "claude-haiku-4-5".into(),
            );
            let admission = Arc::new(Refuse {
                error,
                callers: Mutex::new(Vec::new()),
            });
            context.admission = admission.clone();
            let journal = Arc::new(Observations::default());
            if tracked {
                context.recorder =
                    ai_usage::with_tracking(Arc::new(ai_usage::NoOpUsageRecorder), journal.clone());
            }
            context.usage_context = UsageContext::system(ai_usage::AiFeature::Automation);
            let first =
                RequestContext::new("macro|first@example.com".to_owned().try_into().unwrap());
            let second =
                RequestContext::new("macro|second@example.com".to_owned().try_into().unwrap());
            let tool = WebSearch {
                input: "test".into(),
            };
            let (a, b) = tokio::join!(
                tool.call(ServiceContext(context.clone()), first.clone()),
                tool.call(ServiceContext(context), second.clone()),
            );
            for result in [a, b] {
                assert_eq!(
                    result.unwrap_err().description,
                    format!("{}: {error}", error.code())
                );
            }
            {
                let callers = admission.callers.lock().unwrap();
                assert!(
                    callers.contains(&(first.user_id.to_string(), ai_usage::AiFeature::Automation))
                );
                assert!(
                    callers
                        .contains(&(second.user_id.to_string(), ai_usage::AiFeature::Automation))
                );
            }
            assert!(journal.begins.lock().unwrap().is_empty());
            assert!(journal.finals.lock().unwrap().is_empty());
            assert!(
                tokio::time::timeout(std::time::Duration::from_millis(10), listener.accept())
                    .await
                    .is_err()
            );
        }
    }
}

struct NoAnalytics;
impl UsageRecorder for NoAnalytics {
    fn record(&self, _: ai_usage::UsageEvent) {
        panic!("native tools must not introduce a new analytics producer");
    }
}

#[derive(Default)]
struct Observations {
    begins: Mutex<Vec<TrackedInvocation>>,
    finals: Mutex<Vec<FinalizeInvocation>>,
    fail: bool,
}

impl UsageTracking for Observations {
    fn begin(&self, request: TrackedInvocation) -> FinancialFuture<'_, WriteDisposition> {
        Box::pin(async move {
            self.begins.lock().unwrap().push(request);
            if self.fail {
                return Err(FinancialError::CapabilityUnavailable);
            }
            Ok(WriteDisposition::Inserted)
        })
    }
    fn finalize(&self, evidence: FinalizeInvocation) -> FinancialFuture<'_, WriteDisposition> {
        Box::pin(async move {
            self.finals.lock().unwrap().push(evidence);
            Ok(WriteDisposition::Inserted)
        })
    }
}

async fn context_with_response(body: &str, journal: Arc<Observations>) -> AnthropicToolContext {
    context_with_status(body, journal, 200).await
}

async fn context_with_status(
    body: &str,
    journal: Arc<Observations>,
    status: u16,
) -> AnthropicToolContext {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let response = format!(
        "HTTP/1.1 {status} Response\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut data = vec![0; 8192];
        let received = socket.read(&mut data).await.unwrap();
        assert!(received > 0, "client sent a request before the response");
        socket.write_all(response.as_bytes()).await.unwrap();
    });
    let mut context = AnthropicToolContext::new(
        Client::with_config(crate::config::Config {
            api_base: format!("http://{address}"),
            ..Default::default()
        }),
        "claude-haiku-4-5".into(),
    );
    context.recorder = ai_usage::with_tracking(Arc::new(NoAnalytics), journal);
    context.usage_context = UsageContext::system(ai_usage::AiFeature::Automation);
    context
}

#[tokio::test]
async fn independent_tool_uses_authenticated_user_and_records_before_parsing() {
    let journal = Arc::new(Observations::default());
    // Deliberately malformed tool content: usage must survive SDK/result failure.
    let context = context_with_response(r#"{"id":"msg-1","content":42,"usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":2,"cache_creation_input_tokens":3,"server_tool_use":{"web_search_requests":1}}}"#, journal.clone()).await;
    let request = RequestContext::new(
        "macro|authenticated@example.com"
            .to_owned()
            .try_into()
            .unwrap(),
    );
    assert!(
        invoke_server_tool(
            &context,
            &request,
            crate::types::request::WEB_SEARCH_TOOL.clone(),
            "query"
        )
        .await
        .is_err()
    );
    let begins = journal.begins.lock().unwrap();
    assert!(
        begins.iter().all(|begin| begin.user == request.user_id
            && begin.feature == ai_usage::AiFeature::Automation)
    );
    assert_eq!(begins[0].model.provider(), "anthropic");
    assert_eq!(begins[0].model.model(), "claude-haiku-4-5");
    let finals = journal.finals.lock().unwrap();
    assert_eq!(finals.len(), 1);
    assert_eq!(
        finals[0].usage,
        UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(10, 5, 2, 3, 0))
    );
}

#[tokio::test]
async fn recorder_failure_does_not_fail_tool_execution() {
    let journal = Arc::new(Observations {
        fail: true,
        ..Default::default()
    });
    let context = context_with_response(
        r#"{"content":[],"usage":{"input_tokens":1,"output_tokens":2}}"#,
        journal.clone(),
    )
    .await;
    let request = RequestContext::new(
        "macro|authenticated@example.com"
            .to_owned()
            .try_into()
            .unwrap(),
    );
    invoke_server_tool(
        &context,
        &request,
        crate::types::request::WEB_SEARCH_TOOL.clone(),
        "query",
    )
    .await
    .unwrap();
    assert!(journal.finals.lock().unwrap().is_empty());
}

#[tokio::test]
async fn failed_http_response_preserves_reported_usage() {
    let journal = Arc::new(Observations::default());
    let context = context_with_status(
        r#"{"error":{"type":"overloaded_error"},"usage":{"input_tokens":3,"output_tokens":2}}"#,
        journal.clone(),
        503,
    )
    .await;
    let request = RequestContext::new(
        "macro|authenticated@example.com"
            .to_owned()
            .try_into()
            .unwrap(),
    );
    assert!(
        invoke_server_tool(
            &context,
            &request,
            crate::types::request::WEB_SEARCH_TOOL.clone(),
            "query"
        )
        .await
        .is_err()
    );
    let finals = journal.finals.lock().unwrap();
    assert_eq!(finals.len(), 1);
    assert_eq!(finals[0].outcome, ProviderOutcome::Failed);
    assert_eq!(
        finals[0].usage,
        UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(3, 2, 0, 0, 0))
    );
}

#[test]
fn absent_usage_is_not_zero_and_unknown_cache_ttl_is_unresolved() {
    assert_eq!(
        response_usage(&serde_json::json!({})),
        UsageEvidence::Missing(UnresolvedReason::UsageNotReported)
    );
    assert_eq!(
        response_usage(&serde_json::json!({"usage":{"input_tokens":1}})),
        UsageEvidence::Missing(UnresolvedReason::UnsupportedDimensions)
    );
    assert_eq!(
        response_usage(
            &serde_json::json!({"usage":{"input_tokens":1,"output_tokens":2,"cache_creation":{"ephemeral_1h_input_tokens":1}}})
        ),
        UsageEvidence::Missing(UnresolvedReason::UnsupportedDimensions)
    );
}

#[tokio::test(start_paused = true)]
async fn live_tool_has_no_deadline_but_cancelled_tool_drain_is_bounded() {
    use std::time::Duration;
    for cancel in [false, true] {
        let journal = Arc::new(Observations::default());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut data = vec![0; 8192];
            assert!(socket.read(&mut data).await.unwrap() > 0);
            started_tx.send(()).unwrap();
            let _ = release_rx.await;
            let body = r#"{"content":[],"usage":{"input_tokens":10,"output_tokens":2}}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = socket.write_all(response.as_bytes()).await;
        });
        let mut context = AnthropicToolContext::new(
            Client::with_config(crate::config::Config {
                api_base: format!("http://{address}"),
                ..Default::default()
            }),
            "claude-haiku-4-5".into(),
        );
        context.recorder =
            ai_usage::with_tracking(Arc::new(ai_usage::NoOpUsageRecorder), journal.clone());
        let caller = tokio::spawn(async move {
            let request =
                RequestContext::new("macro|test@example.com".to_owned().try_into().unwrap());
            invoke_server_tool(
                &context,
                &request,
                crate::types::request::WEB_SEARCH_TOOL.clone(),
                "query",
            )
            .await
        });
        started_rx.await.unwrap();
        // A live operation can already be older than the detached drain budget.
        tokio::time::advance(Duration::from_secs(301)).await;
        assert!(!caller.is_finished());
        assert!(journal.finals.lock().unwrap().is_empty());
        if cancel {
            caller.abort();
            let _ = caller.await;
            tokio::task::yield_now().await;
            tokio::time::advance(Duration::from_secs(299)).await;
            assert!(journal.finals.lock().unwrap().is_empty());
            tokio::time::advance(Duration::from_secs(2)).await;
            for _ in 0..20 {
                tokio::task::yield_now().await;
            }
            assert_eq!(
                journal.finals.lock().unwrap()[0].usage,
                UsageEvidence::Missing(UnresolvedReason::Interrupted)
            );
        } else {
            release_tx.send(()).unwrap();
            caller.await.unwrap().unwrap();
            assert_eq!(
                journal.finals.lock().unwrap()[0].usage,
                UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(10, 2, 0, 0, 0))
            );
        }
        server.abort();
    }
}

#[test]
fn nullable_cache_counters_are_absent_but_malformed_usage_is_unresolved() {
    use serde_json::json;
    assert_eq!(
        response_usage(&json!({"usage": {
            "input_tokens": 10, "output_tokens": 2, "cache_creation": null,
            "cache_read_input_tokens": null, "cache_creation_input_tokens": null
        }})),
        UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(10, 2, 0, 0, 0))
    );
    for usage in [
        json!({"input_tokens": 10, "output_tokens": null}),
        json!({"input_tokens": 10, "output_tokens": 2, "cache_creation": 3}),
        json!({"input_tokens": 10, "output_tokens": 2, "cache_read_input_tokens": -1}),
        json!({"input_tokens": 10, "output_tokens": 2, "cache_creation_input_tokens": "3"}),
    ] {
        assert_eq!(
            response_usage(&json!({"usage": usage})),
            UsageEvidence::Missing(UnresolvedReason::UnsupportedDimensions)
        );
    }
}

#[test]
fn deserialize_web_search_response() {
    // From the Anthropic docs: https://platform.claude.com/docs/en/docs/build-with-claude/tool-use/web-search-tool
    let json = serde_json::json!({
        "id": "msg_a930390d3a",
        "type": "message",
        "role": "assistant",
        "model": "claude-sonnet-4-5-20250929",
        "content": [
            {
                "type": "text",
                "text": "I'll search for when Claude Shannon was born."
            },
            {
                "type": "server_tool_use",
                "id": "srvtoolu_01WYG3ziw53XMcoyKL4XcZmE",
                "name": "web_search",
                "input": {
                    "query": "claude shannon birth date"
                }
            },
            {
                "type": "web_search_tool_result",
                "tool_use_id": "srvtoolu_01WYG3ziw53XMcoyKL4XcZmE",
                "content": [
                    {
                        "type": "web_search_result",
                        "url": "https://en.wikipedia.org/wiki/Claude_Shannon",
                        "title": "Claude Shannon - Wikipedia",
                        "encrypted_content": "EqgfCioIARgB...",
                        "page_age": "April 30, 2025"
                    }
                ]
            },
            {
                "text": "Based on the search results, ",
                "type": "text"
            },
            {
                "text": "Claude Shannon was born on April 30, 1916",
                "type": "text",
                "citations": [
                    {
                        "type": "web_search_result_location",
                        "url": "https://en.wikipedia.org/wiki/Claude_Shannon",
                        "title": "Claude Shannon - Wikipedia",
                        "encrypted_index": "Eo8BCioIAhgB...",
                        "cited_text": "Claude Elwood Shannon (April 30, 1916 – February 24, 2001)..."
                    }
                ]
            }
        ],
        "stop_reason": "end_turn",
        "stop_sequence": null,
        "usage": {
            "input_tokens": 6039,
            "output_tokens": 931,
            "server_tool_use": {
                "web_search_requests": 1
            }
        }
    });

    let result = serde_json::from_value::<MessageResponse>(json);
    match &result {
        Err(e) => panic!("Failed to deserialize web search response: {e}"),
        Ok(msg) => {
            let content = msg.content.as_ref().expect("content");
            match content {
                Content::Array(blocks) => {
                    assert!(
                        blocks.len() >= 4,
                        "expected at least 4 content blocks, got {}",
                        blocks.len()
                    );
                    assert!(
                        blocks
                            .iter()
                            .any(|b| matches!(b, ResponseContentKind::WebSearchToolResult(_))),
                        "expected a WebSearchToolResult block"
                    );
                }
                _ => panic!("expected Content::Array"),
            }
        }
    }
}

fn search_result(url: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "web_search_result",
        "url": url,
        "title": format!("Title of {url}"),
        "encrypted_content": "EqgfCioIARgB...",
        "page_age": "April 30, 2025"
    })
}

fn search_result_block(tool_use_id: &str, content: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "type": "web_search_tool_result",
        "tool_use_id": tool_use_id,
        "content": content
    })
}

/// A paused server-tool loop is a real stop reason for web search, so the
/// tool must hand back the results found so far rather than fail on the
/// envelope; stop reasons this crate has never seen must not fail it either.
#[tokio::test]
async fn web_search_survives_paused_and_unknown_stop_reasons() {
    use ai_toolset::{AsyncTool, ServiceContext};
    for stop_reason in [
        "pause_turn",
        "model_context_window_exceeded",
        "some_future_reason",
    ] {
        let body = serde_json::json!({
            "id": "msg-1",
            "type": "message",
            "role": "assistant",
            "content": [
                {"type": "server_tool_use", "id": "srv-1", "name": "web_search", "input": {"query": "a"}},
                search_result_block("srv-1", serde_json::json!([search_result("https://a.example")])),
                {"type": "server_tool_use", "id": "srv-2", "name": "web_search", "input": {"query": "b"}},
            ],
            "stop_reason": stop_reason,
            "stop_sequence": null,
            "usage": {"input_tokens": 10, "output_tokens": 5}
        });
        let context = context_with_response(&body.to_string(), Arc::default()).await;
        let request = RequestContext::new(
            "macro|authenticated@example.com"
                .to_owned()
                .try_into()
                .unwrap(),
        );
        let response = WebSearch {
            input: "a and b".into(),
        }
        .call(ServiceContext(context), request)
        .await
        .unwrap_or_else(|error| panic!("{stop_reason}: {}", error.description));
        assert_eq!(response.tool_use_id, "srv-1");
        match response.content {
            WebSearchContent::Results(results) => assert_eq!(results.len(), 1),
            WebSearchContent::Error(error) => panic!("{stop_reason}: {error:?}"),
        }
    }
}

#[test]
fn web_search_output_folds_every_search_without_encrypted_content() {
    let blocks: Vec<ResponseContentKind> = serde_json::from_value(serde_json::json!([
        {"type": "text", "text": "Searching."},
        {"type": "server_tool_use", "id": "srv-1", "name": "web_search", "input": {"query": "a"}},
        search_result_block("srv-1", serde_json::json!([
            search_result("https://a.example"),
            search_result("https://shared.example"),
        ])),
        search_result_block("srv-2", serde_json::json!({
            "type": "web_search_tool_result_error",
            "error_code": "too_many_requests"
        })),
        search_result_block("srv-3", serde_json::json!([
            search_result("https://shared.example"),
            search_result("https://c.example"),
        ])),
    ]))
    .unwrap();

    let response = web_search::collect_results(blocks).expect("a search ran");
    assert_eq!(response.tool_use_id, "srv-1");
    let WebSearchContent::Results(results) = response.content else {
        panic!("one failed search must not hide the others' results");
    };
    let urls: Vec<_> = results
        .iter()
        .map(|result| match result {
            SearchResult::WebSearchResult {
                url,
                encrypted_content,
                ..
            } => {
                assert_eq!(encrypted_content, &None);
                url.as_str()
            }
        })
        .collect();
    assert_eq!(
        urls,
        [
            "https://a.example",
            "https://shared.example",
            "https://c.example"
        ]
    );
}

#[test]
fn web_search_output_reports_the_error_only_when_nothing_was_found() {
    let blocks: Vec<ResponseContentKind> = serde_json::from_value(serde_json::json!([
        search_result_block(
            "srv-1",
            serde_json::json!({
                "type": "web_search_tool_result_error",
                "error_code": "max_uses_exceeded"
            })
        ),
        search_result_block(
            "srv-2",
            serde_json::json!({
                "type": "web_search_tool_result_error",
                "error_code": "unavailable"
            })
        ),
    ]))
    .unwrap();
    let response = web_search::collect_results(blocks).expect("a search ran");
    assert_eq!(response.tool_use_id, "srv-1");
    assert!(matches!(
        response.content,
        WebSearchContent::Error(WebSearchToolError { ref error_code, .. }) if error_code == "max_uses_exceeded"
    ));

    let no_search: Vec<ResponseContentKind> = serde_json::from_value(serde_json::json!([
        {"type": "text", "text": "I do not need to search for that."}
    ]))
    .unwrap();
    assert!(web_search::collect_results(no_search).is_none());
}

#[test]
fn deserialize_web_search_error_response() {
    // Error case from docs — content is a single object, not an array
    let json = serde_json::json!({
        "type": "web_search_tool_result",
        "tool_use_id": "srvtoolu_a93jad",
        "content": {
            "type": "web_search_tool_result_error",
            "error_code": "max_uses_exceeded"
        }
    });

    let result = serde_json::from_value::<ResponseContentKind>(json);
    match &result {
        Err(e) => panic!("Failed to deserialize web search error: {e}"),
        Ok(block) => assert!(matches!(block, ResponseContentKind::WebSearchToolResult(_))),
    }
}

#[test]
fn deserialize_text_without_citations() {
    // Text block WITHOUT citations field — common in API responses
    let json = serde_json::json!({
        "type": "text",
        "text": "Based on the search results, "
    });

    let result = serde_json::from_value::<ResponseContentKind>(json);
    match &result {
        Err(e) => panic!("Failed to deserialize text without citations: {e}"),
        Ok(block) => assert!(matches!(block, ResponseContentKind::Text(_))),
    }
}

#[test]
fn deserialize_text_with_citations() {
    let json = serde_json::json!({
        "type": "text",
        "text": "Claude Shannon was born on April 30, 1916",
        "citations": [
            {
                "type": "web_search_result_location",
                "url": "https://example.com",
                "title": "Example",
                "encrypted_index": "abc123",
                "cited_text": "some text"
            }
        ]
    });

    let result = serde_json::from_value::<ResponseContentKind>(json);
    match &result {
        Err(e) => panic!("Failed to deserialize text with citations: {e}"),
        Ok(block) => assert!(matches!(block, ResponseContentKind::Text(_))),
    }
}

#[tokio::test]
async fn direct_search_limits_domains_and_searches_and_returns_found_pages() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let body = serde_json::json!({
        "id": "msg-1",
        "type": "message",
        "role": "assistant",
        "content": [
            {"type": "server_tool_use", "id": "srv-1", "name": "web_search", "input": {"query": "rust 2024 edition"}},
            search_result_block("srv-1", serde_json::json!([search_result("https://doc.rust-lang.org/edition-guide")])),
        ],
        "stop_reason": "end_turn",
        "stop_sequence": null,
        "usage": {"input_tokens": 10, "output_tokens": 5}
    })
    .to_string();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut buffer = vec![0; 8192];
        let body_start = loop {
            let read = socket.read(&mut buffer).await.unwrap();
            request.extend_from_slice(&buffer[..read]);
            if let Some(end) = request.windows(4).position(|window| window == b"\r\n\r\n") {
                break end + 4;
            }
        };
        let headers = String::from_utf8_lossy(&request[..body_start]).to_lowercase();
        let length: usize = headers
            .lines()
            .find_map(|line| line.strip_prefix("content-length: "))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        while request.len() < body_start + length {
            let read = socket.read(&mut buffer).await.unwrap();
            request.extend_from_slice(&buffer[..read]);
        }
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        socket.write_all(response.as_bytes()).await.unwrap();
        serde_json::from_slice::<serde_json::Value>(&request[body_start..]).unwrap()
    });
    let context = AnthropicToolContext::new(
        Client::with_config(crate::config::Config {
            api_base: format!("http://{address}"),
            ..Default::default()
        }),
        "claude-haiku-4-5".into(),
    );
    let request = RequestContext::new(
        "macro|authenticated@example.com"
            .to_owned()
            .try_into()
            .unwrap(),
    );

    let response = search_web(
        &context,
        &request,
        &WebSearchQuery {
            query: "rust 2024 edition".into(),
            allowed_domains: vec!["rust-lang.org".into()],
        },
    )
    .await
    .unwrap();

    assert_eq!(
        response.content,
        WebSearchContent::Results(vec![SearchResult::WebSearchResult {
            title: "Title of https://doc.rust-lang.org/edition-guide".into(),
            url: "https://doc.rust-lang.org/edition-guide".into(),
            encrypted_content: None,
            page_age: Some("April 30, 2025".into()),
        }])
    );
    let sent = server.await.unwrap();
    assert_eq!(
        sent["tools"],
        serde_json::json!([{
            "type": "web_search_20250305",
            "name": "web_search",
            "max_uses": 3,
            "allowed_domains": ["rust-lang.org"],
        }])
    );
    assert_eq!(sent["messages"][0]["content"], "rust 2024 edition");
}

#[tokio::test]
async fn direct_search_reports_admission_refusal_as_admission() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut context = AnthropicToolContext::new(
        Client::with_config(crate::config::Config {
            api_base: format!("http://{}", listener.local_addr().unwrap()),
            ..Default::default()
        }),
        "claude-haiku-4-5".into(),
    );
    context.admission = Arc::new(Refuse {
        error: AiAdmissionError::Denied(DenyReason::AllowanceExhausted),
        callers: Mutex::new(Vec::new()),
    });
    let request = RequestContext::new("macro|first@example.com".to_owned().try_into().unwrap());

    let error = search_web(
        &context,
        &request,
        &WebSearchQuery {
            query: "anything".into(),
            allowed_domains: Vec::new(),
        },
    )
    .await
    .unwrap_err();

    assert!(matches!(
        error,
        ServerToolError::Admission(AiAdmissionError::Denied(DenyReason::AllowanceExhausted))
    ));
}
