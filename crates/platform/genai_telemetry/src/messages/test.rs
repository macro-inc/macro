use super::*;

#[test]
fn parts_follow_the_semconv_shapes() {
    assert_eq!(text_part("hi"), json!({"type": "text", "content": "hi"}));
    assert_eq!(
        reasoning_part("hmm"),
        json!({"type": "reasoning", "content": "hmm"})
    );
    assert_eq!(
        tool_call_part(Some("call_1"), "search", json!({"q": "x"})),
        json!({"type": "tool_call", "id": "call_1", "name": "search", "arguments": {"q": "x"}})
    );
    assert_eq!(
        tool_call_part(None, "search", json!({})),
        json!({"type": "tool_call", "name": "search", "arguments": {}})
    );
    assert_eq!(
        tool_call_response_part(Some("call_1"), json!({"hits": 3})),
        json!({"type": "tool_call_response", "id": "call_1", "response": {"hits": 3}})
    );
}

#[test]
fn media_parts_never_carry_inline_bytes() {
    assert_eq!(
        media_part(
            "image",
            Some("image/png"),
            MediaSource::Uri("https://x/a.png".into())
        ),
        json!({"type": "uri", "modality": "image", "uri": "https://x/a.png", "mime_type": "image/png"})
    );
    assert_eq!(
        media_part("document", None, MediaSource::FileId("file_1".into())),
        json!({"type": "file", "modality": "document", "file_id": "file_1"})
    );
    assert_eq!(
        media_part("image", None, MediaSource::Inline),
        json!({"type": "blob", "modality": "image", "content": "[inline data omitted]"})
    );
}

#[test]
fn messages_and_definitions_follow_the_semconv_shapes() {
    assert_eq!(
        message(ROLE_USER, vec![text_part("hi")]),
        json!({"role": "user", "parts": [{"type": "text", "content": "hi"}]})
    );
    assert_eq!(
        output_message(ROLE_ASSISTANT, vec![text_part("hello")], "stop"),
        json!({"role": "assistant", "parts": [{"type": "text", "content": "hello"}], "finish_reason": "stop"})
    );
    assert_eq!(
        system_instructions("be brief"),
        vec![json!({"type": "text", "content": "be brief"})]
    );
    assert_eq!(
        tool_definition("search", "Search things", json!({"type": "object"})),
        json!({"type": "function", "name": "search", "description": "Search things", "parameters": {"type": "object"}})
    );
}

#[test]
fn uris_lose_their_credentials_query_and_fragment() {
    assert_eq!(
        redact_uri("https://user:secret@files.example.com/a/b.png?sig=abc#frag"),
        "https://files.example.com/a/b.png"
    );
    assert_eq!(redact_uri("https://x/a.png"), "https://x/a.png");
    assert_eq!(redact_uri("https://host"), "https://host");
    assert_eq!(redact_uri("file:///tmp/a.txt"), "file:///tmp/a.txt");
    assert_eq!(redact_uri("urn:doc:123?x=1"), "urn:doc:123");
    // Forms without `scheme://` still carry secrets or payloads.
    assert_eq!(redact_uri("//user:secret@host/path?k=v"), "//host/path");
    assert_eq!(
        redact_uri("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg"),
        "data:image/png;[inline data omitted]"
    );
    assert_eq!(
        redact_uri("DATA:text/plain,hello%20world"),
        "data:text/plain;[inline data omitted]"
    );
    assert_eq!(redact_uri("HTTPS://user@Host/x"), "HTTPS://Host/x");
    assert_eq!(
        media_part(
            "image",
            None,
            MediaSource::Uri("https://token@x/a.png?expires=1".into())
        )["uri"],
        "https://x/a.png"
    );
}
