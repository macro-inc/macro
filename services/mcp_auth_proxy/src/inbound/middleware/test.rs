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
