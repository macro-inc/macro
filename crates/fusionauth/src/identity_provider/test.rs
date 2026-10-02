use super::*;
use serde_json::json;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_partial_json, method, path, query_param},
};

fn client(server: &MockServer) -> FusionAuthClient {
    FusionAuthClient::new(
        "test-key".into(),
        "test-client".into(),
        "secret".into(),
        server.uri(),
        "http://localhost/callback".into(),
        "google-client".into(),
        "google-secret".into(),
    )
}
fn link() -> serde_json::Value {
    json!({"displayName": "secondary@example.com", "identityProviderId": "gmail-idp", "identityProviderName": "google_gmail", "identityProviderType": "Google", "identityProviderUserId": "google-subject", "userId": "old-owner", "token": "old-token", "insertInstant": 0, "lastLoginInstant": 0, "tenantId": "tenant"})
}

#[tokio::test]
async fn subject_lookup_finds_the_other_owner_without_a_user_filter() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/identity-provider/link"))
        .and(query_param("identityProviderId", "gmail-idp"))
        .and(query_param("identityProviderUserId", "google-subject"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"identityProviderLink": link()})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let resolved = client(&server)
        .get_link_by_subject("gmail-idp", "google-subject")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(resolved.user_id, "old-owner");
    let requests = server.received_requests().await.unwrap();
    assert!(
        !requests[0]
            .url
            .query_pairs()
            .any(|(key, _)| key == "userId")
    );
}

#[tokio::test]
async fn only_not_found_is_treated_as_a_missing_subject() {
    for status in [404, 401, 500] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(status))
            .mount(&server)
            .await;
        let result = client(&server)
            .get_link_by_subject("gmail-idp", "google-subject")
            .await;
        if status == 404 {
            assert!(result.unwrap().is_none());
        } else {
            assert!(result.is_err());
        }
    }
}

#[tokio::test]
async fn mismatched_subject_is_rejected() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"identityProviderLink": link()})),
        )
        .mount(&server)
        .await;
    assert!(
        client(&server)
            .get_link_by_subject("gmail-idp", "different-subject")
            .await
            .is_err()
    );
}

#[tokio::test]
async fn missing_grant_on_resolved_owner_is_an_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/identity-provider/link"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"identityProviderLinks": []})),
        )
        .mount(&server)
        .await;
    assert!(
        client(&server)
            .replace_identity_provider_grant(
                "gmail-idp",
                "old-owner",
                "secondary@example.com",
                Some("google-subject"),
                "fresh-token"
            )
            .await
            .is_err()
    );
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn grant_refresh_and_rollback_keep_the_existing_login_identity() {
    for (replacement_status, subject) in [
        (200, None),
        (500, None),
        (200, Some("google-subject")),
        (500, Some("google-subject")),
    ] {
        let mut existing_link = link();
        let mut unrelated_link = link();
        unrelated_link["identityProviderUserId"] = json!("other-subject");
        if subject.is_some() {
            // The display name can be stale and another link can now use that name.
            existing_link["displayName"] = json!("Previous.Address@example.com");
        }
        let existing_links = if subject.is_some() {
            vec![unrelated_link, existing_link]
        } else {
            vec![existing_link]
        };
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/identity-provider/link"))
            .and(query_param("userId", "old-owner"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"identityProviderLinks": existing_links})),
            )
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/user/old-owner"))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                json!({"user": {"id":"old-owner", "email":"old@example.com", "active":true}}),
            ))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("DELETE"))
            .and(path("/api/identity-provider/link"))
            .and(query_param("userId", "old-owner"))
            .and(query_param("identityProviderUserId", "google-subject"))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST")).and(path("/api/identity-provider/link"))
            .and(body_partial_json(json!({"identityProviderLink": {"userId":"old-owner", "identityProviderUserId":"google-subject", "token":"fresh-token"}})))
            .respond_with(ResponseTemplate::new(replacement_status)).expect(1).mount(&server).await;
        Mock::given(method("POST")).and(path("/api/identity-provider/link"))
            .and(body_partial_json(json!({"identityProviderLink": {"userId":"old-owner", "identityProviderUserId":"google-subject", "token":"old-token"}})))
            .respond_with(ResponseTemplate::new(200)).expect(if replacement_status == 500 { 1 } else { 0 }).mount(&server).await;
        let result = client(&server)
            .replace_identity_provider_grant(
                "gmail-idp",
                "old-owner",
                "secondary@example.com",
                subject,
                "fresh-token",
            )
            .await;
        assert_eq!(result.is_ok(), replacement_status == 200);
    }
}

#[tokio::test]
async fn a_provided_subject_never_falls_back_to_display_name() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/identity-provider/link"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"identityProviderLinks": [link()]})),
        )
        .mount(&server)
        .await;
    assert!(
        client(&server)
            .replace_identity_provider_grant(
                "gmail-idp",
                "old-owner",
                "secondary@example.com",
                Some("different-subject"),
                "fresh-token"
            )
            .await
            .is_err()
    );
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn legacy_display_name_refresh_preserves_the_best_effort_fallback() {
    for links in [vec![], vec![link()]] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/identity-provider/link"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!({"identityProviderLinks": links})),
            )
            .mount(&server)
            .await;
        client(&server)
            .replace_identity_provider_grant(
                "gmail-idp",
                "old-owner",
                "renamed@example.com",
                None,
                "fresh-token",
            )
            .await
            .unwrap();
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
    }
}
