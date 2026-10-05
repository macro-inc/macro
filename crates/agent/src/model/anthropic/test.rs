use super::*;
use crate::model::metering::{ProviderSupport, WireProtocol};
use ai_usage::financial::ProviderModel;
use bytes::Bytes;
use futures::StreamExt;
use rig_core::completion::{CompletionModel, CompletionRequest, Message, ToolDefinition};
use rig_core::http_client::{self, LazyBody, MultipartForm, Request, Response, StreamingResponse};
use serde_json::{Value, json};
use std::sync::Mutex;

/// Records the final serialized HTTP body, after Rig's provider conversion.
#[derive(Clone, Default)]
struct CaptureTransport(Arc<Mutex<Vec<Value>>>);

impl CaptureTransport {
    fn capture<T: Into<Bytes>>(&self, request: Request<T>) {
        let body = serde_json::from_slice(&request.into_body().into()).unwrap();
        self.0.lock().unwrap().push(body);
    }
}

impl HttpClientExt for CaptureTransport {
    fn send<T, U>(
        &self,
        request: Request<T>,
    ) -> impl Future<Output = http_client::Result<Response<LazyBody<U>>>> + Send + 'static
    where
        T: Into<Bytes> + Send,
        U: From<Bytes> + Send + 'static,
    {
        self.capture(request);
        std::future::ready(Err(http_client::Error::StreamEnded))
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
        self.capture(request);
        Err(http_client::Error::StreamEnded)
    }
}

async fn captured_wire_body(streaming: bool) -> Value {
    let transport = CaptureTransport::default();
    let client = anthropic::Client::builder()
        .api_key("test-anthropic-key")
        .http_client(transport.clone())
        .build()
        .unwrap();
    let model = AnthropicModel::new(
        Model::try_from("anthropic/claude-opus-4-8").unwrap(),
        Arc::new(client),
    );
    let request = CompletionRequest {
        model: None,
        preamble: Some("You are Macro.".into()),
        chat_history: rig_core::OneOrMany::many(vec![
            Message::user("Find my notes"),
            Message::assistant("Searching."),
            Message::user("Only from this week"),
        ])
        .unwrap(),
        documents: vec![],
        tools: vec![
            ToolDefinition {
                name: "Search".into(),
                description: "Search documents".into(),
                parameters: json!({"type": "object", "properties": {"query": {"type": "string"}}}),
            },
            ToolDefinition {
                name: "Read".into(),
                description: "Read a document".into(),
                parameters: json!({"type": "object", "properties": {"id": {"type": "string"}}}),
            },
        ],
        temperature: None,
        max_tokens: Some(512),
        tool_choice: None,
        additional_params: None,
        output_schema: None,
        record_telemetry_content: false,
    };
    if streaming {
        let mut response = model.completion().stream(request).await.unwrap();
        // Rig starts its HTTP request lazily on the first stream poll.
        let _ = response.next().await;
    } else {
        assert!(model.completion().completion(request).await.is_err());
    }
    let captured = transport.0.lock().unwrap();
    assert_eq!(captured.len(), 1, "request must reach the HTTP boundary");
    captured[0].clone()
}

async fn assert_cached_wire_body(streaming: bool) {
    let mut body = captured_wire_body(streaming).await;

    // Tools and system are fixed per agent, so each gets its own breakpoint
    // and is read back by every session that shares them. The top-level
    // marker lets Anthropic move the conversation breakpoint each turn.
    let ephemeral = json!({"type": "ephemeral"});
    assert_eq!(body["tools"][0].get("cache_control"), None);
    assert_eq!(body["tools"][1]["cache_control"], ephemeral);
    assert_eq!(body["system"][0]["text"], "You are Macro.");
    assert_eq!(body["system"][0]["cache_control"], ephemeral);
    assert_eq!(body["cache_control"], ephemeral);
    assert!(
        !body["messages"].to_string().contains("cache_control"),
        "the automatic breakpoint owns the conversation tail"
    );

    let support = ProviderSupport {
        model: ProviderModel::new("anthropic", "claude-opus-4-8").unwrap(),
        protocol: WireProtocol::Anthropic,
        input_token_ceiling: 1_000_000,
        output_token_ceiling: 128_000,
        zero_usage_is_missing: false,
    };
    assert!(
        support.constrain(&mut body).is_ok(),
        "metering must admit the cached request"
    );
}

#[tokio::test]
async fn completion_caches_tools_system_and_conversation() {
    assert_cached_wire_body(false).await;
}

#[tokio::test]
async fn stream_caches_tools_system_and_conversation() {
    assert_cached_wire_body(true).await;
}
