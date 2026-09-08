use super::*;

/// The harness advertises `Authorization: Bearer <session token>`; rmcp wants
/// the bare token and adds the scheme itself.
#[test]
fn a_bearer_authorization_header_becomes_the_bare_token() {
    assert_eq!(
        place_header("Authorization", "Bearer session-token"),
        Some(HeaderPlacement::BearerToken("session-token".to_owned()))
    );
    assert_eq!(
        place_header("authorization", "bearer  spaced-token "),
        Some(HeaderPlacement::BearerToken("spaced-token".to_owned()))
    );
}

#[test]
fn other_headers_are_sent_verbatim() {
    assert_eq!(
        place_header("X-Custom", "value"),
        Some(HeaderPlacement::Custom(
            HeaderName::from_static("x-custom"),
            HeaderValue::from_static("value"),
        ))
    );
    // A non-bearer authorization scheme is not something to strip.
    assert_eq!(
        place_header("Authorization", "Basic abc"),
        Some(HeaderPlacement::Custom(
            AUTHORIZATION,
            HeaderValue::from_static("Basic abc"),
        ))
    );
}

#[test]
fn invalid_headers_are_dropped() {
    assert_eq!(place_header("not a header", "x"), None);
    assert_eq!(place_header("X-Custom", "line\nbreak"), None);
}

#[derive(Default)]
struct FormRecorder(std::sync::Mutex<Vec<serde_json::Value>>);
#[async_trait::async_trait]
impl crate::domain::user_input::UserInputRequester for FormRecorder {
    async fn ask(
        &self,
        _: crate::domain::user_input::UserInputRequest,
    ) -> Result<
        crate::domain::user_input::UserInputOutcome,
        crate::domain::user_input::UserInputError,
    > {
        unreachable!()
    }
    async fn form(
        &self,
        message: String,
        schema: serde_json::Value,
        meta: Option<serde_json::Map<String, serde_json::Value>>,
    ) -> Result<serde_json::Value, crate::domain::user_input::UserInputError> {
        self.0
            .lock()
            .unwrap()
            .push(serde_json::json!({"message":message,"schema":schema,"meta":meta}));
        Ok(serde_json::json!({"action":"accept","content":{"answer":"edited"}}))
    }
}
struct ProbeServer;
impl rmcp::ServerHandler for ProbeServer {
    async fn call_tool(
        &self,
        _: rmcp::model::CallToolRequestParams,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<rmcp::model::CallToolResult, rmcp::ErrorData> {
        let response = context.peer.create_elicitation(serde_json::from_value(serde_json::json!({
            "mode":"form", "message":"Question", "requestedSchema":{"type":"object","properties":{"answer":{"type":"string"}}},
            "_meta":{"macro":{"userTool":{"name":"SendEmail","draft":{}}},"other":"kept"}
        })).unwrap()).await.unwrap();
        Ok(rmcp::model::CallToolResult::structured(
            serde_json::to_value(response).unwrap(),
        ))
    }
}

#[tokio::test]
async fn mcp_form_bridge_preserves_answers_and_only_trusts_macro_composer_metadata() {
    use std::sync::Arc;
    for server in ["macro", "thirdparty"] {
        let input = Arc::new(FormRecorder::default());
        let client = ElicitationClient {
            server: server.into(),
            input: Some(input.clone()),
        };
        let (server_io, client_io) = tokio::io::duplex(8192);
        let server_task = tokio::spawn(async move { ProbeServer.serve(server_io).await.unwrap() });
        let client = client.serve(client_io).await.unwrap();
        let service = server_task.await.unwrap();
        let result = client
            .call_tool(rmcp::model::CallToolRequestParams::new("probe"))
            .await
            .unwrap();
        assert_eq!(
            result.structured_content.unwrap(),
            serde_json::json!({"action":"accept","content":{"answer":"edited"}})
        );
        let forms = input.0.lock().unwrap();
        assert_eq!(forms[0]["message"], format!("{server}: Question"));
        assert_eq!(forms[0]["meta"]["other"], "kept");
        assert_eq!(forms[0]["meta"].get("macro").is_some(), server == "macro");
        drop(forms);
        client.cancel().await.unwrap();
        service.cancel().await.unwrap();
    }
}
