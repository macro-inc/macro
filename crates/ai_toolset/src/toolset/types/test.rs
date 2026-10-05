use super::*;

/// The deserialization error is what a model reads back as the tool result, so
/// it has to say which argument was wrong rather than only that something was.
#[test]
fn deserialization_error_carries_the_serde_detail() {
    let error = serde_json::from_value::<u8>(serde_json::json!("email")).unwrap_err();
    let detail = error.to_string();

    let message = ToolSetError::Deserialization(error).to_string();

    assert!(
        message.starts_with("error deserializing tool call"),
        "message should keep its prefix, got {message}"
    );
    assert!(
        message.ends_with(&detail),
        "message should end with the serde detail {detail:?}, got {message}"
    );
}

mod deferral {
    use crate::{
        AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated,
        ToolAnnotations, ToolResult, ToolSet,
    };
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

    #[derive(JsonSchema, Deserialize)]
    #[schemars(title = "AskThing", description = "Ask a thing.")]
    struct AskThing {}

    impl ToolAnnotated for AskThing {
        const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Ask thing");
    }

    #[async_trait::async_trait]
    impl AsyncTool<()> for AskThing {
        type Output = String;
        async fn call(&self, _: ServiceContext<()>, _: RequestContext) -> ToolResult<String> {
            Ok("asked".to_string())
        }
    }

    fn sent(tools: &AsyncToolCollection<()>) -> Vec<String> {
        tools
            .request_schemas()
            .unwrap_or_default()
            .into_iter()
            .map(|schema| schema.name)
            .collect()
    }

    #[test]
    fn deferred_tools_move_from_the_request_to_the_catalog() {
        let tools = AsyncToolCollection::<()>::new()
            .add_tool::<ReadThing, ()>()
            .add_tool::<EditDeck, ()>()
            .defer_all_except(&["ReadThing"]);

        assert_eq!(sent(&tools), vec!["ReadThing".to_string()]);
        let catalog = tools.searchable_catalog();
        assert_eq!(catalog.len(), 1);
        assert_eq!(catalog[0].name, "EditDeck");
        assert_eq!(
            catalog[0].description,
            "Edit a slide deck. Applies a batch of operations."
        );
        assert!(
            catalog[0].schema.as_object().unwrap()["properties"]
                .as_object()
                .unwrap()
                .contains_key("operations"),
            "the catalog carries the schema to register on load"
        );
    }

    #[test]
    fn deferral_survives_widening_and_later_tools_are_eager() {
        let base = AsyncToolCollection::<()>::new()
            .add_tool::<ReadThing, ()>()
            .add_tool::<EditDeck, ()>()
            .defer_all_except(&["ReadThing"]);

        let tools = AsyncToolCollection::<()>::new()
            .add_subtoolset(base)
            .add_tool::<AskThing, ()>();

        assert!(tools.is_deferred("EditDeck"));
        assert_eq!(
            sent(&tools),
            vec!["AskThing".to_string(), "ReadThing".to_string()]
        );
    }

    #[tokio::test]
    async fn deferred_tools_stay_callable() {
        let tools = AsyncToolCollection::<()>::new()
            .add_tool::<EditDeck, ()>()
            .defer_all_except(&[]);
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
}
