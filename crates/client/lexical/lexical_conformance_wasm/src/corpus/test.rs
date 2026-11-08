use super::*;

#[test]
fn corpus_html_returns_both_owned_markup_and_text() {
    assert_eq!(
        corpus_route("html", r#"{"markdown":"hello"}"#),
        r#"{"ok":{"html":"<p><span style=\"white-space:pre-wrap\">hello</span></p>","text":"hello"}}"#
    );
}

#[test]
fn corpus_errors_never_return_input_content() {
    let result = corpus_route("xml", r#"{"state":{"root":{"type":"private-input"}}}"#);
    assert_eq!(result, r#"{"error":"conversion"}"#);
}

#[test]
fn corpus_export_uses_the_replacement_free_registry() {
    let input = json!({"state":{"root":{"type":"root","version":1,"format":"","indent":0,"direction":null,"children":[{"type":"paragraph","version":1,"format":"","indent":0,"direction":null,"children":[{"type":"text","version":1,"text":"visible","format":0,"mode":"normal","style":"","detail":0}]}]}}});
    assert_eq!(
        corpus_route("plaintext", &input.to_string()),
        r#"{"ok":"visible"}"#
    );
}

#[test]
fn corpus_composers_use_the_portable_source_wire_apis() {
    assert_eq!(
        corpus_route("agent-context", r#"{"promptMarkdown":"literal"}"#),
        r#"{"ok":"literal"}"#
    );
    let input = json!({"staticFileId":"image","url":"https://example.com/image.png","width":640,"height":480});
    assert_eq!(
        serde_json::from_str::<Value>(&corpus_route("image-markdown", &input.to_string())).unwrap(),
        json!({"ok":r#"<m-image>{"url":"https://example.com/image.png","alt":"Generated image","srcType":"sfs","id":"image","width":640,"height":480,"scale":1,"constrainedWidth":400,"constrainedHeight":400}</m-image>"#})
    );
}
