use super::{absolute_resource_metadata_url, answers_channel_mention};
use axum::{
    body::Body,
    http::{Request, header::HOST},
};
use macro_auth::{macro_api_token::MacroApiToken, middleware::decode_jwt::JwtToken};

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

fn api_token(channel_mention_id: Option<uuid::Uuid>) -> JwtToken {
    JwtToken::MacroApiToken(MacroApiToken {
        exp: 0,
        iss: "macro".into(),
        fusion_user_id: "fusion".into(),
        macro_user_id: "macro|mentioner@example.com".into(),
        macro_organization_id: None,
        agent_id: Some(uuid::Uuid::from_u128(9)),
        agent_via: None,
        agent_correlation_id: None,
        agent_session_id: None,
        routine_id: None,
        channel_mention_id,
    })
}

#[test]
fn a_channel_mention_programs_token_is_refused() {
    assert!(answers_channel_mention(&api_token(Some(
        uuid::Uuid::from_u128(1)
    ))));
    // Every other API token is admitted as before.
    assert!(!answers_channel_mention(&api_token(None)));
}
