use std::collections::HashMap;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};

use super::*;

fn client() -> FusionAuthClient {
    FusionAuthClient::new(
        "api-key".into(),
        "fusionauth-client-id".into(),
        "fusionauth-client-secret".into(),
        "http://fusionauth:9011".into(),
        "http://localhost:28011/oauth/redirect".into(),
        "google-client-id".into(),
        "google-client-secret".into(),
    )
}

fn microsoft_client() -> FusionAuthClient {
    client().with_microsoft_credentials(
        "microsoft-client-id".into(),
        "microsoft-client-secret".into(),
        "microsoft-tenant-id".into(),
    )
}

fn id_token(payload: serde_json::Value) -> String {
    let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none"}"#);
    let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).unwrap());
    format!("{header}.{payload}.signature")
}

#[test]
fn authorize_url_uses_configured_tenant_and_secondary_account_parameters() {
    let url = microsoft_client()
        .construct_microsoft_authorize_url(
            "https://auth.example.com/oauth2/microsoft/callback",
            &"state",
        )
        .unwrap();
    let url = reqwest::Url::parse(&url).unwrap();
    let query: HashMap<_, _> = url.query_pairs().into_owned().collect();

    assert_eq!(
        url.as_str().split('?').next().unwrap(),
        "https://login.microsoftonline.com/microsoft-tenant-id/oauth2/v2.0/authorize"
    );
    assert_eq!(query.get("client_id").unwrap(), "microsoft-client-id");
    assert_eq!(
        query.get("redirect_uri").unwrap(),
        "https://auth.example.com/oauth2/microsoft/callback"
    );
    assert_eq!(query.get("response_type").unwrap(), "code");
    assert_eq!(
        query.get("scope").unwrap(),
        "openid email offline_access profile Mail.ReadWrite Mail.Send"
    );
    assert_eq!(query.get("prompt").unwrap(), "select_account");
}

#[derive(Debug, Deserialize, Eq, PartialEq, Serialize)]
struct TestState {
    identity_provider_id: String,
    link_id: String,
}

#[test]
fn authorize_url_serializes_state_as_json() {
    let state = TestState {
        identity_provider_id: "identity-provider-id".into(),
        link_id: "link-id".into(),
    };
    let url = microsoft_client()
        .construct_microsoft_authorize_url(
            "https://auth.example.com/oauth2/microsoft/callback",
            &state,
        )
        .unwrap();
    let url = reqwest::Url::parse(&url).unwrap();
    let serialized_state = url
        .query_pairs()
        .find_map(|(key, value)| (key == "state").then(|| value.into_owned()))
        .unwrap();

    assert_eq!(
        serde_json::from_str::<TestState>(&serialized_state).unwrap(),
        state
    );
}

#[test]
fn microsoft_oauth_configuration_is_optional_and_secret_is_redacted() {
    let error = client()
        .construct_microsoft_authorize_url(
            "https://auth.example.com/oauth2/microsoft/callback",
            &"state",
        )
        .unwrap_err();
    assert!(matches!(
        error,
        FusionAuthClientError::MicrosoftOAuthNotConfigured
    ));

    let client = microsoft_client();
    let cloned_client = client.clone();
    assert!(!format!("{client:?}").contains("microsoft-client-secret"));
    cloned_client
        .construct_microsoft_authorize_url(
            "https://auth.example.com/oauth2/microsoft/callback",
            &"state",
        )
        .unwrap();
}

#[test]
fn id_token_claims_are_validated_and_email_is_preferred() {
    let token = id_token(serde_json::json!({
        "aud": "microsoft-client-id",
        "tid": "microsoft-tenant-id",
        "sub": "microsoft-user-id",
        "email": "email@example.com",
        "preferred_username": "username@example.com"
    }));

    let user = microsoft_client().parse_microsoft_id_token(&token).unwrap();

    assert_eq!(user.sub, "microsoft-user-id");
    assert_eq!(user.email, "email@example.com");
}

#[test]
fn id_token_uses_preferred_username_when_email_is_absent() {
    let token = id_token(serde_json::json!({
        "aud": "microsoft-client-id",
        "tid": "microsoft-tenant-id",
        "sub": "microsoft-user-id",
        "preferred_username": "username@example.com"
    }));

    let user = microsoft_client().parse_microsoft_id_token(&token).unwrap();

    assert_eq!(user.email, "username@example.com");
}

#[test]
fn id_token_rejects_invalid_audience_tenant_subject_and_email() {
    let valid_claims = serde_json::json!({
        "aud": "microsoft-client-id",
        "tid": "microsoft-tenant-id",
        "sub": "microsoft-user-id",
        "email": "email@example.com"
    });

    for (claim, invalid_value) in [
        ("aud", serde_json::json!("another-client")),
        ("tid", serde_json::json!("another-tenant")),
        ("sub", serde_json::json!("")),
        ("email", serde_json::Value::Null),
    ] {
        let mut claims = valid_claims.clone();
        claims[claim] = invalid_value;
        let token = id_token(claims);

        assert!(
            microsoft_client().parse_microsoft_id_token(&token).is_err(),
            "claim {claim} should have been rejected"
        );
    }
}
