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
impl AsyncTool<Arc<AtomicUsize>> for Lookup {
    type Output = String;

    async fn call(
        &self,
        count: ServiceContext<Arc<AtomicUsize>>,
        _: RequestContext,
    ) -> ToolResult<Self::Output> {
        count.0.fetch_add(1, Ordering::SeqCst);
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
    use crate::model::gemini::{gemini_4_client, gemini_4_key};
    use rig_core::{client::CompletionClient, completion::CompletionModel, providers::gemini};

    let transport = Transport::new(
        json!({"candidates": [{"content": {"role": "model", "parts": [{"text": "done"}]},
            "finishReason": "STOP"}]})
        .to_string(),
    );
    let frontier = gemini_4_client(
        transport.clone(),
        gemini_4_key("fixture-frontier").unwrap(),
        &[crate::GEMINI_4_NEON],
        None,
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
    assert!(!headers[0].contains_key("authorization"));
    assert!(!format!("{:?}", headers[0]).contains("fixture-frontier"));
    assert_eq!(uris[1].query(), Some("key=fixture-flash"));
    assert!(!headers[1].contains_key("x-goog-api-key"));
}

#[tokio::test]
async fn gemini_4_parallel_tool_replay_meters_final_usage_for_each_request() {
    use crate::model::{
        gemini::{GeminiModel, gemini_4_client, gemini_4_key},
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
            "candidates": [{"content": {"role": "model", "parts": [
                {"text": "done", "thoughtSignature": "dmlzaWJsZQ=="},
                {"text": "", "thoughtSignature": "ZW1wdHk="}
            ]},
                "finishReason": "STOP"}],
            "usageMetadata": {"promptTokenCount": 90, "cachedContentTokenCount": 60,
                "candidatesTokenCount": 2, "thoughtsTokenCount": 5, "totalTokenCount": 97}
        });
        let mut tool_parts = calls.clone();
        let last = tool_parts["candidates"][0].as_object_mut().unwrap();
        last.remove("finishReason");
        tool_parts.as_object_mut().unwrap().remove("usageMetadata");
        let mut tool_stop = calls;
        tool_stop["candidates"][0]["content"]["parts"] = json!([]);
        transport.remaining.lock().unwrap().extend([
            Bytes::from(format!(
                "data: {tool_parts}\r\n\r\ndata: {tool_stop}\r\n\r\n"
            )),
            Bytes::from(format!("data: {interim}\r\n\r\ndata: {reply}\r\n\r\n")),
        ]);
        let id = format!("google/{slug}");
        let replay = crate::Gemini4ReplaySession::new(&id, vec![]).unwrap();
        let client = gemini_4_client(
            transport.clone(),
            gemini_4_key("fixture-frontier").unwrap(),
            &[crate::GEMINI_4_NEON, crate::GEMINI_4_CARBON],
            Some(replay.clone()),
        )
        .unwrap();
        let model = GeminiModel::new(Model::try_from(id.as_str()).unwrap(), Arc::new(client));
        let agent = AgentLoop::new(Arc::new(NoOpUsageRecorder))
            .with_model(&id)
            .with_max_tokens(20)
            .test_with_gemini_4_replay(replay.clone());
        let effects = Arc::new(AtomicUsize::new(0));
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
        .scope(
            agent.test_session(
                Arc::new(
                    AsyncToolCollection::<Arc<AtomicUsize>>::new()
                        .add_tool::<Lookup, Arc<AtomicUsize>>(),
                ),
                Arc::new(effects.clone()),
                "system",
                usage.clone(),
                model.completion(),
            ),
        )
        .await;
        let mut stream = session
            .send_message(vec![rig_core::message::Message::user("Look up both items")])
            .await
            .unwrap();
        let mut output = String::new();
        let mut accumulation = crate::StreamAccumulator::new();
        while let Some(part) = stream.next().await {
            let part = part.unwrap();
            if let StreamPart::Content(text) = &part {
                output.push_str(text);
            }
            accumulation.push(part);
        }
        assert_eq!(output, "All done", "{slug}");
        assert_eq!(effects.load(Ordering::SeqCst), 2, "{slug}");
        let saved = replay.complete().unwrap();
        let rounds = saved.assistant_rounds(&accumulation.into_parts()).unwrap();
        assert_eq!(rounds.len(), 2, "{slug}");
        let saved = serde_json::to_value(saved).unwrap();
        assert_eq!(
            saved["responses"][1]["parts"][1]["Text"]["signature"],
            "dmlzaWJsZQ=="
        );
        assert_eq!(
            saved["responses"][1]["parts"][2]["Text"]["signature"],
            "ZW1wdHk="
        );

        let cold_replay =
            crate::Gemini4ReplaySession::new(&id, vec![serde_json::from_value(saved).unwrap()])
                .unwrap();
        let cold = Transport::new(format!("data: {reply}\r\n\r\n"));
        let client = gemini_4_client(
            cold.clone(),
            gemini_4_key("fixture-frontier").unwrap(),
            &[crate::GEMINI_4_NEON, crate::GEMINI_4_CARBON],
            Some(cold_replay),
        )
        .unwrap();
        let mut history = vec![rig_core::message::Message::user("Look up both items")];
        history.extend(crate::to_rig_messages(
            &rounds
                .into_iter()
                .map(|parts| crate::types::ChatMessage {
                    role: crate::types::Role::Assistant,
                    content: crate::types::ChatMessageContent::AssistantMessageParts(parts),
                    attachments: None,
                })
                .collect::<Vec<_>>(),
        ));
        use rig_core::{client::CompletionClient, completion::CompletionModel};
        let mut next = client
            .completion_model(slug)
            .completion_request("continue")
            .messages(history)
            .stream()
            .await
            .unwrap();
        while let Some(part) = next.next().await {
            part.unwrap();
        }
        let cold_bodies = cold.bodies.lock().unwrap();
        assert_eq!(cold_bodies.len(), 1);
        let history = &cold_bodies[0]["contents"];
        assert_eq!(
            history[1]["parts"][0]["thoughtSignature"],
            "dGVzdC1zaWduYXR1cmU="
        );
        assert_eq!(
            history[3]["parts"],
            reply["candidates"][0]["content"]["parts"]
                .as_array()
                .map(|parts| {
                    let mut parts = parts.clone();
                    parts.insert(0, json!({"text": "All "}));
                    Value::Array(parts)
                })
                .unwrap()
        );

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
            assert!(!headers.contains_key("authorization"));
            assert!(!format!("{headers:?}").contains("fixture-frontier"));
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

#[tokio::test]
async fn gemini_4_does_not_execute_tools_before_a_valid_terminal_capture() {
    use crate::AgentLoop;
    use crate::model::{
        gemini::{GeminiModel, gemini_4_client, gemini_4_key},
        types::Model,
    };
    use ai_usage::NoOpUsageRecorder;

    for invalid in ["missing", "extra-signature", "unfinished", "cancelled"] {
        let mut parts = vec![
            json!({"text":"","thoughtSignature":"ZW1wdHk="}),
            json!({"functionCall":{"id":"call-a","name":"lookup","args":{"name":"a"}}}),
        ];
        if invalid != "missing" {
            parts[1]["thoughtSignature"] = json!("YQ==");
        }
        if invalid == "extra-signature" {
            parts.push(json!({
                "functionCall":{"id":"call-b","name":"lookup","args":{"name":"b"}},
                "thoughtSignature":"Yg=="
            }));
        }
        let mut response = json!({"candidates":[{
            "content":{"role":"model","parts":parts},"finishReason":"STOP"
        }]});
        if invalid == "unfinished" {
            response["candidates"][0]
                .as_object_mut()
                .unwrap()
                .remove("finishReason");
        }
        let transport = Transport::new(format!("data: {response}\n\n"));
        let replay = crate::Gemini4ReplaySession::new(crate::GEMINI_4_NEON, vec![]).unwrap();
        let client = Arc::new(
            gemini_4_client(
                transport.clone(),
                gemini_4_key("fixture-frontier").unwrap(),
                &[crate::GEMINI_4_NEON],
                Some(replay.clone()),
            )
            .unwrap(),
        );
        let model = GeminiModel::new(Model::try_from(crate::GEMINI_4_NEON).unwrap(), client);
        let effects = Arc::new(AtomicUsize::new(0));
        let owner =
            macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|user@example.com")
                .unwrap();
        let session = AgentLoop::new(Arc::new(NoOpUsageRecorder))
            .with_model(crate::GEMINI_4_NEON)
            .test_with_gemini_4_replay(replay.clone())
            .test_session(
                Arc::new(
                    AsyncToolCollection::<Arc<AtomicUsize>>::new()
                        .add_tool::<Lookup, Arc<AtomicUsize>>(),
                ),
                Arc::new(effects.clone()),
                "system",
                UsageContext::new(AiFeature::AgentSession, owner),
                model.completion(),
            )
            .await;
        let (mut session, cancel) = session.cancellable();
        if invalid == "cancelled" {
            cancel.cancel();
        }
        if let Ok(mut stream) = session
            .send_message(vec![rig_core::message::Message::user("look up")])
            .await
        {
            while stream.next().await.is_some() {}
        }
        assert_eq!(effects.load(Ordering::SeqCst), 0, "{invalid}");
        // The runtime discards completed capture on cancellation, even if
        // the provider finished streaming before the cancel was observed.
        if invalid != "cancelled" {
            assert!(replay.complete().is_none(), "{invalid}");
        }
    }
}

#[test]
fn gemini_4_reduces_provider_errors_to_safe_diagnostics() {
    assert!(gemini_4_finish_reason_is_known("STOP"));
    assert!(!gemini_4_finish_reason_is_known("private provider hint"));
    let rejected = sanitize_gemini_4_error(http_client::Error::InvalidStatusCodeWithMessage(
        reqwest::StatusCode::BAD_REQUEST,
        "private provider signature and request hint".to_owned(),
    ));
    assert!(
        matches!(rejected, http_client::Error::InvalidStatusCode(status)
        if status == reqwest::StatusCode::BAD_REQUEST)
    );
    assert!(!format!("{rejected:?}").contains("private"));

    let content_type = HeaderValue::from_static("private provider id");
    let rejected = sanitize_gemini_4_error(http_client::Error::InvalidContentType(content_type));
    assert!(!format!("{rejected:?}").contains("private"));
}
