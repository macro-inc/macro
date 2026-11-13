use super::absolute_resource_metadata_url;
use axum::{
    body::Body,
    http::{Request, header::HOST},
};

fn request_with_host(host: &str, proto: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder()
        .uri("/mcp")
        .method("GET")
        .header(HOST, host);
    if let Some(proto) = proto {
        builder = builder.header("x-forwarded-proto", proto);
    }
    builder.body(Body::empty()).unwrap()
}

#[test]
fn resource_metadata_uses_path_style_well_known_on_the_gateway_host() {
    let request = request_with_host("gateway.macro.com", Some("https"));
    assert_eq!(
        absolute_resource_metadata_url(&request),
        "https://gateway.macro.com/mcp/.well-known/oauth-protected-resource"
    );
}

#[test]
fn resource_metadata_uses_path_style_well_known_on_the_legacy_host() {
    let request = request_with_host("mcp-server.macro.com", Some("https"));
    assert_eq!(
        absolute_resource_metadata_url(&request),
        "https://mcp-server.macro.com/mcp/.well-known/oauth-protected-resource"
    );
}

#[test]
fn resource_metadata_defaults_to_http_without_forwarded_proto() {
    let request = request_with_host("dev-gateway.macro.com", None);
    assert_eq!(
        absolute_resource_metadata_url(&request),
        "http://dev-gateway.macro.com/mcp/.well-known/oauth-protected-resource"
    );
}

const PRIVATE: &str = include_str!(
    "../../../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.private.pem"
);
const PUBLIC: &str = include_str!(
    "../../../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.public.pem"
);

fn agent_token(scope: Option<&str>) -> String {
    macro_auth::macro_api_token::encode_macro_api_token(
        macro_auth::macro_api_token::EncodeMacroApiTokenArgs {
            fusionauth_id: "fixture".into(),
            macro_user_id: "macro|owner@example.com".into(),
            organization_id: None,
            issuer: "fixture".into(),
            private_key: PRIVATE.into(),
            expiry_seconds: 60,
            agent_id: Some(uuid::Uuid::from_u128(3)),
            agent_via: None,
            agent_correlation_id: Some(uuid::Uuid::from_u128(1)),
            agent_session_id: None,
            routine_id: None,
            agent_scope: scope.map(str::to_owned),
        },
    )
    .unwrap()
}

/// MCP accepts no credential signed with a session's scope: its tools run at
/// one path and their own credentials would carry no scope.
#[tokio::test]
async fn a_scoped_code_mode_credential_is_refused() {
    use crate::{
        domain::{
            access_token_clients::AccessTokenClients,
            ports::{ClientRegistrationStore, RefreshTokenBindingStore},
        },
        test_support::FakeClientRegistry,
    };
    use axum::http::StatusCode;
    use std::sync::Arc;
    use tower::ServiceExt;

    let registry = Arc::new(FakeClientRegistry::default());
    let auth = super::BearerAuth {
        jwt_args: macro_auth::middleware::decode_jwt::JwtValidationArgs::testing_macro_token(
            "fixture", PUBLIC,
        ),
        clients: AccessTokenClients::new(
            Arc::clone(&registry) as Arc<dyn RefreshTokenBindingStore>,
            registry as Arc<dyn ClientRegistrationStore>,
        ),
    };
    let app = axum::Router::new()
        .route("/mcp", axum::routing::post(|| async { StatusCode::OK }))
        .layer(axum::middleware::from_fn_with_state(
            auth,
            super::validate_bearer,
        ));
    for (scope, expected) in [
        (Some("generation"), StatusCode::FORBIDDEN),
        (Some("no_send"), StatusCode::FORBIDDEN),
        (Some("newer"), StatusCode::FORBIDDEN),
        (None, StatusCode::OK),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/mcp")
                    .header(
                        axum::http::header::AUTHORIZATION,
                        format!("Bearer {}", agent_token(scope)),
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected, "{scope:?}");
    }
}
