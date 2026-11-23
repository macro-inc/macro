use super::*;
use rmcp::model::ContentBlock;
use serde_json::json;

#[test]
fn structured_tool_results_are_preserved() {
    let result = CallToolResult::structured(json!({
        "object": "page_markdown",
        "markdown": "# Roadmap",
        "truncated": false,
    }));

    assert_eq!(
        result.into_value(),
        json!({
            "object": "page_markdown",
            "markdown": "# Roadmap",
            "truncated": false,
        })
    );
}

#[test]
fn unstructured_text_results_preserve_block_boundaries() {
    let result = CallToolResult::success(vec![
        ContentBlock::text("first"),
        ContentBlock::text("second"),
    ]);

    assert_eq!(result.into_value(), json!("first\nsecond"));
}

#[test]
fn embedded_text_resources_are_not_discarded() {
    let result = CallToolResult::success(vec![
        ContentBlock::text("# Page"),
        ContentBlock::embedded_text("notion://page/abc", "Page content"),
    ]);

    assert_eq!(result.into_value(), json!("# Page\nPage content"));
}

#[test]
fn structured_errors_have_a_description_without_text_content() {
    let mut result = CallToolResult::structured(json!({"message": "not found"}));
    result.is_error = Some(true);

    assert_eq!(result.error_description(), r#"{"message":"not found"}"#);
}
