use super::web_fetch::*;

#[test]
fn test_deserialize_web_fetch_result() {
    let json = r#"{
            "tool_use_id": "srvtoolu_01234567890abcdef",
            "content": {
                "type": "web_fetch_result",
                "url": "https://example.com/article",
                "content": {
                    "source": {
                        "type": "text",
                        "media_type": "text/plain",
                        "data": "Full text content of the article..."
                    },
                    "title": "Article Title",
                    "citations": {"enabled": true}
                },
                "retrieved_at": "2025-08-25T10:30:00Z"
            }
        }"#;

    let result: WebFetchResponse = serde_json::from_str(json).expect("deserialize");
    assert_eq!(result.tool_use_id, "srvtoolu_01234567890abcdef");
    if let WebFetchContent::WebFetchResult(r) = result.content {
        assert_eq!(r.url, "https://example.com/article");
        assert_eq!(r.content.title, Some("Article Title".to_string()));
    } else {
        panic!("Expected WebFetchResult");
    }
}

#[test]
fn test_deserialize_web_fetch_pdf() {
    let json = r#"{
            "tool_use_id": "srvtoolu_02",
            "content": {
                "type": "web_fetch_result",
                "url": "https://example.com/paper.pdf",
                "content": {
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": "JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmo..."
                    },
                    "citations": {"enabled": true}
                },
                "retrieved_at": "2025-08-25T10:30:02Z"
            }
        }"#;

    let result: WebFetchResponse = serde_json::from_str(json).expect("deserialize");
    if let WebFetchContent::WebFetchResult(r) = result.content {
        if let WebFetchSource::Base64 { media_type, .. } = r.content.source {
            assert_eq!(media_type, "application/pdf");
        } else {
            panic!("Expected Base64 source");
        }
    } else {
        panic!("Expected WebFetchResult");
    }
}

#[test]
fn test_deserialize_web_fetch_error() {
    let json = r#"{
            "tool_use_id": "srvtoolu_a93jad",
            "content": {
                "type": "web_fetch_tool_result_error",
                "error_code": "url_not_accessible"
            }
        }"#;

    let result: WebFetchResponse = serde_json::from_str(json).expect("deserialize");
    if let WebFetchContent::WebFetchToolError(e) = result.content {
        assert_eq!(e.error_code, WebFetchErrorCode::UrlNotAccessible);
    } else {
        panic!("Expected WebFetchToolError");
    }
}

#[test]
fn test_deserialize_tool_call() {
    let json = r#"{"url": "https://example.com/article"}"#;
    let call: WebFetchToolCall = serde_json::from_str(json).expect("deserialize");
    assert_eq!(call.url, "https://example.com/article");
}
