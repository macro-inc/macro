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
