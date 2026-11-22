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

#[test]
fn the_database_host_carries_how_databases_work_and_no_other_area() {
    let prompt = choose_tools_prompt(&ToolSet::Databases, &"Unrelated tools").to_string();
    assert!(prompt.starts_with(&prompt::BASE_PROMPT.to_string()));
    assert!(prompt.contains("check every database's tables"));
    assert!(prompt.contains("Never invent a person or an id"));
    assert!(!prompt.contains("How CRM pipelines work"));
    // BASE_PROMPT's Markdown note mentions email bodies without granting an
    // email tool; the scoped prompt must omit its action rules.
    assert!(!prompt.contains("MUST use the `SendEmail` tool"));
}

fn chat_user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("chat@example.com").unwrap()
}

fn tool_names(tools: &connectors::UserMcpTools) -> Vec<String> {
    let mut names: Vec<String> = tools.catalog().into_iter().map(|tool| tool.name).collect();
    names.sort();
    names
}

/// Chat loads the tools of exactly the connections the rules leave usable:
/// an enabled Pipedream app and a server added by URL, never a disabled app
/// or one whose grant needs authorizing again.
#[tokio::test]
async fn chat_loads_the_tools_of_usable_connections_only() {
    use connectors::fake::{FakeConnection, FakeConnectors};
    let connectors = FakeConnectors::new()
        .with_connection(
            &chat_user(),
            FakeConnection::app("linear")
                .named("Linear")
                .with_tools(&["create_issue"]),
        )
        .with_connection(
            &chat_user(),
            FakeConnection::server("https://mcp.example.com/mcp")
                .named("Example")
                .with_tools(&["lookup"]),
        )
        .with_connection(
            &chat_user(),
            FakeConnection::app("asana")
                .named("Asana")
                .with_tools(&["create_task"])
                .disabled(),
        )
        .with_connection(
            &chat_user(),
            FakeConnection::app("notion")
                .named("Notion")
                .with_tools(&["search"])
                .needs_reauth(),
        )
        .build();

    let names = tool_names(&user_mcp_tools(&connectors, &chat_user()).await);

    assert_eq!(names.len(), 2, "{names:?}");
    assert!(
        names.iter().any(|name| name.ends_with("create_issue")),
        "{names:?}"
    );
    assert!(
        names.iter().any(|name| name.ends_with("lookup")),
        "{names:?}"
    );
}

/// A flagged user's app that Macro Connect serves loads through Connect; an
/// unflagged user holding the same app through Pipedream loads it too. Each
/// gets the connection the rules count for them, and nothing else.
#[tokio::test]
async fn chat_loads_the_connection_that_counts_for_the_user() {
    use connectors::fake::{FakeConnection, FakeConnectors};
    let flagged = MacroUserIdStr::try_from_email("flagged@example.com").unwrap();
    let connectors = FakeConnectors::new()
        .with_connect_app("linear", true)
        .with_flag_on(&flagged)
        .with_connection(
            &flagged,
            FakeConnection::app("linear")
                .named("Linear")
                .with_tools(&["create_issue"]),
        )
        .with_connection(
            &chat_user(),
            FakeConnection::app("linear")
                .named("Linear")
                .with_tools(&["create_issue"]),
        )
        .build();

    for user in [flagged, chat_user()] {
        let names = tool_names(&user_mcp_tools(&connectors, &user).await);
        assert_eq!(names.len(), 1, "{names:?}");
    }
}

#[tokio::test]
async fn a_user_with_no_connections_gets_no_mcp_tools() {
    let connectors = connectors::fake::FakeConnectors::new().build();

    assert!(user_mcp_tools(&connectors, &chat_user()).await.is_empty());
}
