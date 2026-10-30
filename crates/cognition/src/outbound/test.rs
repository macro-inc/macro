use super::*;
use std::collections::BTreeMap;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_json, header, method, path},
};

const DEFAULT_MODEL: &str = "google/gemini-3.8-flash";
const TEST_KEY: &str = "local-test-key";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|cognition-test@macro.local".to_owned()).unwrap()
}

fn client(base: &str) -> CognitionClient {
    CognitionClient::new(base, TEST_KEY, DEFAULT_MODEL).unwrap()
}

fn generation() -> GenerateObjectRequest {
    GenerateObjectRequest {
        prompt: "Extract the total from: Total USD 42.".into(),
        system: None,
        model: None,
        schema: json!({
            "type": "object",
            "properties": { "total": { "type": "number" } },
            "required": ["total"], "additionalProperties": false,
        }),
    }
}

fn decisions() -> DecisionRequest {
    DecisionRequest {
        input: json!({ "body": "Can you approve this today?" }),
        questions: BTreeMap::from([("needsReply".into(), "Does it request a response?".into())]),
    }
}

fn completion(result: Value) -> Value {
    json!({ "outcome": { "status": "completed", "result": result }, "toolActivity": [] })
}

#[test]
fn configuration_rejects_untrusted_shapes() {
    for base in [
        "ftp://example.com",
        "http://u:p@example.com",
        "http://example.com?key=bad",
        "http://example.com/#fragment",
        "not a URL",
    ] {
        assert!(CognitionClient::new(base, TEST_KEY, DEFAULT_MODEL).is_err());
    }
    for key in ["", " ", " key", "key\n"] {
        assert!(CognitionClient::new("http://localhost", key, DEFAULT_MODEL).is_err());
    }
    assert!(CognitionClient::new("http://localhost", TEST_KEY, "fast").is_err());
}

#[tokio::test]
async fn generation_forwards_authenticated_owner_and_forces_no_tools() {
    let server = MockServer::start().await;
    let request = generation();
    Mock::given(method("POST"))
        .and(path("/cognition/structured-completion"))
        .and(header(INTERNAL_API_KEY_HEADER, TEST_KEY))
        .and(header(INTERNAL_MACRO_USER_ID_HEADER, user().as_ref()))
        .and(body_json(json!({
            "prompt": request.prompt,
            "model": DEFAULT_MODEL,
            "additional_instructions": null,
            "output_schema": { "name": "result", "schema": request.schema },
            "toolset": { "type": "none" },
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(completion(json!({"total":42}))))
        .expect(1)
        .mount(&server)
        .await;
    let response = client(&format!("{}/cognition", server.uri()))
        .generate_object(&user(), request)
        .await
        .unwrap();
    assert_eq!(response.object, json!({ "total": 42 }));
}

#[tokio::test]
async fn explicit_model_and_system_are_forwarded_without_aliases() {
    let server = MockServer::start().await;
    Mock::given(path("/structured-completion"))
        .respond_with(ResponseTemplate::new(200).set_body_json(completion(json!({ "total": 42 }))))
        .expect(1)
        .mount(&server)
        .await;
    let mut input = generation();
    input.model = Some(ModelId::try_from("anthropic/claude-sonnet-5-5".to_owned()).unwrap());
    input.system = Some("Preserve exact numeric values.".into());
    client(&server.uri())
        .generate_object(&user(), input)
        .await
        .unwrap();
    let requests = server.received_requests().await.unwrap();
    let body: Value = requests[0].body_json().unwrap();
    assert_eq!(body["model"], "anthropic/claude-sonnet-5-5");
    assert_eq!(
        body["additional_instructions"],
        "Preserve exact numeric values."
    );
    assert_eq!(body["toolset"], json!({ "type": "none" }));
}

#[tokio::test]
async fn decisions_reuse_shared_contract_and_authenticated_owner() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/decisions"))
        .and(header(INTERNAL_API_KEY_HEADER, TEST_KEY))
        .and(header(INTERNAL_MACRO_USER_ID_HEADER, user().as_ref()))
        .and(body_json(serde_json::to_value(decisions()).unwrap()))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "probabilities": { "needsReply": 0.9 },
        })))
        .expect(1)
        .mount(&server)
        .await;
    let response = client(&server.uri())
        .decide(&user(), decisions())
        .await
        .unwrap();
    assert_eq!(response.probabilities["needsReply"], 0.9);
}

#[tokio::test]
async fn invalid_requests_fail_before_network_dispatch() {
    let server = MockServer::start().await;
    let client = client(&server.uri());
    let mut input = generation();
    input.prompt = "x".repeat(crate::domain::MAX_PROMPT_BYTES + 1);
    assert!(client.generate_object(&user(), input).await.is_err());
    let mut input = decisions();
    input.questions.clear();
    assert!(client.decide(&user(), input).await.is_err());
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn malformed_interrupted_and_tool_using_completions_are_rejected() {
    for response in [
        json!({}),
        completion(json!([1, 2, 3])),
        json!({ "outcome": { "status": "interrupted", "reason": "private content" }, "toolActivity": [] }),
        json!({ "outcome": { "status": "completed", "result": {} }, "toolActivity": [{"name":"EditDocument"}] }),
    ] {
        let server = MockServer::start().await;
        Mock::given(path("/structured-completion"))
            .respond_with(ResponseTemplate::new(200).set_body_json(response))
            .mount(&server)
            .await;
        let error = client(&server.uri())
            .generate_object(&user(), generation())
            .await
            .unwrap_err();
        assert!(error.to_string().contains("invalid or interrupted"));
        assert!(!format!("{error:?}").contains("private content"));
    }
}

#[tokio::test]
async fn decisions_reject_missing_extra_or_out_of_range_probabilities() {
    for probabilities in [
        json!({}),
        json!({"other":0.5}),
        json!({"needsReply":1.1}),
        json!({"needsReply":-0.1}),
        json!({"needsReply":0.8,"extra":0.3}),
    ] {
        let server = MockServer::start().await;
        Mock::given(path("/decisions"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!({"probabilities":probabilities})),
            )
            .mount(&server)
            .await;
        assert!(
            client(&server.uri())
                .decide(&user(), decisions())
                .await
                .is_err()
        );
    }
}

#[tokio::test]
async fn errors_are_actionable_without_exposing_bodies_or_retrying() {
    for (status, message) in [
        (400, "Check the prompt"),
        (401, "authenticate"),
        (402, "allowance"),
        (403, "cannot access"),
        (413, "request size"),
        (429, "busy"),
        (503, "unavailable"),
        (504, "timed out"),
        (502, "invalid"),
    ] {
        let server = MockServer::start().await;
        Mock::given(path("/structured-completion"))
            .respond_with(ResponseTemplate::new(status).set_body_json(json!({
                "error": "secret provider credential and private prompt", "code": "private-code",
            })))
            .expect(1)
            .mount(&server)
            .await;
        let error = client(&server.uri())
            .generate_object(&user(), generation())
            .await
            .unwrap_err();
        assert!(error.to_string().contains(message), "{status}: {error}");
        assert!(!format!("{error:?}").contains("secret provider"));
    }
}

#[tokio::test]
async fn redirects_are_not_followed_and_responses_are_bounded() {
    let destination = MockServer::start().await;
    let server = MockServer::start().await;
    Mock::given(path("/structured-completion"))
        .respond_with(ResponseTemplate::new(307).insert_header("location", destination.uri()))
        .mount(&server)
        .await;
    assert!(
        client(&server.uri())
            .generate_object(&user(), generation())
            .await
            .is_err()
    );
    assert!(destination.received_requests().await.unwrap().is_empty());
    server.reset().await;
    Mock::given(path("/structured-completion"))
        .respond_with(
            ResponseTemplate::new(200).set_body_string("x".repeat(MAX_RESPONSE_BYTES + 1)),
        )
        .mount(&server)
        .await;
    let error = client(&server.uri())
        .generate_object(&user(), generation())
        .await
        .unwrap_err();
    assert!(error.to_string().contains("response is too large"));
}

#[tokio::test]
async fn streamed_response_limit_does_not_depend_on_content_length() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut buffer = [0; 4096];
        assert!(stream.read(&mut buffer).await.unwrap() > 0);
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n")
            .await
            .unwrap();
        let chunk = format!(
            "{:x}\r\n{}\r\n0\r\n\r\n",
            MAX_RESPONSE_BYTES + 1,
            "x".repeat(MAX_RESPONSE_BYTES + 1)
        );
        // The bounded client may close the connection before the last byte.
        let _ = stream.write_all(chunk.as_bytes()).await;
    });
    let error = client(&format!("http://{address}"))
        .generate_object(&user(), generation())
        .await
        .unwrap_err();
    assert!(error.to_string().contains("response is too large"));
    server.await.unwrap();
}

#[tokio::test]
async fn deadline_bounds_a_stalled_response_body() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut buffer = [0; 4096];
        assert!(stream.read(&mut buffer).await.unwrap() > 0);
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nContent-Type: application/json\r\n\r\n{").await.unwrap();
        std::future::pending::<()>().await;
    });
    let client = CognitionClient::with_timeout(
        &format!("http://{address}"),
        TEST_KEY,
        DEFAULT_MODEL,
        Duration::from_millis(100),
    )
    .unwrap();
    let error = tokio::time::timeout(
        Duration::from_secs(2),
        client.generate_object(&user(), generation()),
    )
    .await
    .unwrap()
    .unwrap_err();
    assert!(error.to_string().contains("timed out"));
    server.abort();
}
