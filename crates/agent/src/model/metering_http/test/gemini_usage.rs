use super::*;

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
