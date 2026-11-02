use axum::response::IntoResponse;

use http_body_util::BodyExt;
use utoipa::OpenApi;

use super::*;
use crate::api::swagger::ApiDoc;
use crate::domain::microsoft::{
    MicrosoftAuthService, MockMicrosoftGrantRepository, MockMicrosoftIdentityProvider,
    OUTLOOK_FLAG, token::MockMicrosoftTokenCipher,
};
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};
use std::sync::Arc;

#[tokio::test]
async fn domain_errors_map_to_safe_statuses() {
    let response = map_domain_error(MicrosoftAuthError::NotConfigured).into_response();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["message"], "identity provider not found");
    assert_eq!(
        map_domain_error(MicrosoftAuthError::TooManyAttempts)
            .into_response()
            .status(),
        StatusCode::TOO_MANY_REQUESTS
    );
}

#[test]
fn original_url_is_optional() {
    let params: InitOutlookLinkQueryParams = serde_json::from_value(serde_json::json!({})).unwrap();

    assert!(params.original_url.is_none());
}

#[test]
fn outlook_link_openapi_includes_path_schema_and_error_responses() {
    let openapi = serde_json::to_value(ApiDoc::openapi()).unwrap();
    let operation = &openapi["paths"]["/link/outlook"]["post"];

    assert_eq!(operation["operationId"], "init_outlook_link");
    assert_eq!(
        operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].as_str(),
        Some("#/components/schemas/InitOutlookLinkResponse")
    );

    for status in ["401", "404", "429", "500"] {
        assert!(
            operation["responses"].get(status).is_some(),
            "missing documented {status} response"
        );
    }

    let original_url = operation["parameters"]
        .as_array()
        .unwrap()
        .iter()
        .find(|parameter| parameter["name"] == "original_url")
        .unwrap();
    assert_ne!(original_url["required"].as_bool(), Some(true));
    assert!(
        openapi["components"]["schemas"]
            .get("InitOutlookLinkResponse")
            .is_some()
    );
}

#[tokio::test]
async fn providers_offer_outlook_only_when_the_switch_and_the_users_flag_allow() {
    let user = MacroUserIdStr::try_from("macro|person@example.com".to_string()).unwrap();
    let cases = [
        // (switch, flags configured, the user's flag load, outlook offered)
        (
            true,
            true,
            Ok(FlagSnapshot::new([(
                OUTLOOK_FLAG.into(),
                FlagValue::Boolean(true),
            )])),
            true,
        ),
        (
            true,
            true,
            Ok(FlagSnapshot::new([(
                OUTLOOK_FLAG.into(),
                FlagValue::Boolean(false),
            )])),
            false,
        ),
        (true, true, Err("PostHog unreachable".to_owned()), false),
        (true, false, Err("never loaded".to_owned()), true),
        (
            false,
            true,
            Ok(FlagSnapshot::new([(
                OUTLOOK_FLAG.into(),
                FlagValue::Boolean(true),
            )])),
            false,
        ),
    ];
    for (switch, configured, load, offered) in cases {
        let mut flags = FakeFeatureFlags::default();
        flags.set(user.clone(), load.clone());
        let service = MicrosoftAuthService::new(
            MockMicrosoftGrantRepository::new(),
            MockMicrosoftIdentityProvider::new(),
            Arc::new(MockMicrosoftTokenCipher::new()),
        )
        .with_connections_enabled(switch)
        .with_feature_flags(configured.then_some(flags));
        let providers = connection_providers(Some(&service), &user, None, false).await;
        assert!(providers.gmail);
        assert_eq!(
            providers.outlook, offered,
            "switch {switch}, configured {configured}, load {load:?}"
        );
    }
    assert!(!connection_providers(None, &user, None, false).await.outlook);
}

#[tokio::test]
async fn flagged_off_user_gets_404_for_a_new_link_but_can_reconnect() {
    let user = MacroUserIdStr::try_from("macro|person@example.com".to_string()).unwrap();
    let reconnect = uuid::Uuid::now_v7();
    let mut repo = MockMicrosoftGrantRepository::new();
    repo.expect_connection_facts().times(2).returning(|_, id| {
        Ok(email::domain::inbox_entitlement::InboxConnectionFacts {
            professional: true,
            accessible_inboxes: 1,
            reconnecting: id.is_some(),
        })
    });
    repo.expect_begin_link().once().returning(|_| Ok(()));
    let mut provider = MockMicrosoftIdentityProvider::new();
    provider
        .expect_identity_provider_id()
        .once()
        .returning(|| Ok("microsoft".into()));
    provider
        .expect_authorize()
        .once()
        .returning(|_| Ok("https://login.example.com/authorize".into()));
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        user.clone(),
        Ok(FlagSnapshot::new([(
            OUTLOOK_FLAG.into(),
            FlagValue::Boolean(false),
        )])),
    );
    let service =
        MicrosoftAuthService::new(repo, provider, Arc::new(MockMicrosoftTokenCipher::new()))
            .with_feature_flags(Some(flags));

    let refused = start_outlook_link(
        &service,
        uuid::Uuid::now_v7(),
        &user,
        "https://auth.example.com/oauth2/microsoft/callback".into(),
        None,
        false,
        None,
    )
    .await
    .unwrap_err()
    .into_response();
    assert_eq!(refused.status(), StatusCode::NOT_FOUND);

    let reconnected = start_outlook_link(
        &service,
        uuid::Uuid::now_v7(),
        &user,
        "https://auth.example.com/oauth2/microsoft/callback".into(),
        None,
        false,
        Some(reconnect),
    )
    .await
    .unwrap();
    assert_eq!(
        reconnected.authorization_url,
        "https://login.example.com/authorize"
    );
}
