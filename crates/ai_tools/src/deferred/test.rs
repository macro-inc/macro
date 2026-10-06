use super::*;
use ai_toolset::{AsyncTool, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult};
use macro_user_id::user_id::MacroUserIdStr;
use schemars::JsonSchema;
use serde::Deserialize;

#[derive(JsonSchema, Deserialize)]
#[schemars(title = "ReadThing", description = "Read a thing.")]
struct ReadThing {
    #[allow(dead_code)]
    id: String,
}

impl ToolAnnotated for ReadThing {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read thing");
}

#[async_trait::async_trait]
impl AsyncTool<()> for ReadThing {
    type Output = String;
    async fn call(&self, _: ServiceContext<()>, _: RequestContext) -> ToolResult<String> {
        Ok("read".to_string())
    }
}

#[derive(JsonSchema, Deserialize)]
#[schemars(
    title = "EditDeck",
    description = "Edit a slide deck. Applies a batch of operations."
)]
struct EditDeck {
    #[allow(dead_code)]
    operations: Vec<String>,
}

impl ToolAnnotated for EditDeck {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Edit deck");
}

#[async_trait::async_trait]
impl AsyncTool<()> for EditDeck {
    type Output = String;
    async fn call(&self, _: ServiceContext<()>, _: RequestContext) -> ToolResult<String> {
        Ok("edited".to_string())
    }
}

/// An MCP toolset whose one tool is already searchable.
struct OneMcpTool;

impl ToolSet<()> for OneMcpTool {
    fn dispatch_tool_call<'a>(
        &'a self,
        _: (),
        _: RequestContext,
        tool_name: &'a str,
        _: &'a serde_json::Value,
    ) -> ToolCallFuture<'a> {
        Box::pin(async move { Err(ai_toolset::ToolSetError::NotFound(tool_name.to_owned())) })
    }

    fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
        None
    }

    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        vec![SearchableTool {
            name: "mcp__linear__create_issue".to_string(),
            description: "Create a Linear issue.".to_string(),
            schema: schemars::Schema::default(),
        }]
    }
}

fn read_and_edit() -> AsyncToolCollection<()> {
    AsyncToolCollection::<()>::new()
        .add_tool::<ReadThing, ()>()
        .add_tool::<EditDeck, ()>()
}

#[test]
fn deferred_tools_are_every_tool_but_the_eager_ones() {
    let deferred = deferred_tools(&read_and_edit(), &["ReadThing"]);

    assert_eq!(deferred.len(), 1);
    assert_eq!(deferred[0].name, "EditDeck");
    assert_eq!(
        deferred[0].description,
        "Edit a slide deck. Applies a batch of operations."
    );
    assert!(
        deferred[0].schema.as_object().unwrap()["properties"]
            .as_object()
            .unwrap()
            .contains_key("operations"),
        "the catalog carries the schema to register on load"
    );
}

#[test]
fn deferred_tools_move_from_the_request_to_the_catalog() {
    let tools = read_and_edit();
    let deferred = deferred_tools(&tools, &["ReadThing"]);
    let tools = DeferredToolSet::new(Arc::new(tools), deferred);

    let sent: Vec<String> = tools
        .request_schemas()
        .unwrap_or_default()
        .into_iter()
        .map(|schema| schema.name)
        .collect();
    let catalog: Vec<String> = tools
        .searchable_catalog()
        .into_iter()
        .map(|tool| tool.name)
        .collect();

    assert_eq!(sent, vec!["ReadThing".to_string()]);
    assert_eq!(catalog, vec!["EditDeck".to_string()]);
}

#[test]
fn deferred_tools_come_before_the_inner_catalog() {
    let deferred = deferred_tools(&read_and_edit(), &[]);
    let tools = DeferredToolSet::new(Arc::new(OneMcpTool), deferred);

    let catalog: Vec<String> = tools
        .searchable_catalog()
        .into_iter()
        .map(|tool| tool.name)
        .collect();

    assert_eq!(
        catalog,
        vec![
            "EditDeck".to_string(),
            "ReadThing".to_string(),
            "mcp__linear__create_issue".to_string()
        ]
    );
}

#[tokio::test]
async fn deferred_tools_stay_callable() {
    let tools = read_and_edit();
    let deferred = deferred_tools(&tools, &[]);
    let tools = DeferredToolSet::new(Arc::new(tools), deferred);
    let user = MacroUserIdStr::try_from_email("t@example.com").unwrap();

    let result = tools
        .try_tool_call(
            (),
            RequestContext::new(user),
            "EditDeck",
            &serde_json::json!({ "operations": [] }),
        )
        .await
        .expect("dispatched")
        .expect("ran");

    assert_eq!(result, serde_json::json!("edited"));
}
