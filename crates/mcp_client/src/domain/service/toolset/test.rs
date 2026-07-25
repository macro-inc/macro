use super::*;
use rmcp::model::{CallToolResult, Content};
use serde_json::json;

#[test]
fn structured_tool_results_are_preserved() {
    let result = CallToolResult::structured(json!({
        "object": "page_markdown",
        "markdown": "# Roadmap",
        "truncated": false,
    }));

    assert_eq!(
        tool_result_value(result),
        json!({
            "object": "page_markdown",
            "markdown": "# Roadmap",
            "truncated": false,
        })
    );
}

#[test]
fn unstructured_text_results_remain_strings() {
    let result = CallToolResult::success(vec![Content::text("first"), Content::text(" second")]);

    assert_eq!(tool_result_value(result), json!("first second"));
}

#[test]
fn embedded_text_resources_are_not_discarded() {
    let result = CallToolResult::success(vec![Content::embedded_text(
        "notion://page/abc",
        "# Page content",
    )]);

    assert_eq!(tool_result_value(result), json!("# Page content"));
}
