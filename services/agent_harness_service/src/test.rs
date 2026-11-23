use super::{js_tools_analyzer, macro_mcp_endpoint};
use macro_service_urls::McpServiceUrl;

#[test]
fn macro_mcp_endpoint_preserves_the_gateway_prefix() {
    for (base, expected) in [
        (McpServiceUrl::local(), "http://localhost:8101/mcp"),
        (
            McpServiceUrl::dev(),
            "https://dev-gateway.macro.com/mcp/mcp",
        ),
        (McpServiceUrl::prod(), "https://gateway.macro.com/mcp/mcp"),
    ] {
        assert_eq!(macro_mcp_endpoint(&base).unwrap().as_str(), expected);
    }
}

#[test]
fn macro_mcp_endpoint_appends_to_overridden_bases_with_or_without_a_trailing_slash() {
    for base in ["http://mcp-service:8080", "http://mcp-service:8080/"] {
        assert_eq!(
            macro_mcp_endpoint(&McpServiceUrl::from_static(base))
                .unwrap()
                .as_str(),
            "http://mcp-service:8080/mcp"
        );
    }
    assert_eq!(
        macro_mcp_endpoint(&McpServiceUrl::from_static(
            "https://example.com/proxy/mcp/"
        ))
        .unwrap()
        .as_str(),
        "https://example.com/proxy/mcp/mcp"
    );
}

#[test]
fn macro_mcp_endpoint_rejects_an_invalid_base_url() {
    assert!(macro_mcp_endpoint(&McpServiceUrl::from_static("not a url")).is_err());
}

#[tokio::test]
async fn a_js_tools_analyzer_that_cannot_start_leaves_js_tools_off() {
    let scratch = tempfile::tempdir().unwrap();
    let analyzer = js_tools_analyzer(
        scratch.path().join("no-such-deno"),
        scratch.path().join("analyses-js"),
    )
    .await;
    assert!(analyzer.is_none());
}
