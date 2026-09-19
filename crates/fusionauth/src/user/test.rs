use std::{borrow::Cow, net::IpAddr};

use serde_json::json;
use wiremock::matchers::{body_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

fn client(base_url: String) -> FusionAuthClient {
    FusionAuthClient::new(
        "api-key".into(),
        "application-id".into(),
        "client-secret".into(),
        base_url,
        "http://localhost:28011/oauth/redirect".into(),
        "google-client-id".into(),
        "google-client-secret".into(),
    )
}

fn user() -> create::User<'static> {
    create::User {
        email: Cow::Borrowed("user@example.com"),
        password: Cow::Borrowed("unused-password"),
        username: None,
    }
}

fn success_response() -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_json(json!({
        "user": {
            "id": "created-user-id",
            "email": "user@example.com"
        }
    }))
}

fn expected_body() -> serde_json::Value {
    json!({
        "applicationId": "application-id",
        "skipVerification": true,
        "user": {
            "email": "user@example.com",
            "password": "unused-password",
            "username": null
        }
    })
}

#[tokio::test]
async fn create_user_posts_user() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/user"))
        .and(body_json(expected_body()))
        .respond_with(success_response())
        .expect(1)
        .mount(&server)
        .await;

    let user_id = client(server.uri())
        .create_user(user(), true, IpAddr::from([127, 0, 0, 1]))
        .await
        .unwrap();

    assert_eq!(user_id, "created-user-id");
}

#[tokio::test]
async fn create_user_with_id_posts_user_to_id_endpoint() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/user/caller-user-id"))
        .and(body_json(expected_body()))
        .respond_with(success_response())
        .expect(1)
        .mount(&server)
        .await;

    let user_id = client(server.uri())
        .create_user_with_id("caller-user-id", user(), true, IpAddr::from([127, 0, 0, 1]))
        .await
        .unwrap();

    assert_eq!(user_id, "created-user-id");
}
