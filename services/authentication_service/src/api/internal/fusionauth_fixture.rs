use fusionauth::FusionAuthClient;
use serde_json::json;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

pub(super) const GMAIL_IDP_NAME: &str = "google_gmail";

/// A FusionAuth with a Gmail identity provider that answers every request about
/// `fusionauth_user_id` the way it does after that user is deleted.
pub(super) async fn without_user(fusionauth_user_id: &str) -> (MockServer, FusionAuthClient) {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/identity-provider/search"))
        .and(query_param("name", GMAIL_IDP_NAME))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "identityProviders": [{ "id": "gmail-idp", "name": GMAIL_IDP_NAME }],
            "total": 1
        })))
        .mount(&server)
        .await;
    Mock::given(path("/api/identity-provider/link"))
        .and(query_param("userId", fusionauth_user_id))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({
            "fieldErrors": { "userId": [{
                "code": "[invalid]userId",
                "message": format!("The [userId] property is not valid. No user exists with an Id [{fusionauth_user_id}].")
            }] },
            "generalErrors": []
        })))
        .mount(&server)
        .await;
    let client = FusionAuthClient::new(
        "api-key".into(),
        "application-id".into(),
        "client-secret".into(),
        server.uri(),
        "http://localhost/callback".into(),
        "google-client-id".into(),
        "google-client-secret".into(),
    );
    (server, client)
}
