use serde_json::json;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

fn provider(server: &MockServer) -> TypesafeJev {
    TypesafeJev::with_base_url("test-key", &server.uri()).unwrap()
}

fn questions(texts: &[&str]) -> Vec<YesNoQuestion> {
    texts
        .iter()
        .map(|text| YesNoQuestion::try_from(*text).unwrap())
        .collect()
}

fn noul(value: f32) -> Value {
    json!({ "type": "noul", "noul": value })
}

#[tokio::test]
async fn sends_every_question_as_noul_with_the_input_as_state() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/systemone"))
        .and(header("authorization", "Bearer test-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "model": "jev-1.13.0",
            "answers": { "q0": noul(0.92), "q1": noul(0.03) },
            "usage": { "input_tokens": 296, "output_tokens": 20 }
        })))
        .expect(1)
        .mount(&server)
        .await;
    let input = json!({ "email": { "subject": "Invoice #42" } });

    let evaluation = provider(&server)
        .evaluate(
            &input,
            &questions(&["Is this an invoice?", "Is this spam?"]),
        )
        .await
        .unwrap();

    assert_eq!(
        evaluation
            .probabilities
            .iter()
            .map(|p| p.get())
            .collect::<Vec<_>>(),
        [0.92, 0.03]
    );
    assert_eq!(
        (evaluation.input_tokens, evaluation.output_tokens),
        (296, 20)
    );
    let requests = server.received_requests().await.unwrap();
    let body: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(
        body,
        json!({
            "model": "jev-latest",
            "state": input,
            "questions": {
                "q0": { "type": "noul", "instructions": "Is this an invoice?" },
                "q1": { "type": "noul", "instructions": "Is this spam?" }
            }
        })
    );
}

#[tokio::test]
async fn retries_overload_then_succeeds() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(529))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "answers": { "q0": noul(0.5) },
            "usage": { "input_tokens": 10, "output_tokens": 0 }
        })))
        .mount(&server)
        .await;

    let evaluation = provider(&server)
        .evaluate(&json!("text"), &questions(&["Yes?"]))
        .await
        .unwrap();

    assert_eq!(evaluation.probabilities.len(), 1);
    assert_eq!(server.received_requests().await.unwrap().len(), 2);
}

#[tokio::test]
async fn gives_up_after_bounded_retries() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(429))
        .mount(&server)
        .await;

    let result = provider(&server)
        .evaluate(&json!({}), &questions(&["Yes?"]))
        .await;

    assert_eq!(result, Err(JevError::Unavailable));
    assert_eq!(
        server.received_requests().await.unwrap().len(),
        RETRY_DELAYS.len() + 1
    );
}

#[tokio::test]
async fn rejections_are_not_retried() {
    for status in [401, 422] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(status))
            .mount(&server)
            .await;

        let result = provider(&server)
            .evaluate(&json!({}), &questions(&["Yes?"]))
            .await;

        assert_eq!(result, Err(JevError::Rejected), "status {status}");
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
    }
}

#[tokio::test]
async fn missing_or_out_of_range_answers_are_invalid() {
    for answers in [
        json!({ "q0": noul(0.5) }),
        json!({ "q0": noul(0.5), "q1": noul(1.5) }),
        json!({ "q0": noul(0.5), "q1": { "type": "score", "score": 3 } }),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "answers": answers,
                "usage": { "input_tokens": 10, "output_tokens": 0 }
            })))
            .mount(&server)
            .await;

        let result = provider(&server)
            .evaluate(&json!({}), &questions(&["A?", "B?"]))
            .await;

        assert_eq!(result, Err(JevError::InvalidResponse), "{answers}");
    }
}

#[test]
fn rejects_blank_credentials() {
    assert!(matches!(
        TypesafeJev::new("  "),
        Err(TypesafeConfigError::EmptyApiKey)
    ));
}
