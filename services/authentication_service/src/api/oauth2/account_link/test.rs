use axum::http::{StatusCode, header::LOCATION};
use fusionauth::FusionAuthClient;
use serde_json::json;
use url::Url;
use uuid::Uuid;
use wiremock::matchers::{body_json, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::{build_callback_redirect, build_return_redirect, replace_identity_provider_grant};

#[tokio::test]
async fn reconnect_replaces_the_matching_grant_despite_email_capitalization() {
    let server = MockServer::start().await;
    let client = FusionAuthClient::new(
        "api-key".into(),
        "application-id".into(),
        "client-secret".into(),
        server.uri(),
        "http://localhost/callback".into(),
        "google-client-id".into(),
        "google-client-secret".into(),
    );
    Mock::given(method("GET"))
        .and(path("/api/identity-provider/link"))
        .and(query_param("userId", "owner"))
        .and(query_param("identityProviderId", "gmail-idp"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "identityProviderLinks": [{
                "displayName": "another@example.com",
                "identityProviderId": "gmail-idp",
                "identityProviderName": "google_gmail",
                "identityProviderType": "OpenIDConnect",
                "identityProviderUserId": "another-google-identity",
                "insertInstant": 0, "lastLoginInstant": 0,
                "tenantId": "tenant", "userId": "owner", "token": "another-grant"
            }, {
                "displayName": "Inbox@Example.com",
                "identityProviderId": "gmail-idp",
                "identityProviderName": "google_gmail",
                "identityProviderType": "OpenIDConnect",
                "identityProviderUserId": "matching-google-identity",
                "insertInstant": 0, "lastLoginInstant": 0,
                "tenantId": "tenant", "userId": "owner", "token": "stale-grant"
            }]
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/user/owner"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "user": {"id": "owner", "email": "inbox@example.com", "active": true}
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/api/identity-provider/link"))
        .and(query_param("userId", "owner"))
        .and(query_param("identityProviderId", "gmail-idp"))
        .and(query_param(
            "identityProviderUserId",
            "matching-google-identity",
        ))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/identity-provider/link"))
        .and(body_json(json!({"identityProviderLink": {
            "displayName": "inbox@example.com",
            "identityProviderId": "gmail-idp",
            "identityProviderUserId": "matching-google-identity",
            "userId": "owner", "token": "fresh-grant"
        }})))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;

    replace_identity_provider_grant(
        &client,
        "gmail-idp",
        "owner",
        "inbox@example.com",
        "fresh-grant",
    )
    .await
    .expect("reconnect should replace the existing grant for the same email");
}

#[test]
fn callback_redirect_appends_link_identifiers_and_preserves_query_parameters() {
    let link_id = Uuid::parse_str("694d20f7-ff85-46fd-b17d-5f68ff2d3707").unwrap();
    let original_url = urlencoding::encode("https://app.macro.com/inbox?view=shared&sort=newest");

    let response = build_callback_redirect(&original_url, &link_id).unwrap();
    let redirect_url = Url::parse(response.headers()[LOCATION].to_str().unwrap()).unwrap();
    let query_pairs: Vec<_> = redirect_url.query_pairs().collect();

    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(
        query_pairs,
        vec![
            ("view".into(), "shared".into()),
            ("sort".into(), "newest".into()),
            ("link_id".into(), link_id.to_string().into()),
            ("token".into(), link_id.to_string().into()),
        ]
    );
}

#[test]
fn return_redirect_replaces_a_previous_outcome_and_keeps_the_rest() {
    let original_url = urlencoding::encode(
        "macro:///inbox-link-callback?email_link_error=cancelled&provider=gmail&token=stale&view=all",
    );

    let response = build_return_redirect(
        &original_url,
        &[
            ("link_id", "694d20f7-ff85-46fd-b17d-5f68ff2d3707"),
            ("email_link_error", "admin_consent_required"),
            ("provider", "outlook"),
        ],
    )
    .unwrap();
    let redirect_url = Url::parse(response.headers()[LOCATION].to_str().unwrap()).unwrap();
    let query_pairs: Vec<_> = redirect_url.query_pairs().collect();

    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(redirect_url.scheme(), "macro");
    assert_eq!(
        query_pairs,
        vec![
            ("view".into(), "all".into()),
            (
                "link_id".into(),
                "694d20f7-ff85-46fd-b17d-5f68ff2d3707".into()
            ),
            ("email_link_error".into(), "admin_consent_required".into()),
            ("provider".into(), "outlook".into()),
        ]
    );
}

#[test]
fn callback_redirect_replaces_stale_link_identifiers() {
    let link_id = Uuid::parse_str("694d20f7-ff85-46fd-b17d-5f68ff2d3707").unwrap();
    let original_url = urlencoding::encode(
        "https://app.macro.com/inbox?link_id=stale-link&view=shared&token=stale-token",
    );

    let response = build_callback_redirect(&original_url, &link_id).unwrap();
    let redirect_url = Url::parse(response.headers()[LOCATION].to_str().unwrap()).unwrap();
    let query_pairs: Vec<_> = redirect_url.query_pairs().collect();

    assert_eq!(
        query_pairs,
        vec![
            ("view".into(), "shared".into()),
            ("link_id".into(), link_id.to_string().into()),
            ("token".into(), link_id.to_string().into()),
        ]
    );
}
