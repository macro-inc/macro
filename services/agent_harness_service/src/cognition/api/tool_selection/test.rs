use super::*;
use ai_toolset::{RequestContext, ToolSet as _, ToolSetError};
use macro_user_id::user_id::MacroUserIdStr;

#[tokio::test]
async fn none_does_not_load_or_dispatch_any_tools() {
    let tools = select_tools::<()>(
        &ToolSet::None,
        async { panic!("must not build database tools") },
        async { panic!("must not build read-only database tools") },
        async { panic!("must not discover connectors") },
    )
    .await;
    assert!(tools.request_schemas().is_none());
    assert!(tools.searchable_catalog().is_empty());
    let caller = MacroUserIdStr::try_from_email("test@macro.com").unwrap();
    let error = tools
        .try_tool_call(
            (),
            RequestContext::new(caller),
            "QueryDatabase",
            &serde_json::json!({}),
        )
        .await
        .unwrap_err();
    assert!(matches!(error, ToolSetError::NotFound(_)));
}

#[tokio::test]
async fn databases_never_polls_unrelated_discovery() {
    let expected: Arc<dyn ai_toolset::ToolSet<()> + Send + Sync> =
        Arc::new(ai_toolset::AsyncToolCollection::new());
    let actual = select_tools(
        &ToolSet::Databases,
        async { expected.clone() },
        async { panic!("must not build read-only tools") },
        async { panic!("database requests must not discover connectors") },
    )
    .await;
    assert!(Arc::ptr_eq(&actual, &expected));
}

#[tokio::test]
async fn all_retains_the_supplied_toolset() {
    let expected: Arc<dyn ai_toolset::ToolSet<()> + Send + Sync> =
        Arc::new(ai_toolset::AsyncToolCollection::new());
    let actual = select_tools(
        &ToolSet::All,
        async { panic!("all already includes database tools") },
        async { panic!("must not build read-only tools") },
        async { expected.clone() },
    )
    .await;
    assert!(Arc::ptr_eq(&actual, &expected));
}

#[tokio::test]
async fn read_only_never_loads_mutation_tools_or_connectors() {
    let expected: Arc<dyn ai_toolset::ToolSet<()> + Send + Sync> =
        Arc::new(ai_toolset::AsyncToolCollection::new());
    let actual = select_tools(
        &ToolSet::DatabasesReadOnly,
        async { panic!("must not build mutation tools") },
        async { expected.clone() },
        async { panic!("must not discover connectors") },
    )
    .await;
    assert!(Arc::ptr_eq(&actual, &expected));
}

#[test]
fn database_formatter_retains_the_registered_sql_reference() {
    let tools = ai_tools::database_read_only_tools();
    let schemas = tools.request_schemas().unwrap();
    let prompt = structured_completion_prompt(
        &ToolSet::DatabasesReadOnly,
        &"Unrelated tools",
        Some("Return the chart configuration."),
        &schemas,
    );
    let query = schemas
        .iter()
        .find(|schema| schema.name == "QueryDatabase")
        .unwrap();
    assert!(prompt.contains(&format!("{:#}", query.schema.as_value())));
    for text in [
        "ListDatabases",
        "DescribeDatabase",
        "read-only",
        "Return the chart configuration.",
    ] {
        assert!(prompt.contains(text), "missing {text}");
    }
    assert!(!prompt.contains("Unrelated tools"));
    assert!(!prompt.contains("### SaveDatabaseView"));
    assert!(!prompt.contains("### SaveDatabaseQuery"));
}

#[test]
fn tool_free_completions_do_not_receive_a_database_catalog() {
    let tools = ai_tools::database_read_only_tools();
    let prompt = structured_completion_prompt(
        &ToolSet::None,
        &"Unrelated tools",
        Some("Summarize."),
        &tools.request_schemas().unwrap(),
    );
    assert!(prompt.ends_with("Summarize."));
    assert!(!prompt.contains("Registered database tools"));
}
