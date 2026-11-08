use super::*;

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
