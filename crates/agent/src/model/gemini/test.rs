use super::*;
use crate::model::types::Model;
use rig_core::providers::gemini::completion::gemini_api_types::AdditionalParameters;

#[test]
fn thinking_params_ask_for_thought_summaries() {
    let model = Model::try_from("google/gemini-3.8-flash").expect("routable id");
    let client = gemini::Client::builder()
        .api_key("test-google-key")
        .build()
        .expect("gemini client");
    let gemini = GeminiModel::new(model, Arc::new(client));
    let params = gemini.thinking_params().expect("thinking params");

    // Rig parses this JSON into AdditionalParameters before it builds the
    // GenerateContent body. Snake_case keys do not land in generationConfig,
    // so includeThoughts and the max-token copy both disappear.
    let parsed: AdditionalParameters =
        serde_json::from_value(params).expect("thinking params are gemini additional params");
    let config = parsed
        .generation_config
        .expect("generationConfig is recognized");
    let thinking = config
        .thinking_config
        .expect("thinkingConfig is recognized");
    assert_eq!(thinking.include_thoughts, Some(true));
    let leftover = parsed.additional_params.unwrap_or(serde_json::json!({}));
    assert_eq!(
        leftover,
        serde_json::json!({}),
        "unparsed keys would be sent as unknown Gemini fields"
    );
}

use bytes::Bytes;
use futures::StreamExt;
use rig_core::completion::{Message, ToolDefinition};
use rig_core::http_client::{self, LazyBody, MultipartForm, Request, Response, StreamingResponse};
use serde_json::{Value, json};
use std::sync::Mutex;

/// Records the final serialized HTTP body, after Rig's provider conversion.
#[derive(Clone, Default)]
struct CaptureTransport(Arc<Mutex<Vec<(String, Value)>>>);

impl CaptureTransport {
    fn capture<T: Into<Bytes>>(&self, request: Request<T>) {
        let url = request.uri().to_string();
        let body = serde_json::from_slice(&request.into_body().into()).unwrap();
        self.0.lock().unwrap().push((url, body));
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

// These shapes reproduce QueryDatabase's nullable documented enum and
// SaveDatabaseView's recursive filter, using the same AI schema generator.
#[derive(schemars::JsonSchema)]
#[expect(dead_code, reason = "Only the generated tool schema is exercised")]
#[serde(rename_all = "camelCase")]
/// Query a database.
struct QueryDatabase {
    sql: String,
    display: Option<Display>,
}

#[derive(schemars::JsonSchema)]
#[expect(dead_code, reason = "Only the generated tool schema is exercised")]
#[serde(rename_all = "lowercase")]
enum Display {
    /// Show rows in a table.
    Table,
    /// Show one scalar value.
    Scalar,
}

#[derive(schemars::JsonSchema)]
#[expect(dead_code, reason = "Only the generated tool schema is exercised")]
/// Save a database view.
struct SaveDatabaseView {
    filter: Option<Filter>,
}

#[derive(schemars::JsonSchema)]
#[expect(dead_code, reason = "Only the generated tool schema is exercised")]
enum Filter {
    Equals { column: String, value: String },
    And { filters: Vec<Filter> },
}

fn tool<T: schemars::JsonSchema>() -> ToolDefinition {
    let generated = ai_toolset::schema::generate_validated_input_schema::<T>().unwrap();
    ToolDefinition {
        name: generated.name,
        description: generated.description,
        parameters: generated.schema.to_value(),
    }
}

fn request() -> CompletionRequest {
    CompletionRequest {
        model: Some("gemini-3.8-flash".into()),
        preamble: Some("Answer database questions.".into()),
        chat_history: rig_core::OneOrMany::one(Message::user("Find books")),
        documents: vec![],
        tools: vec![tool::<QueryDatabase>(), tool::<SaveDatabaseView>()],
        temperature: Some(0.2),
        max_tokens: Some(512),
        tool_choice: Some(rig_core::completion::message::ToolChoice::Required),
        additional_params: Some(json!({
            "generationConfig": {"thinkingConfig": {"includeThoughts": true}},
            "tools": [{"googleSearch": {}}],
            "safetySettings": [{"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_ONLY_HIGH"}]
        })),
        output_schema: Some(schemars::schema_for!(String)),
        record_telemetry_content: false,
    }
}

async fn assert_native_wire_body(streaming: bool) {
    let transport = CaptureTransport::default();
    let client = gemini::Client::builder()
        .api_key("test-google-key")
        .http_client(transport.clone())
        .build()
        .unwrap();
    let model = GeminiModel::new(
        Model::try_from("google/gemini-3.8-flash").unwrap(),
        Arc::new(client),
    );
    let request = request();
    let tools = request.tools.clone();
    // Guard the fixture: nested nullable enums and recursive references must
    // survive generation, otherwise these tests would miss the regressions.
    assert!(tools[0].parameters["properties"]["display"]["anyOf"][0]["anyOf"].is_array());
    assert!(tools[1].parameters.to_string().contains("$ref"));
    if streaming {
        let mut response = model.completion().stream(request).await.unwrap();
        // Rig starts its HTTP request lazily on the first stream poll.
        let _ = response.next().await;
    } else {
        assert!(model.completion().completion(request).await.is_err());
    }
    let captured = transport.0.lock().unwrap();
    assert_eq!(captured.len(), 1, "request must reach the HTTP boundary");
    let (url, body) = &captured[0];
    assert!(url.contains(if streaming {
        "streamGenerateContent"
    } else {
        ":generateContent"
    }));
    let declarations = body["tools"][0]["functionDeclarations"].as_array().unwrap();
    assert_eq!(declarations.len(), tools.len());
    for (declaration, tool) in declarations.iter().zip(tools) {
        assert_eq!(declaration["name"], tool.name);
        assert_eq!(declaration["description"], tool.description);
        assert_eq!(declaration["parametersJsonSchema"], tool.parameters);
        assert!(declaration.get("parameters").is_none());
    }
    assert_eq!(body["tools"][1], json!({"googleSearch": {}}));
    assert_eq!(
        body["generationConfig"]["thinkingConfig"]["includeThoughts"],
        true
    );
    assert_eq!(body["generationConfig"]["maxOutputTokens"], 512);
    assert_eq!(body["generationConfig"]["temperature"], 0.2);
    assert_eq!(
        body["generationConfig"]["responseMimeType"],
        "application/json"
    );
    assert_eq!(
        body["generationConfig"]["responseJsonSchema"],
        schemars::schema_for!(String).to_value()
    );
    assert_eq!(body["toolConfig"]["functionCallingConfig"]["mode"], "ANY");
    assert_eq!(body["safetySettings"][0]["threshold"], "BLOCK_ONLY_HIGH");
    assert_eq!(
        body["systemInstruction"]["parts"][0]["text"],
        "Answer database questions."
    );
    assert_eq!(body["contents"][0]["parts"][0]["text"], "Find books");
}

#[tokio::test]
async fn completion_preserves_native_schemas_and_request_settings() {
    assert_native_wire_body(false).await;
}

#[tokio::test]
async fn stream_preserves_native_schemas_and_request_settings() {
    assert_native_wire_body(true).await;
}

#[test]
fn requests_without_function_tools_are_unchanged() {
    let mut request = request();
    request.tools.clear();
    let original = serde_json::to_value(&request).unwrap();
    assert_eq!(
        serde_json::to_value(native_tool_schemas(request).unwrap()).unwrap(),
        original
    );
}

#[test]
fn native_tools_work_without_additional_parameters_and_omit_null_schema() {
    let mut request = request();
    request.additional_params = None;
    request.tools = vec![ToolDefinition {
        name: "NoArguments".into(),
        description: "No input required".into(),
        parameters: Value::Null,
    }];
    let request = native_tool_schemas(request).unwrap();
    assert!(request.tools.is_empty());
    assert_eq!(
        request.additional_params.unwrap(),
        json!({"tools": [{"functionDeclarations": [{
            "name": "NoArguments", "description": "No input required"
        }]}]})
    );
}

#[test]
fn invalid_additional_parameters_fail_before_transport() {
    for params in [json!([]), json!({"tools": {}})] {
        let mut request = request();
        request.additional_params = Some(params);
        assert!(matches!(
            native_tool_schemas(request),
            Err(CompletionError::RequestError(_))
        ));
    }
}
