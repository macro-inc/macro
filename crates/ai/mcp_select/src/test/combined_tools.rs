use super::*;
use ai_toolset::ToolCallFuture;
use serde_json::json;

struct Catalog;

impl ToolSet<()> for Catalog {
    fn dispatch_tool_call<'a>(
        &'a self,
        _: (),
        _: RequestContext,
        name: &'a str,
        _: &'a serde_json::Value,
    ) -> ToolCallFuture<'a> {
        Box::pin(async move { Ok(Ok(json!({ "called": name }))) })
    }

    fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
        None
    }

    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        [
            "mcp__macro_internal__ExecuteCode",
            "mcp__macro_internal__DescribeCodeTools",
            "mcp__macro_internal__set_pull_request",
            "mcp__external__ExecuteCode",
        ]
        .into_iter()
        .map(|name| SearchableTool {
            name: name.to_owned(),
            description: format!("Description of {name}"),
            schema: serde_json::from_value(json!({
                "type": "object", "properties": { "value": { "type": "string" } },
            }))
            .unwrap(),
        })
        .collect()
    }
}

#[test]
fn mcp_tools_remain_deferred_by_default() {
    let tools = CombinedToolSet::new(Arc::new(AsyncToolCollection::<()>::new()), Catalog);
    assert!(tools.request_schemas().is_none());
    assert_eq!(tools.searchable_catalog().len(), 4);
}

#[tokio::test]
async fn eager_tools_have_full_schemas_without_being_deferred_or_changing_dispatch() {
    let eager = [
        "mcp__macro_internal__ExecuteCode",
        "mcp__macro_internal__DescribeCodeTools",
    ];
    let tools = CombinedToolSet::new(Arc::new(AsyncToolCollection::<()>::new()), Catalog)
        .with_eager_mcp_tools(&eager);
    let schemas = tools.request_schemas().unwrap();
    assert_eq!(
        schemas.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
        eager
    );
    for schema in schemas {
        assert_eq!(
            schema.description,
            format!("Description of {}", schema.name)
        );
        assert_eq!(
            schema.schema.as_object().unwrap()["properties"]["value"]["type"],
            "string"
        );
    }
    assert_eq!(
        tools
            .searchable_catalog()
            .iter()
            .map(|t| t.name.as_str())
            .collect::<Vec<_>>(),
        [
            "mcp__macro_internal__set_pull_request",
            "mcp__external__ExecuteCode",
        ]
    );
    for name in [eager[0], "mcp__external__ExecuteCode"] {
        let result = tools
            .try_tool_call((), RequestContext::new(user()), name, &json!({}))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(result, json!({ "called": name }));
    }
}

#[test]
fn an_absent_eager_tool_is_not_advertised() {
    let tools = CombinedToolSet::new(Arc::new(AsyncToolCollection::<()>::new()), Catalog)
        .with_eager_mcp_tools(&["mcp__missing__ExecuteCode"]);
    assert!(tools.request_schemas().is_none());
    assert_eq!(tools.searchable_catalog().len(), 4);
}
