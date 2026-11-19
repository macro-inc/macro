use serde_json::{Value, json};
use wiremock::matchers::{body_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

const KEY: &str = "mak_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

async fn api(server: &MockServer) -> MacroApi {
    MacroApi::new(&format!("{}/", server.uri()), KEY).expect("a valid key")
}

#[tokio::test]
async fn every_request_carries_the_probe_users_key_and_its_body() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/dss/things"))
        .and(header(API_KEY_HEADER, KEY))
        .and(body_json(json!({"name": "x"})))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": 1})))
        .expect(1)
        .mount(&server)
        .await;

    let answer: Value = api(&server)
        .await
        .json(
            Call::new(Method::POST, "/dss/things", "/dss/things".to_owned()),
            Some(&json!({"name": "x"})),
        )
        .await
        .expect("answered");

    assert_eq!(answer, json!({"id": 1}));
}

#[tokio::test]
async fn a_status_listed_as_done_is_not_an_error() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;

    let done = api(&server)
        .await
        .send_done(
            Call::new(
                Method::DELETE,
                "/dss/things/{id}",
                "/dss/things/1".to_owned(),
            ),
            NO_BODY,
            &[StatusCode::NOT_FOUND],
        )
        .await;

    assert!(done.is_ok(), "{done:?}");
}

#[tokio::test]
async fn any_other_failing_status_names_its_route() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;

    let error = api(&server)
        .await
        .send_done(
            Call::new(
                Method::DELETE,
                "/dss/things/{id}",
                "/dss/things/1".to_owned(),
            ),
            NO_BODY,
            &[StatusCode::NOT_FOUND],
        )
        .await
        .expect_err("a 500");

    assert!(matches!(
        error,
        ApiError::Status {
            route: "/dss/things/{id}",
            status: StatusCode::INTERNAL_SERVER_ERROR
        }
    ));
}

#[tokio::test]
async fn an_answer_of_the_wrong_shape_is_undecodable() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200).set_body_string("not json"))
        .mount(&server)
        .await;

    let error = api(&server)
        .await
        .json::<(), Value>(
            Call::new(Method::GET, "/dss/things", "/dss/things".to_owned()),
            NO_BODY,
        )
        .await
        .expect_err("not json");

    assert!(matches!(
        error,
        ApiError::Undecodable {
            route: "/dss/things",
            ..
        }
    ));
}

#[test]
fn a_key_that_cannot_be_a_header_is_refused() {
    assert!(MacroApi::new("https://gateway", "bad\nkey").is_err());
}
