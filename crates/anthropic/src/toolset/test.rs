use super::*;
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
