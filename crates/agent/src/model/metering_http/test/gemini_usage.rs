use super::*;
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolResult,
};
use schemars::JsonSchema;
use serde::Deserialize;

#[derive(Deserialize, JsonSchema)]
#[schemars(title = "lookup", description = "Look up a named item.")]
struct Lookup {
    name: String,
}

impl ToolAnnotated for Lookup {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Lookup");
}

#[async_trait::async_trait]
impl AsyncTool<()> for Lookup {
    type Output = String;

    async fn call(&self, _: ServiceContext<()>, _: RequestContext) -> ToolResult<Self::Output> {
        Ok(self.name.clone())
    }
}

#[test]
fn gemini_4_auth_rejects_every_other_authority_before_attaching_the_key() {
    use crate::model::gemini::authorize_gemini_4_request;

    for origin in [
        "https://example.test",
        "https://generativelanguage.googleapis.com:443",
        "http://generativelanguage.googleapis.com",
    ] {
        let mut request = Request::post(format!(
            "{origin}/v1beta/models/gemini-4-neon:streamGenerateContent?alt=sse&key=header"
        ))
        .body(())
        .unwrap();
        assert!(
            authorize_gemini_4_request(
                &mut request,
                &HeaderValue::from_static("fixture-frontier"),
                &[crate::GEMINI_4_NEON]
            )
            .is_none()
        );
        assert!(!request.headers().contains_key("x-goog-api-key"));
    }
}

#[tokio::test]
async fn gemini_4_json_uses_a_sensitive_header_and_scope_excludes_flash() {
    use crate::model::gemini::gemini_4_client;
    use rig_core::{client::CompletionClient, completion::CompletionModel, providers::gemini};

    let transport = Transport::new(
        json!({"candidates": [{"content": {"role": "model", "parts": [{"text": "done"}]},
            "finishReason": "STOP"}]})
        .to_string(),
    );
    let frontier = gemini_4_client(
        transport.clone(),
        "fixture-frontier",
        &[crate::GEMINI_4_NEON],
    )
    .unwrap();
    frontier
        .completion_model("gemini-4-neon")
        .completion_request("hello")
        .send()
        .await
        .unwrap();
    for disabled in ["gemini-3.8-flash", "gemini-4-carbon"] {
        assert!(
            frontier
                .completion_model(disabled)
                .completion_request("hello")
                .send()
                .await
                .is_err()
        );
    }

    let flash = gemini::Client::builder()
        .api_key("fixture-flash")
        .http_client(MeteredHttpClient::new(
            transport.clone(),
            "google",
            WireProtocol::Gemini,
        ))
        .build()
        .unwrap();
    flash
        .completion_model("gemini-3.8-flash")
        .completion_request("hello")
        .send()
        .await
        .unwrap();
    let uris = transport.uris.lock().unwrap();
    let headers = transport.headers.lock().unwrap();
    assert_eq!(uris.len(), 2);
    assert_eq!(
        uris[0].to_string(),
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-neon:generateContent"
    );
    assert_eq!(headers[0]["x-goog-api-key"], "fixture-frontier");
    assert!(headers[0]["x-goog-api-key"].is_sensitive());
    assert!(!format!("{:?}", headers[0]).contains("fixture-frontier"));
    assert_eq!(uris[1].query(), Some("key=fixture-flash"));
    assert!(!headers[1].contains_key("x-goog-api-key"));
}

#[tokio::test]
async fn gemini_4_parallel_tool_replay_meters_final_usage_for_each_request() {
    use crate::model::{
        gemini::{GeminiModel, gemini_4_client},
        types::Model,
    };
    use crate::{AgentLoop, StreamPart};
    use ai_usage::NoOpUsageRecorder;

    for slug in ["gemini-4-neon", "gemini-4-carbon"] {
        let owner =
            macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|user@example.com")
                .unwrap();
        let usage = UsageContext::new(AiFeature::AgentSession, owner.clone()).with_entity(Some(
            "00000000-0000-4000-8000-000000000042".parse().unwrap(),
        ));
        let journal = Arc::new(Journal::default());
        let transport = Transport::default();
        let calls = json!({
            "responseId": "calls",
            "candidates": [{
                "content": {"role": "model", "parts": [
                    {"functionCall": {"id": "call-a", "name": "lookup", "args": {"name": "one"}},
                     "thoughtSignature": "dGVzdC1zaWduYXR1cmU="},
                    {"functionCall": {"id": "call-b", "name": "lookup", "args": {"name": "two"}}}
                ]},
                "finishReason": "STOP"
            }],
            "usageMetadata": {"promptTokenCount": 70, "cachedContentTokenCount": 50,
                "candidatesTokenCount": 3, "thoughtsTokenCount": 4, "totalTokenCount": 77}
        });
        let interim = json!({
            "responseId": "reply",
            "candidates": [{"content": {"role": "model", "parts": [{"text": "All "}]}}],
            "usageMetadata": {"promptTokenCount": 90, "candidatesTokenCount": 1}
        });
        let reply = json!({
            "responseId": "reply",
            "candidates": [{"content": {"role": "model", "parts": [{"text": "done"}]},
                "finishReason": "STOP"}],
            "usageMetadata": {"promptTokenCount": 90, "cachedContentTokenCount": 60,
                "candidatesTokenCount": 2, "thoughtsTokenCount": 5, "totalTokenCount": 97}
        });
        transport.remaining.lock().unwrap().extend([
            Bytes::from(format!("data: {calls}\r\n\r\n")),
            Bytes::from(format!("data: {interim}\r\n\r\ndata: {reply}\r\n\r\n")),
        ]);
        let client = gemini_4_client(
            transport.clone(),
            "fixture-frontier",
            &[crate::GEMINI_4_NEON, crate::GEMINI_4_CARBON],
        )
        .unwrap();
        let id = format!("google/{slug}");
        let model = GeminiModel::new(Model::try_from(id.as_str()).unwrap(), Arc::new(client));
        let agent = AgentLoop::new(Arc::new(NoOpUsageRecorder))
            .with_model(&id)
            .with_max_tokens(20);
        let mut session = MeteringContext::new(
            FinancialMode::Activated,
            FinancialCapability::Available(journal.clone()),
            usage.clone(),
            vec![ProviderSupport {
                model: ProviderModel::new("google", slug).unwrap(),
                protocol: WireProtocol::Gemini,
                input_token_ceiling: 100,
                output_token_ceiling: 20,
                zero_usage_is_missing: false,
            }],
        )
        .scope(agent.test_session(
            Arc::new(AsyncToolCollection::<()>::new().add_tool::<Lookup, ()>()),
            Arc::new(()),
            "system",
            usage.clone(),
            model.completion(),
        ))
        .await;
        let mut stream = session
            .send_message(vec![rig_core::message::Message::user("Look up both items")])
            .await
            .unwrap();
        let mut output = String::new();
        while let Some(part) = stream.next().await {
            if let StreamPart::Content(text) = part.unwrap() {
                output.push_str(&text);
            }
        }
        assert_eq!(output, "All done", "{slug}");

        let uris = transport.uris.lock().unwrap();
        assert_eq!(uris.len(), 2);
        for uri in uris.iter() {
            assert_eq!(
                uri.to_string(),
                format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{slug}:streamGenerateContent?alt=sse"
                ),
            );
        }
        for headers in transport.headers.lock().unwrap().iter() {
            assert_eq!(headers["x-goog-api-key"], "fixture-frontier");
            assert!(headers["x-goog-api-key"].is_sensitive());
        }

        let bodies = transport.bodies.lock().unwrap();
        assert_eq!(bodies.len(), 2, "{slug}");
        let calls = &bodies[1]["contents"][1]["parts"];
        let responses = &bodies[1]["contents"][2]["parts"];
        for (index, id) in ["call-a", "call-b"].iter().enumerate() {
            assert_eq!(calls[index]["functionCall"]["id"], *id, "{slug}");
            assert_eq!(responses[index]["functionResponse"]["id"], *id, "{slug}");
            assert_eq!(
                responses[index]["functionResponse"]["name"], "lookup",
                "{slug}"
            );
        }
        assert_eq!(calls[0]["thoughtSignature"], "dGVzdC1zaWduYXR1cmU=");
        assert!(calls[1].get("thoughtSignature").is_none());

        let begins = journal.begins.lock().unwrap();
        assert_eq!(begins.len(), 2);
        assert_eq!(begins[0].run_id, begins[1].run_id);
        assert_ne!(begins[0].invocation_id, begins[1].invocation_id);
        assert!(begins.iter().all(|attempt| attempt.model
            == ProviderModel::new("google", slug).unwrap()
            && attempt.user == owner
            && attempt.feature == usage.feature
            && attempt.entity == usage.entity));
        let finals = journal.finals.lock().unwrap();
        assert_eq!(finals.len(), 2);
        assert_eq!(
            finals[0].usage,
            UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(20, 3, 50, 0, 4))
        );
        assert_eq!(
            finals[1].usage,
            UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(30, 2, 60, 0, 5))
        );
    }
}

/// See `metering_http::interim_usage`.
#[tokio::test]
async fn the_chat_span_records_the_final_chunks_cache_read_for_gemini() {
    use crate::{AgentLoop, StreamPart};
    use ai_toolset::AsyncToolCollection;
    use ai_usage::NoOpUsageRecorder;
    use opentelemetry::trace::TracerProvider as _;
    use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
    use rig_core::client::CompletionClient;
    use rig_core::providers::gemini;
    use tracing_subscriber::layer::SubscriberExt as _;

    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let layer = tracing_opentelemetry::layer().with_tracer(provider.tracer("test"));
    let _guard = tracing::subscriber::set_default(tracing_subscriber::registry().with(layer));
    tracing::callsite::rebuild_interest_cache();

    let journal = Arc::new(Journal::default());
    let transport = Transport::new(concat!(
        "data: {\"responseId\":\"r\",\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"text\":\"do\"}]}}],",
        "\"usageMetadata\":{\"promptTokenCount\":90,\"candidatesTokenCount\":1,\"totalTokenCount\":91}}\r\n\r\n",
        "data: {\"responseId\":\"r\",\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"text\":\"ne\"}]},\"finishReason\":\"STOP\"}],",
        "\"usageMetadata\":{\"promptTokenCount\":90,\"candidatesTokenCount\":2,\"cachedContentTokenCount\":60,\"totalTokenCount\":92}}\r\n\r\n",
    ));
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
    drop(stream);
    drop(session);
    provider.force_flush().unwrap();

    assert_eq!(output, "done");
    assert_eq!(
        journal.finals.lock().unwrap()[0].usage,
        UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(30, 2, 60, 0, 0))
    );
    // The attribute's first write on the chat span, the one readers show.
    let spans = exporter.get_finished_spans().unwrap();
    let chat = spans
        .iter()
        .find(|span| {
            span.attributes.iter().any(|attribute| {
                attribute.key.as_str() == "gen_ai.operation.name"
                    && attribute.value.as_str() == "chat"
            })
        })
        .unwrap();
    let mut cache_read = None;
    let mut output = None;
    for attribute in &chat.attributes {
        match attribute.key.as_str() {
            "gen_ai.usage.cache_read.input_tokens" if cache_read.is_none() => {
                cache_read = Some(attribute.value.as_str().into_owned());
            }
            "gen_ai.usage.output_tokens" if output.is_none() => {
                output = Some(attribute.value.as_str().into_owned());
            }
            _ => {}
        }
    }
    assert_eq!(cache_read.as_deref(), Some("60"));
    assert_eq!(output.as_deref(), Some("2"));
}
