mod tracking;

use super::super::metering::ProviderSupport;
use super::*;
use ai_usage::financial::*;
use ai_usage::{AiFeature, FinancialFuture, FinancialUsage, UsageContext};
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct Journal {
    begins: Mutex<Vec<BeginInvocation>>,
    finals: Mutex<Vec<FinalizeInvocation>>,
    deliveries: Mutex<Vec<FinalizeInvocation>>,
    deny_after: Option<usize>,
    lose_ack: bool,
    replay_begin: bool,
}

impl FinancialUsage for Journal {
    fn begin(
        &self,
        request: BeginInvocation,
    ) -> FinancialFuture<'_, Recorded<AuthorizedInvocation>> {
        Box::pin(async move {
            let mut begins = self.begins.lock().unwrap();
            if self.deny_after.is_some_and(|n| begins.len() >= n) {
                return Err(FinancialError::FundingDenied);
            }
            begins.push(request.clone());
            Ok(Recorded {
                value: admission(request),
                disposition: if self.replay_begin {
                    WriteDisposition::Replayed
                } else {
                    WriteDisposition::Inserted
                },
            })
        })
    }
    fn finalize(
        &self,
        evidence: FinalizeInvocation,
    ) -> FinancialFuture<'_, Recorded<InvocationRecord>> {
        Box::pin(async move {
            let mut deliveries = self.deliveries.lock().unwrap();
            deliveries.push(evidence.clone());
            let mut finals = self.finals.lock().unwrap();
            let disposition = if let Some(previous) = finals
                .iter()
                .find(|p| p.invocation_id == evidence.invocation_id)
            {
                previous.check_replay(&evidence)?;
                WriteDisposition::Replayed
            } else {
                finals.push(evidence.clone());
                WriteDisposition::Inserted
            };
            if self.lose_ack && deliveries.len() == 1 {
                return Err(FinancialError::CapabilityUnavailable);
            }
            let request = self
                .begins
                .lock()
                .unwrap()
                .iter()
                .find(|b| b.invocation_id == evidence.invocation_id)
                .unwrap()
                .clone();
            let admission = admission(request);
            let state = match evidence.usage {
                UsageEvidence::Reported(usage) => InvocationState::Priced {
                    public_usage: admission.rate.tokens.price(usage)?,
                    evidence,
                },
                UsageEvidence::Missing(_) => InvocationState::Unresolved { evidence },
            };
            Ok(Recorded {
                value: InvocationRecord { admission, state },
                disposition,
            })
        })
    }
    fn get(&self, _: InvocationId) -> FinancialFuture<'_, Option<InvocationRecord>> {
        Box::pin(async { Ok(None) })
    }
    fn pending(&self, _: PendingInvocations) -> FinancialFuture<'_, Vec<InvocationRecord>> {
        Box::pin(async { Ok(vec![]) })
    }
}

fn admission(request: BeginInvocation) -> AuthorizedInvocation {
    let rate = RateSnapshot {
        version: RateVersion::new(),
        model: request.model.clone(),
        effective_at: request.occurred_at,
        tokens: TokenRates {
            input: 1,
            output: 1,
            cache_read: 1,
            cache_write: 1,
            reasoning: 1,
        },
    };
    let funding = FundingAuthorization {
        id: FundingAuthorizationId::new(),
        invocation_id: request.invocation_id,
        maximum_public_usage: rate.tokens.price(request.token_budget).unwrap(),
    };
    AuthorizedInvocation {
        request,
        rate,
        funding,
    }
}

#[derive(Clone, Debug, Default)]
struct Transport {
    calls: Arc<AtomicUsize>,
    bodies: Arc<Mutex<Vec<Value>>>,
    response: Bytes,
    remaining: Arc<Mutex<std::collections::VecDeque<Bytes>>>,
    fail: bool,
    stall: bool,
}

impl Transport {
    fn new(response: impl Into<Bytes>) -> Self {
        Self {
            calls: Arc::default(),
            bodies: Arc::default(),
            response: response.into(),
            ..Default::default()
        }
    }
    fn next_response(&self) -> Bytes {
        self.remaining
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| self.response.clone())
    }

    fn called<T: Into<Bytes>>(&self, request: Request<T>) {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.bodies
            .lock()
            .unwrap()
            .push(serde_json::from_slice(&request.into_body().into()).unwrap());
    }
}

impl HttpClientExt for Transport {
    fn send<T, U>(
        &self,
        request: Request<T>,
    ) -> impl Future<Output = http_client::Result<Response<LazyBody<U>>>> + Send + 'static
    where
        T: Into<Bytes> + Send,
        U: From<Bytes> + Send + 'static,
    {
        self.called(request);
        let response = self.next_response();
        let fail = self.fail;
        let stall = self.stall;
        async move {
            if fail {
                return Err(http_client::Error::StreamEnded);
            }
            let body: LazyBody<U> = Box::pin(async move {
                if stall {
                    tokio::time::sleep(EXECUTION_TIMEOUT * 2).await;
                }
                Ok(U::from(response))
            });
            Ok(Response::builder()
                .header("x-request-id", "req-1")
                .body(body)
                .unwrap())
        }
    }
    fn send_multipart<U>(
        &self,
        _: Request<MultipartForm>,
    ) -> impl Future<Output = http_client::Result<Response<LazyBody<U>>>> + Send + 'static
    where
        U: From<Bytes> + Send + 'static,
    {
        std::future::ready(Err(http_client::Error::StreamEnded))
    }
    async fn send_streaming<T>(&self, request: Request<T>) -> http_client::Result<StreamingResponse>
    where
        T: Into<Bytes> + Send,
    {
        self.called(request);
        let bytes = self.next_response();
        // Exercise arbitrary byte boundaries, including UTF-8 and CRLF.
        let chunks: Vec<_> = bytes
            .chunks(7)
            .map(|chunk| Ok(Bytes::copy_from_slice(chunk)))
            .collect();
        Ok(Response::builder()
            .header("content-type", "text/event-stream")
            .body(Box::pin(futures::stream::iter(chunks)) as http_client::sse::BoxedStream)
            .unwrap())
    }
}

fn context(
    journal: Arc<Journal>,
    protocol: WireProtocol,
    provider: &str,
    model: &str,
) -> MeteringContext {
    MeteringContext::new(
        FinancialMode::Activated,
        FinancialCapability::Available(journal),
        UsageContext::system(AiFeature::Chat),
        vec![ProviderSupport {
            model: ProviderModel::new(provider, model).unwrap(),
            protocol,
            input_token_ceiling: 100,
            output_token_ceiling: 20,
            zero_usage_is_missing: false,
        }],
    )
}

fn request() -> Request<Bytes> {
    Request::builder()
        .uri("https://example.test/v1/messages")
        .body(Bytes::from_static(br#"{"model":"model","max_tokens":50}"#))
        .unwrap()
}

fn anthropic_response() -> Bytes {
    Bytes::from_static(br#"{"id":"msg-1","content":[{"text":"not JSON"}],"usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":2,"cache_creation_input_tokens":3}}"#)
}

#[test]
fn provider_semantics_are_disjoint() {
    let cases = [
        (
            WireProtocol::Anthropic,
            json!({"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":2,"cache_creation_input_tokens":3}),
            TrustedTokenUsage::from_disjoint(10, 5, 2, 3, 0),
        ),
        (
            WireProtocol::Responses,
            json!({"input_tokens":10,"output_tokens":5,"input_tokens_details":{"cached_tokens":2},"output_tokens_details":{"reasoning_tokens":3}}),
            TrustedTokenUsage::from_disjoint(8, 2, 2, 0, 3),
        ),
        (
            WireProtocol::ChatCompletions,
            json!({"prompt_tokens":10,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":2},"completion_tokens_details":{"reasoning_tokens":3}}),
            TrustedTokenUsage::from_disjoint(8, 2, 2, 0, 3),
        ),
        (
            WireProtocol::Gemini,
            json!({"promptTokenCount":10,"candidatesTokenCount":5,"cachedContentTokenCount":2,"thoughtsTokenCount":3}),
            TrustedTokenUsage::from_disjoint(8, 5, 2, 0, 3),
        ),
    ];
    for (protocol, usage, expected) in cases {
        assert_eq!(normalize(protocol, &usage), Some(expected));
    }
}

#[test]
fn absent_inconsistent_and_unsupported_counters_are_not_zero() {
    assert_eq!(
        normalize(
            WireProtocol::Gemini,
            &json!({"promptTokenCount":10,"candidatesTokenCount":5,"thoughtsTokenCount":3,"totalTokenCount":0})
        ),
        Some(TrustedTokenUsage::from_disjoint(10, 5, 0, 0, 3))
    );
    assert!(
        normalize(
            WireProtocol::Gemini,
            &json!({"promptTokenCount":10,"candidatesTokenCount":5,"totalTokenCount":18})
        )
        .is_none()
    );
    assert!(normalize(WireProtocol::Responses, &json!({"input_tokens":0})).is_none());
    assert!(
        normalize(
            WireProtocol::Gemini,
            &json!({"promptTokenCount":-1,"candidatesTokenCount":2})
        )
        .is_none()
    );
    assert!(
        normalize(
            WireProtocol::Responses,
            &json!({"input_tokens":1,"output_tokens":1,"input_tokens_details":{"cached_tokens":2}})
        )
        .is_none()
    );
    assert!(normalize(WireProtocol::Anthropic, &json!({"input_tokens":1,"output_tokens":1,"cache_creation":{"ephemeral_1h_input_tokens":1}})).is_none());
    let mut facts = Facts::new(WireProtocol::ChatCompletions, true, None);
    facts.response(br#"{"usage":{"prompt_tokens":0,"completion_tokens":0}}"#);
    assert!(matches!(facts.evidence(), UsageEvidence::Missing(_)));
    facts.zero_usage_is_missing = false;
    assert_eq!(
        facts.evidence(),
        UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(0, 0, 0, 0, 0))
    );
}

#[test]
fn repeated_cumulative_sse_counters_and_zero_placeholders_are_not_added() {
    let mut facts = Facts::new(WireProtocol::Anthropic, false, None);
    facts.event(br#"{"type":"message_start","message":{"id":"msg","usage":{"input_tokens":10,"output_tokens":1,"cache_read_input_tokens":2}}}"#);
    for _ in 0..2 {
        facts.event(br#"{"type":"message_delta","usage":{"input_tokens":0,"output_tokens":7,"cache_read_input_tokens":0}}"#);
    }
    assert_eq!(
        facts.evidence(),
        UsageEvidence::Missing(UnresolvedReason::Interrupted)
    );
    facts.event(br#"{"type":"message_stop"}"#);
    assert_eq!(
        facts.evidence(),
        UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(10, 7, 2, 0, 0))
    );
}

#[tokio::test]
async fn funding_is_awaited_and_limits_are_enforced_before_transport() {
    let journal = Arc::new(Journal::default());
    let transport = Transport::new(anthropic_response());
    let client = MeteredHttpClient::new(transport.clone(), "anthropic", WireProtocol::Anthropic);
    context(
        journal.clone(),
        WireProtocol::Anthropic,
        "anthropic",
        "model",
    )
    .scope(async {
        client.send::<_, Bytes>(request()).await.unwrap();
    })
    .await;
    assert_eq!(transport.calls.load(Ordering::SeqCst), 1);
    assert_eq!(transport.bodies.lock().unwrap()[0]["max_tokens"], 20);
    assert_eq!(journal.begins.lock().unwrap().len(), 1);
    assert_eq!(
        journal.finals.lock().unwrap()[0]
            .provider_request_id
            .as_ref()
            .unwrap()
            .as_str(),
        "req-1"
    );
}

#[tokio::test]
async fn multiround_partial_failure_preserves_completed_round_and_stops_retries() {
    let journal = Arc::new(Journal {
        deny_after: Some(1),
        ..Default::default()
    });
    let transport = Transport::new(anthropic_response());
    let client = MeteredHttpClient::new(transport.clone(), "anthropic", WireProtocol::Anthropic);
    context(
        journal.clone(),
        WireProtocol::Anthropic,
        "anthropic",
        "model",
    )
    .scope(async {
        client.send::<_, Bytes>(request()).await.unwrap();
        assert!(client.send::<_, Bytes>(request()).await.is_err());
        assert!(client.send::<_, Bytes>(request()).await.is_err());
    })
    .await;
    assert_eq!(transport.calls.load(Ordering::SeqCst), 1);
    assert_eq!(journal.finals.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn distinct_executions_have_distinct_ids_but_lost_ack_reuses_evidence() {
    let journal = Arc::new(Journal {
        lose_ack: true,
        ..Default::default()
    });
    let client = MeteredHttpClient::new(
        Transport::new(anthropic_response()),
        "anthropic",
        WireProtocol::Anthropic,
    );
    context(
        journal.clone(),
        WireProtocol::Anthropic,
        "anthropic",
        "model",
    )
    .scope(async {
        for _ in 0..2 {
            client.send::<_, Bytes>(request()).await.unwrap();
        }
    })
    .await;
    let begins = journal.begins.lock().unwrap();
    assert_ne!(begins[0].invocation_id, begins[1].invocation_id);
    assert_eq!(begins[0].run_id, begins[1].run_id);
    let deliveries = journal.deliveries.lock().unwrap();
    assert_eq!(deliveries[0], deliveries[1]);
    assert_eq!(journal.finals.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn structured_parse_failure_is_after_evidence_persistence() {
    let journal = Arc::new(Journal::default());
    let client = MeteredHttpClient::new(
        Transport::new(anthropic_response()),
        "anthropic",
        WireProtocol::Anthropic,
    );
    context(
        journal.clone(),
        WireProtocol::Anthropic,
        "anthropic",
        "model",
    )
    .scope(async {
        let response = client
            .send::<_, Bytes>(request())
            .await
            .unwrap()
            .into_body()
            .await
            .unwrap();
        let value: Value = serde_json::from_slice(&response).unwrap();
        assert!(
            serde_json::from_str::<Value>(value["content"][0]["text"].as_str().unwrap()).is_err()
        );
        assert_eq!(journal.finals.lock().unwrap().len(), 1);
    })
    .await;
}

#[tokio::test]
async fn cancellation_or_invalid_tool_consumer_does_not_discard_terminal_evidence() {
    let journal = Arc::new(Journal::default());
    let sse = concat!(
        "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg\",\"usage\":{\"input_tokens\":10,\"output_tokens\":1}}}\r\n\r\n",
        "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":7}}\n\n",
        "data: {\"type\":\"message_stop\"}\n\n"
    );
    let client = MeteredHttpClient::new(Transport::new(sse), "anthropic", WireProtocol::Anthropic);
    context(
        journal.clone(),
        WireProtocol::Anthropic,
        "anthropic",
        "model",
    )
    .scope(async {
        // Drop before reading any body; the provider's completed round still lands.
        drop(client.send_streaming(request()).await.unwrap());
    })
    .await;
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if !journal.finals.lock().unwrap().is_empty() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        journal.finals.lock().unwrap()[0].usage,
        UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(10, 7, 0, 0, 0))
    );
}

#[tokio::test]
async fn lost_transport_after_execution_stays_unresolved() {
    let journal = Arc::new(Journal::default());
    let transport = Transport {
        fail: true,
        ..Transport::new("")
    };
    let client = MeteredHttpClient::new(transport.clone(), "anthropic", WireProtocol::Anthropic);
    context(
        journal.clone(),
        WireProtocol::Anthropic,
        "anthropic",
        "model",
    )
    .scope(async {
        assert!(client.send::<_, Bytes>(request()).await.is_err());
    })
    .await;
    assert_eq!(transport.calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        journal.finals.lock().unwrap()[0].usage,
        UsageEvidence::Missing(UnresolvedReason::Interrupted)
    );
}

#[tokio::test]
async fn absent_support_is_an_activation_gate_not_an_exemption() {
    let journal = Arc::new(Journal::default());
    let transport = Transport::new(anthropic_response());
    let client = MeteredHttpClient::new(transport.clone(), "anthropic", WireProtocol::Anthropic);
    context(
        journal,
        WireProtocol::Anthropic,
        "anthropic",
        "different-model",
    )
    .scope(async {
        assert!(client.send::<_, Bytes>(request()).await.is_err());
    })
    .await;
    assert_eq!(transport.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test(start_paused = true)]
async fn timeout_after_provider_execution_does_not_invent_zero_usage() {
    let journal = Arc::new(Journal::default());
    let transport = Transport {
        stall: true,
        ..Transport::new(anthropic_response())
    };
    let client = MeteredHttpClient::new(transport.clone(), "anthropic", WireProtocol::Anthropic);
    context(
        journal.clone(),
        WireProtocol::Anthropic,
        "anthropic",
        "model",
    )
    .scope(async {
        assert!(client.send::<_, Bytes>(request()).await.is_err());
    })
    .await;
    assert_eq!(transport.calls.load(Ordering::SeqCst), 1);
    let finals = journal.finals.lock().unwrap();
    assert_eq!(finals[0].outcome, ProviderOutcome::Unknown);
    assert_eq!(
        finals[0].usage,
        UsageEvidence::Missing(UnresolvedReason::Interrupted)
    );
}

#[tokio::test]
async fn rig_invalid_tool_retry_is_two_authorized_executions() {
    use crate::{AgentLoop, StreamPart};
    use ai_toolset::AsyncToolCollection;
    use ai_usage::NoOpUsageRecorder;
    use rig_core::client::CompletionClient;
    use rig_core::providers::gemini;

    let journal = Arc::new(Journal::default());
    let bad = json!({"responseId":"bad", "candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"unknown_tool","args":{}}}]},"finishReason":"STOP"}], "usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":2}});
    let good = json!({"responseId":"good", "candidates":[{"content":{"role":"model","parts":[{"text":"done"}]},"finishReason":"STOP"}], "usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":3}});
    let transport = Transport::default();
    transport
        .remaining
        .lock()
        .unwrap()
        .extend([bad, good].map(|event| Bytes::from(format!("data: {event}\n\n"))));
    let client = gemini::Client::builder()
        .api_key("test")
        .http_client(MeteredHttpClient::new(
            transport.clone(),
            "google",
            WireProtocol::Gemini,
        ))
        .build()
        .unwrap();
    let agent = AgentLoop::new(Arc::new(NoOpUsageRecorder)).with_max_tokens(20);
    let mut session = context(journal.clone(), WireProtocol::Gemini, "google", "model")
        .scope(agent.test_session(
            Arc::new(AsyncToolCollection::<()>::new()),
            Arc::new(()),
            "system",
            UsageContext::system(AiFeature::Chat),
            client.completion_model("model"),
        ))
        .await;
    // The session and its spawned driver retain the scope after construction.
    let mut stream = session
        .send_message(vec![rig_core::message::Message::user("hello")])
        .await
        .unwrap();
    let mut output = String::new();
    while let Some(item) = stream.next().await {
        if let StreamPart::Content(text) = item.unwrap() {
            output.push_str(&text);
        }
    }
    assert_eq!(output, "done");
    assert_eq!(transport.calls.load(Ordering::SeqCst), 2);
    let finals = journal.finals.lock().unwrap();
    assert_eq!(finals.len(), 2);
    assert_ne!(finals[0].invocation_id, finals[1].invocation_id);
    assert_eq!(
        finals[0].usage,
        UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(10, 2, 0, 0, 0))
    );
}

#[tokio::test]
async fn routing_fallback_is_attributed_to_actual_provider_and_wire_model() {
    use crate::model::router::{ModelRouter, RoutedModel};
    use rig_agent::agent::AgentBuilder;
    use rig_agent::completion::Prompt;
    use rig_core::providers::{anthropic, openai};

    let journal = Arc::new(Journal::default());
    let transport = Transport::new(anthropic_response());
    let anthropic = anthropic::Client::builder()
        .api_key("test")
        .http_client(MeteredHttpClient::new(
            transport.clone(),
            "anthropic",
            WireProtocol::Anthropic,
        ))
        .build()
        .unwrap();
    let openai = openai::Client::builder()
        .api_key("test")
        .http_client(MeteredHttpClient::new(
            transport.clone(),
            "openai",
            WireProtocol::Responses,
        ))
        .build()
        .unwrap();
    let router = ModelRouter::new(anthropic, openai);
    let routed = router.route_or_default("unknown/model");
    let model = routed.model_name().to_owned();
    let RoutedModel::Anthropic(routed) = routed else {
        panic!("expected native fallback")
    };
    context(
        journal.clone(),
        WireProtocol::Anthropic,
        "anthropic",
        &model,
    )
    .scope(async {
        // Deliberately malformed SDK response, but wire usage is persisted first.
        let agent = AgentBuilder::new(routed.completion())
            .max_tokens(20)
            .build();
        let _ = agent.prompt("hello").await;
    })
    .await;
    let begins = journal.begins.lock().unwrap();
    assert_eq!(begins.len(), 1);
    assert_eq!(
        begins[0].model,
        ProviderModel::new("anthropic", model).unwrap()
    );
    assert_eq!(journal.finals.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn responses_sdk_uses_the_capped_wire_budget_and_preserves_usage_on_parse_error() {
    use rig_agent::agent::AgentBuilder;
    use rig_agent::completion::Prompt;
    use rig_core::client::CompletionClient;
    use rig_core::providers::openai;

    let journal = Arc::new(Journal::default());
    let transport = Transport::new(Bytes::from(
        json!({"usage": {
            "input_tokens": 10, "output_tokens": 5, "input_tokens_details": {"cached_tokens": 2},
            "output_tokens_details": {"reasoning_tokens": 3}
        }})
        .to_string(),
    ));
    let client = openai::Client::builder()
        .api_key("test")
        .http_client(MeteredHttpClient::new(
            transport.clone(),
            "openai",
            WireProtocol::Responses,
        ))
        .build()
        .unwrap();
    let agent = AgentBuilder::new(client.completion_model("model"))
        .max_tokens(50)
        .build();
    context(journal.clone(), WireProtocol::Responses, "openai", "model")
        .scope(async {
            assert!(agent.prompt("hello").await.is_err());
        })
        .await;
    assert_eq!(transport.bodies.lock().unwrap()[0]["max_output_tokens"], 20);
    assert_eq!(
        journal.finals.lock().unwrap()[0].usage,
        UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(8, 2, 2, 0, 3))
    );
}

#[tokio::test]
async fn compatible_sdk_authorizes_the_account_qualified_wire_model() {
    use crate::model::openai::OpenAiChatCompletionsModel;
    use crate::model::types::Model;
    use rig_agent::agent::AgentBuilder;
    use rig_agent::completion::Prompt;
    use rig_core::providers::openai;

    let journal = Arc::new(Journal::default());
    let transport = Transport::new(Bytes::from(json!({"usage": {
        "prompt_tokens": 10, "completion_tokens": 5, "prompt_tokens_details": {"cached_tokens": 2},
        "completion_tokens_details": {"reasoning_tokens": 3}
    }}).to_string()));
    let client = openai::CompletionsClient::builder()
        .api_key("test")
        .http_client(MeteredHttpClient::new(
            transport.clone(),
            "fireworks",
            WireProtocol::ChatCompletions,
        ))
        .build()
        .unwrap();
    let model = OpenAiChatCompletionsModel::new(
        Model::try_from("fireworks/kimi").unwrap(),
        Arc::new(client),
    );
    let agent = AgentBuilder::new(model.completion()).max_tokens(50).build();
    context(
        journal.clone(),
        WireProtocol::ChatCompletions,
        "fireworks",
        "accounts/fireworks/models/kimi",
    )
    .scope(async {
        assert!(agent.prompt("hello").await.is_err());
    })
    .await;
    assert_eq!(transport.bodies.lock().unwrap()[0]["max_tokens"], 20);
    assert_eq!(
        journal.begins.lock().unwrap()[0].model.model(),
        "accounts/fireworks/models/kimi"
    );
    assert_eq!(
        journal.finals.lock().unwrap()[0].usage,
        UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(8, 2, 2, 0, 3))
    );
}

#[test]
fn incomplete_stream_snapshots_are_never_promoted_to_final_usage() {
    let mut gemini = Facts::new(WireProtocol::Gemini, false, None);
    gemini.event(br#"{"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":2}}"#);
    gemini.event(br#"{"candidates":[{"finishReason":"STOP"}]}"#);
    assert!(matches!(gemini.evidence(), UsageEvidence::Missing(_)));
    let mut anthropic = Facts::new(WireProtocol::Anthropic, false, None);
    anthropic.event(
        br#"{"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1}}}"#,
    );
    anthropic.event(br#"{"type":"error"}"#);
    assert!(matches!(anthropic.evidence(), UsageEvidence::Missing(_)));
    let mut chat = Facts::new(WireProtocol::ChatCompletions, false, None);
    chat.event(br#"{"choices":[{}],"usage":{"prompt_tokens":10,"completion_tokens":2}}"#);
    chat.event(b"[DONE]");
    assert!(matches!(chat.evidence(), UsageEvidence::Missing(_)));
}

#[tokio::test]
async fn replayed_admission_never_executes_again() {
    let journal = Arc::new(Journal {
        replay_begin: true,
        ..Default::default()
    });
    let transport = Transport::new(anthropic_response());
    let client = MeteredHttpClient::new(transport.clone(), "anthropic", WireProtocol::Anthropic);
    context(journal, WireProtocol::Anthropic, "anthropic", "model")
        .scope(async {
            assert!(client.send::<_, Bytes>(request()).await.is_err());
        })
        .await;
    assert_eq!(transport.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn non_success_http_status_still_retains_reported_usage() {
    let journal = Arc::new(Journal::default());
    let context = context(
        journal.clone(),
        WireProtocol::Anthropic,
        "anthropic",
        "model",
    );
    let attempt = context
        .begin(
            ProviderModel::new("anthropic", "model").unwrap(),
            WireProtocol::Anthropic,
            &mut json!({"max_tokens":20}),
        )
        .await
        .unwrap();
    let error = http_client::Error::InvalidStatusCodeWithMessage(
        reqwest::StatusCode::INTERNAL_SERVER_ERROR,
        String::from_utf8(anthropic_response().to_vec()).unwrap(),
    );
    finish_failure(attempt, &error).await.unwrap();
    let finals = journal.finals.lock().unwrap();
    assert_eq!(finals[0].outcome, ProviderOutcome::Failed);
    assert!(matches!(finals[0].usage, UsageEvidence::Reported(_)));
    assert_eq!(
        finals[0].provider_request_id.as_ref().unwrap().as_str(),
        "msg-1"
    );
}

#[tokio::test]
async fn provider_excess_is_not_clipped_to_the_authorized_budget() {
    let journal = Arc::new(Journal::default());
    let transport = Transport::new(Bytes::from(
        json!({"usage":{"input_tokens":10,"output_tokens":1000}}).to_string(),
    ));
    let client = MeteredHttpClient::new(transport, "anthropic", WireProtocol::Anthropic);
    context(
        journal.clone(),
        WireProtocol::Anthropic,
        "anthropic",
        "model",
    )
    .scope(async {
        client.send::<_, Bytes>(request()).await.unwrap();
    })
    .await;
    assert_eq!(journal.begins.lock().unwrap()[0].token_budget.output(), 20);
    // The funding domain needs the full excess to classify Macro-absorbed usage;
    // the producer must neither truncate it nor invent customer liability.
    assert_eq!(
        journal.finals.lock().unwrap()[0].usage,
        UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(10, 1000, 0, 0, 0))
    );
}
