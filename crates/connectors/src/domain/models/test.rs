use super::*;

#[test]
fn server_url_spellings_of_one_server_are_equal() {
    let typed = ServerUrl::parse(" https://MCP.Example.com/mcp/ ").unwrap();
    let stored = ServerUrl::parse("https://mcp.example.com/mcp").unwrap();

    assert_eq!(typed, stored);
    assert_eq!(typed.as_str(), "https://mcp.example.com/mcp");
}

#[test]
fn server_url_path_still_tells_servers_apart() {
    assert_ne!(
        ServerUrl::parse("https://mcp.example.com/mcp").unwrap(),
        ServerUrl::parse("https://mcp.example.com/sse").unwrap()
    );
}

#[test]
fn server_url_refuses_what_is_not_http() {
    assert!(ServerUrl::parse("ftp://mcp.example.com").is_err());
    assert!(ServerUrl::parse("mcp.example.com/mcp").is_err());
    assert!(ServerUrl::parse("").is_err());
}

#[test]
fn connector_id_refuses_rather_than_repairs() {
    assert!(ConnectorId::parse("Linear").is_err());
    assert!(ConnectorId::parse("linear/../notion").is_err());
    assert!(ConnectorId::parse("").is_err());
    assert_eq!(
        ConnectorId::parse("google_sheets").unwrap().as_str(),
        "google_sheets"
    );
}

#[test]
fn upstream_debug_hides_the_bearer() {
    let upstream = Upstream::new(
        Url::parse("https://mcp.example.com/mcp").unwrap(),
        Some("secret-token".to_owned()),
        http::HeaderMap::new(),
    );

    assert!(!format!("{upstream:?}").contains("secret-token"));
}

#[test]
fn api_response_reads_retry_after_in_seconds() {
    let mut headers = http::HeaderMap::new();
    headers.insert(
        http::header::RETRY_AFTER,
        http::HeaderValue::from_static("30"),
    );
    let response = ApiResponse {
        status: http::StatusCode::TOO_MANY_REQUESTS,
        headers,
        body: String::new(),
    };

    assert_eq!(
        response.retry_after(),
        Some(std::time::Duration::from_secs(30))
    );
}
