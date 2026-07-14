use crate::types::response::{Content, MessageResponse, ResponseContentKind};

#[test]
fn deserialize_web_search_response() {
    // From the Anthropic docs: https://platform.claude.com/docs/en/docs/build-with-claude/tool-use/web-search-tool
    let json = serde_json::json!({
        "id": "msg_a930390d3a",
        "type": "message",
        "role": "assistant",
        "model": "claude-sonnet-4-5-20250929",
        "content": [
            {
                "type": "text",
                "text": "I'll search for when Claude Shannon was born."
            },
            {
                "type": "server_tool_use",
                "id": "srvtoolu_01WYG3ziw53XMcoyKL4XcZmE",
                "name": "web_search",
                "input": {
                    "query": "claude shannon birth date"
                }
            },
            {
                "type": "web_search_tool_result",
                "tool_use_id": "srvtoolu_01WYG3ziw53XMcoyKL4XcZmE",
                "content": [
                    {
                        "type": "web_search_result",
                        "url": "https://en.wikipedia.org/wiki/Claude_Shannon",
                        "title": "Claude Shannon - Wikipedia",
                        "encrypted_content": "EqgfCioIARgB...",
                        "page_age": "April 30, 2025"
                    }
                ]
            },
            {
                "text": "Based on the search results, ",
                "type": "text"
            },
            {
                "text": "Claude Shannon was born on April 30, 1916",
                "type": "text",
                "citations": [
                    {
                        "type": "web_search_result_location",
                        "url": "https://en.wikipedia.org/wiki/Claude_Shannon",
                        "title": "Claude Shannon - Wikipedia",
                        "encrypted_index": "Eo8BCioIAhgB...",
                        "cited_text": "Claude Elwood Shannon (April 30, 1916 – February 24, 2001)..."
                    }
                ]
            }
        ],
        "stop_reason": "end_turn",
        "stop_sequence": null,
        "usage": {
            "input_tokens": 6039,
            "output_tokens": 931,
            "server_tool_use": {
                "web_search_requests": 1
            }
        }
    });

    let result = serde_json::from_value::<MessageResponse>(json);
    match &result {
        Err(e) => panic!("Failed to deserialize web search response: {e}"),
        Ok(msg) => {
            let content = msg.content.as_ref().expect("content");
            match content {
                Content::Array(blocks) => {
                    assert!(
                        blocks.len() >= 4,
                        "expected at least 4 content blocks, got {}",
                        blocks.len()
                    );
                    assert!(
                        blocks
                            .iter()
                            .any(|b| matches!(b, ResponseContentKind::WebSearchToolResult(_))),
                        "expected a WebSearchToolResult block"
                    );
                }
                _ => panic!("expected Content::Array"),
            }
        }
    }
}

#[test]
fn deserialize_web_search_error_response() {
    // Error case from docs — content is a single object, not an array
    let json = serde_json::json!({
        "type": "web_search_tool_result",
        "tool_use_id": "srvtoolu_a93jad",
        "content": {
            "type": "web_search_tool_result_error",
            "error_code": "max_uses_exceeded"
        }
    });

    let result = serde_json::from_value::<ResponseContentKind>(json);
    match &result {
        Err(e) => panic!("Failed to deserialize web search error: {e}"),
        Ok(block) => assert!(matches!(block, ResponseContentKind::WebSearchToolResult(_))),
    }
}

#[test]
fn deserialize_text_without_citations() {
    // Text block WITHOUT citations field — common in API responses
    let json = serde_json::json!({
        "type": "text",
        "text": "Based on the search results, "
    });

    let result = serde_json::from_value::<ResponseContentKind>(json);
    match &result {
        Err(e) => panic!("Failed to deserialize text without citations: {e}"),
        Ok(block) => assert!(matches!(block, ResponseContentKind::Text(_))),
    }
}

#[test]
fn deserialize_text_with_citations() {
    let json = serde_json::json!({
        "type": "text",
        "text": "Claude Shannon was born on April 30, 1916",
        "citations": [
            {
                "type": "web_search_result_location",
                "url": "https://example.com",
                "title": "Example",
                "encrypted_index": "abc123",
                "cited_text": "some text"
            }
        ]
    });

    let result = serde_json::from_value::<ResponseContentKind>(json);
    match &result {
        Err(e) => panic!("Failed to deserialize text with citations: {e}"),
        Ok(block) => assert!(matches!(block, ResponseContentKind::Text(_))),
    }
}
