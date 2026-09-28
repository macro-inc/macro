use super::*;
use agent_client_protocol::schema::v1::{HttpHeader, McpServerStdio};

fn http(name: &str) -> AcpMcpServer {
    AcpMcpServer::Http(
        McpServerHttp::new(name, format!("https://egress.test/mcp/{name}")).headers(vec![
            HttpHeader::new("Authorization", "Bearer session-token"),
        ]),
    )
}

#[test]
fn macros_own_server_is_never_dialed() {
    let dialable = dialable_servers(vec![http("macro"), http("linear"), http("notion")]);
    let names: Vec<&str> = dialable.iter().map(|server| server.name.as_str()).collect();
    assert_eq!(names, ["linear", "notion"]);
}

#[test]
fn only_http_servers_are_dialable() {
    let dialable = dialable_servers(vec![
        AcpMcpServer::Stdio(McpServerStdio::new("local", "some-binary")),
        http("linear"),
    ]);
    let names: Vec<&str> = dialable.iter().map(|server| server.name.as_str()).collect();
    assert_eq!(names, ["linear"]);
}

#[test]
fn dialable_servers_keep_their_headers() {
    let dialable = dialable_servers(vec![http("linear")]);
    let headers: Vec<(&str, &str)> = dialable[0]
        .headers
        .iter()
        .map(|header| (header.name.as_str(), header.value.as_str()))
        .collect();
    assert_eq!(headers, [("Authorization", "Bearer session-token")]);
    assert_eq!(dialable[0].url, "https://egress.test/mcp/linear");
}
