use super::*;
use crate::ModelSpeed;
use ai_usage::{UsageAmount, UsageEvent, UsageRecorder};

#[derive(Default)]
struct Recorder(Mutex<Vec<UsageEvent>>);
impl UsageRecorder for Recorder {
    fn record(&self, event: UsageEvent) {
        self.0.lock().unwrap().push(event);
    }
}

#[tokio::test]
async fn responses_transport_prices_actual_tier_and_rejects_mismatched_request() {
    let recorder = Arc::new(Recorder::default());
    let context = MeteringContext::for_session(
        recorder.clone(),
        &UsageContext::new(
            AiFeature::Chat,
            "macro|speed@example.com".to_owned().try_into().unwrap(),
        ),
        "openai/gpt-6.1-sol",
        ModelSpeed::Ultrafast,
    )
    .unwrap();
    let transport = Transport::new(json!({"status":"completed", "service_tier":"ultrafast", "usage":{"input_tokens":100,"output_tokens":20,"input_tokens_details":{"cached_tokens":30},"output_tokens_details":{"reasoning_tokens":5}}}).to_string());
    let client = MeteredHttpClient::new(transport.clone(), "openai", WireProtocol::Responses);
    context
        .scope(async {
            for tier in ["ultrafast", "default"] {
                let request = Request::builder()
                    .uri("https://example.test/responses")
                    .body(Bytes::from(
                        json!({"model":"gpt-6.1-sol","service_tier":tier}).to_string(),
                    ))
                    .unwrap();
                let result = client.send::<_, Bytes>(request).await;
                assert_eq!(result.is_ok(), tier == "ultrafast");
            }
        })
        .await;
    assert_eq!(transport.calls.load(Ordering::SeqCst), 1);
    let events = recorder.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].model, "gpt-6.1-sol:ultrafast");
    assert!(matches!(
        events[0].amount,
        UsageAmount::Tokens {
            input: 70,
            output: 20,
            cache_read: 30,
            ..
        }
    ));
}

#[tokio::test]
async fn streaming_prices_completed_openai_and_claude_tiers_once() {
    for (model, protocol, speed, body, wire, expected) in [
        (
            "openai/gpt-6-astra",
            WireProtocol::Responses,
            ModelSpeed::Ultrafast,
            json!({"model":"gpt-6-astra","service_tier":"ultrafast"}),
            "data: {\"type\":\"response.completed\",\"response\":{\"service_tier\":\"ultrafast\",\"usage\":{\"input_tokens\":10,\"output_tokens\":20}}}\n\n",
            "gpt-6-astra:ultrafast",
        ),
        (
            "anthropic/claude-opus-5-5",
            WireProtocol::Anthropic,
            ModelSpeed::Fast,
            json!({"model":"claude-opus-5-5","speed":"fast"}),
            "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"speed\":\"fast\",\"input_tokens\":10,\"output_tokens\":1,\"cache_read_input_tokens\":5,\"cache_creation_input_tokens\":3}}}\n\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":20}}\n\ndata: {\"type\":\"message_stop\"}\n\n",
            "claude-opus-5-5:fast",
        ),
        (
            "anthropic/claude-opus-5-5",
            WireProtocol::Anthropic,
            ModelSpeed::Fast,
            json!({"model":"claude-opus-5-5","speed":"fast"}),
            "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"speed\":\"standard\",\"input_tokens\":10,\"output_tokens\":1}}}\n\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":20}}\n\ndata: {\"type\":\"message_stop\"}\n\n",
            "claude-opus-5-5",
        ),
    ] {
        let recorder = Arc::new(Recorder::default());
        let context = MeteringContext::for_session(
            recorder.clone(),
            &UsageContext::system(AiFeature::Chat),
            model,
            speed,
        )
        .unwrap();
        let provider = model.split_once('/').unwrap().0;
        let transport = Transport::new(wire);
        let client = MeteredHttpClient::new(transport.clone(), provider, protocol);
        context
            .scope(async {
                let request = Request::builder()
                    .uri("https://example.test/api")
                    .header("anthropic-beta", "existing-beta")
                    .body(Bytes::from(body.to_string()))
                    .unwrap();
                let mut stream = client.send_streaming(request).await.unwrap().into_body();
                while let Some(chunk) = stream.next().await {
                    chunk.unwrap();
                }
            })
            .await;
        let events = recorder.0.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].model, expected);
        assert!(matches!(
            events[0].amount,
            UsageAmount::Tokens {
                input: 10,
                output: 20,
                ..
            }
        ));
        if expected.ends_with(":fast") {
            assert!(matches!(
                events[0].amount,
                UsageAmount::Tokens {
                    cache_read: 5,
                    cache_write: 3,
                    ..
                }
            ));
        }
        if provider == "anthropic" {
            let headers = transport.headers.lock().unwrap();
            let beta = headers[0]["anthropic-beta"].to_str().unwrap();
            assert!(beta.contains("existing-beta"));
            assert!(beta.contains("fast-mode-2026-02-01"));
        }
    }
}

#[tokio::test]
async fn child_completion_does_not_inherit_parent_speed_pricing() {
    let recorder = Arc::new(Recorder::default());
    let usage = UsageContext::system(AiFeature::Chat);
    let parent = MeteringContext::for_session(
        recorder.clone(),
        &usage,
        "openai/gpt-6-astra",
        ModelSpeed::Ultrafast,
    )
    .unwrap();
    let transport = Transport::new(anthropic_response());
    let client = MeteredHttpClient::new(transport.clone(), "anthropic", WireProtocol::Anthropic);
    parent
        .scope(async {
            let child = MeteringContext::for_operation(recorder.as_ref(), &usage);
            MeteringContext::carry(child, async {
                client
                    .send::<_, Bytes>(request())
                    .await
                    .unwrap()
                    .into_body()
                    .await
                    .unwrap();
            })
            .await;
        })
        .await;
    assert_eq!(transport.calls.load(Ordering::SeqCst), 1);
    assert!(recorder.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn missing_delivered_tier_preserves_legacy_provider_results() {
    for (protocol, model, speed, request_body, response) in [
        (
            WireProtocol::Responses,
            "openai/gpt-6-astra",
            ModelSpeed::Ultrafast,
            json!({"model":"gpt-6-astra","service_tier":"ultrafast"}),
            json!({"status":"completed","usage":{"input_tokens":10,"output_tokens":20}}),
        ),
        (
            WireProtocol::Anthropic,
            "anthropic/claude-opus-5-5",
            ModelSpeed::Fast,
            json!({"model":"claude-opus-5-5","speed":"fast"}),
            json!({"usage":{"input_tokens":10,"output_tokens":20}}),
        ),
    ] {
        let recorder = Arc::new(Recorder::default());
        let context = MeteringContext::for_session(
            recorder.clone(),
            &UsageContext::system(AiFeature::Chat),
            model,
            speed,
        )
        .unwrap();
        let provider = model.split_once('/').unwrap().0;
        let client =
            MeteredHttpClient::new(Transport::new(response.to_string()), provider, protocol);
        context
            .scope(async {
                let request = Request::builder()
                    .uri("https://example.test/api")
                    .body(Bytes::from(request_body.to_string()))
                    .unwrap();
                let delivered = client.send::<_, Bytes>(request).await.unwrap();
                assert_eq!(
                    delivered.into_body().await.unwrap(),
                    Bytes::from(response.to_string())
                );
            })
            .await;
        assert!(recorder.0.lock().unwrap().is_empty());
    }
}

#[test]
fn model_call_span_records_the_tier_and_effort_sent() {
    use opentelemetry::trace::TracerProvider as _;
    use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
    use tracing_subscriber::layer::SubscriberExt as _;

    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let layer = tracing_opentelemetry::layer().with_tracer(provider.tracer("test"));
    let _guard = tracing::subscriber::set_default(tracing_subscriber::registry().with(layer));
    tracing::callsite::rebuild_interest_cache();

    for (protocol, body) in [
        (
            WireProtocol::Responses,
            json!({"model":"gpt-6.1-sol","service_tier":"priority","reasoning":{"effort":"xhigh"}}),
        ),
        (
            WireProtocol::Anthropic,
            json!({"model":"claude-opus-5-5","speed":"fast","service_tier":"auto","output_config":{"effort":"low"}}),
        ),
        (WireProtocol::Responses, json!({"model":"gpt-5.5"})),
    ] {
        let span = tracing::info_span!("chat_streaming");
        record_request_settings(&span, protocol, &body);
    }

    provider.force_flush().unwrap();
    let attributes: Vec<Vec<(String, String)>> = exporter
        .get_finished_spans()
        .unwrap()
        .iter()
        .map(|span| {
            let mut attributes: Vec<_> = span
                .attributes
                .iter()
                .filter(|kv| {
                    [
                        attr::OPENAI_REQUEST_SERVICE_TIER,
                        attr::MACRO_REQUEST_REASONING_EFFORT,
                        attr::MACRO_REQUEST_SPEED,
                    ]
                    .contains(&kv.key.as_str())
                })
                .map(|kv| (kv.key.to_string(), kv.value.to_string()))
                .collect();
            attributes.sort();
            attributes
        })
        .collect();
    let pair = |key: &str, value: &str| (key.to_owned(), value.to_owned());
    assert_eq!(
        attributes,
        [
            vec![
                pair(attr::MACRO_REQUEST_REASONING_EFFORT, "xhigh"),
                pair(attr::OPENAI_REQUEST_SERVICE_TIER, "priority"),
            ],
            vec![
                pair(attr::MACRO_REQUEST_REASONING_EFFORT, "low"),
                pair(attr::MACRO_REQUEST_SPEED, "fast"),
            ],
            vec![],
        ]
    );
}
