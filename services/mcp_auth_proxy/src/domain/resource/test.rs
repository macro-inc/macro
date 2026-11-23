use super::*;

fn resources() -> McpResources {
    McpResources::new(
        "https://mcp-server.macro.com/mcp".to_owned(),
        "https://mcp-chatgpt.macro.com/mcp".to_owned(),
    )
}

#[test]
fn chatgpt_url_is_chatgpt() {
    for resource in [
        "https://mcp-chatgpt.macro.com/mcp",
        "https://mcp-chatgpt.macro.com/mcp/",
    ] {
        assert_eq!(
            resources().resolve(Some(resource)),
            McpResource::Chatgpt,
            "{resource}"
        );
    }
}

#[test]
fn everything_else_is_the_harness() {
    assert_eq!(resources().resolve(None), McpResource::Harness);
    for resource in [
        "https://mcp-server.macro.com/mcp",
        "https://gateway.macro.com/mcp/mcp",
        "https://attacker.example/mcp",
        "https://mcp-chatgpt.macro.com",
        "https://mcp-chatgpt.macro.com/mcp/extra",
        "http://mcp-chatgpt.macro.com/mcp",
        "",
    ] {
        assert_eq!(
            resources().resolve(Some(resource)),
            McpResource::Harness,
            "{resource}"
        );
    }
}
