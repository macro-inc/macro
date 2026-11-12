use super::*;
use ai_toolset::{RequestContext, ToolSet as _, ToolSetError};
use macro_user_id::user_id::MacroUserIdStr;

#[tokio::test]
async fn none_does_not_load_or_dispatch_any_tools() {
    let tools = select_tools::<()>(
        &ResolvedTools::None,
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
        &ResolvedTools::Databases,
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
        &ResolvedTools::All,
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
        &ResolvedTools::DatabasesReadOnly,
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
        &ResolvedTools::DatabasesReadOnly,
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
        &ResolvedTools::None,
        &"Unrelated tools",
        Some("Summarize."),
        &tools.request_schemas().unwrap(),
    );
    assert!(prompt.ends_with("Summarize."));
    assert!(!prompt.contains("Registered database tools"));
}

#[test]
fn the_database_host_carries_how_databases_work_and_no_other_area() {
    let prompt = choose_tools_prompt(&ResolvedTools::Databases, &"Unrelated tools").to_string();
    assert!(prompt.starts_with(&prompt::BASE_PROMPT.to_string()));
    assert!(prompt.contains("check every database's tables"));
    assert!(prompt.contains("Never invent a person or an id"));
    assert!(!prompt.contains("How CRM pipelines work"));
    // BASE_PROMPT's Markdown note mentions email bodies without granting an
    // email tool; the scoped prompt must omit its action rules.
    assert!(!prompt.contains("MUST use the `SendEmail` tool"));
}

struct NoRunner;

#[async_trait::async_trait]
impl UserCodeMode for NoRunner {
    async fn execute(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &ToolCaller,
        _: Option<uuid::Uuid>,
        _: code_execution::domain::ExecuteRequest,
        _: tokio_util::sync::CancellationToken,
    ) -> Result<agent_code_mode::domain::UserExecutionReceipt, agent_code_mode::domain::CodeModeError>
    {
        Err(agent_code_mode::domain::CodeModeError::Unavailable)
    }
}

fn flagged(
    users: &[(&MacroUserIdStr<'static>, Result<bool, &str>)],
) -> Arc<dyn DatabaseCodeModePolicy> {
    use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};
    let mut flags = FakeFeatureFlags::default();
    for (user, value) in users {
        flags.set(
            (*user).clone(),
            value
                .map(|enabled| {
                    FlagSnapshot::new([(
                        AI_DB_ASSISTANT_CODE_MODE.into(),
                        FlagValue::Boolean(enabled),
                    )])
                })
                .map_err(str::to_owned),
        );
    }
    Arc::new(FlaggedDatabaseCodeMode::new(flags))
}

fn surface() -> DatabaseCodeSurface {
    DatabaseCodeSurface::new(Arc::new(NoRunner), None)
}

#[tokio::test]
async fn the_database_assistant_runs_code_mode_only_for_flagged_users() {
    let on = MacroUserIdStr::try_from_email("on@macro.com").unwrap();
    let off = MacroUserIdStr::try_from_email("off@macro.com").unwrap();
    let failing = MacroUserIdStr::try_from_email("failing@macro.com").unwrap();
    let mode = DatabaseCodeMode::new(
        flagged(&[
            (&on, Ok(true)),
            (&off, Ok(false)),
            (&failing, Err("unavailable")),
        ]),
        Some(surface()),
    );

    assert!(matches!(
        mode.resolve(&ToolSet::Databases, &on).await,
        Ok(ResolvedTools::DatabaseCode(_))
    ));
    for user in [&off, &failing] {
        assert!(matches!(
            mode.resolve(&ToolSet::Databases, user).await,
            Ok(ResolvedTools::Databases)
        ));
    }
    // Document answers keep their view-capped direct tools.
    assert!(matches!(
        mode.resolve(&ToolSet::DatabasesReadOnly, &on).await,
        Ok(ResolvedTools::DatabasesReadOnly)
    ));
    assert!(matches!(
        mode.resolve(&ToolSet::All, &on).await,
        Ok(ResolvedTools::All)
    ));
    assert!(matches!(
        DatabaseCodeMode::direct()
            .resolve(&ToolSet::Databases, &on)
            .await,
        Ok(ResolvedTools::Databases)
    ));
}

#[tokio::test]
async fn a_flagged_database_assistant_without_a_code_runner_fails() {
    let on = MacroUserIdStr::try_from_email("on@macro.com").unwrap();
    let mode = DatabaseCodeMode::new(flagged(&[(&on, Ok(true))]), None);
    assert!(mode.resolve(&ToolSet::Databases, &on).await.is_err());
    assert!(matches!(
        mode.resolve(&ToolSet::DatabasesReadOnly, &on).await,
        Ok(ResolvedTools::DatabasesReadOnly)
    ));
}

#[tokio::test]
async fn the_code_mode_database_assistant_offers_only_code_tools() {
    let selection = ResolvedTools::DatabaseCode(Arc::new(surface()));
    let tools = select_tools::<()>(
        &selection,
        async { panic!("must not build direct database tools") },
        async { panic!("must not build read-only tools") },
        async { panic!("must not discover connectors") },
    )
    .await;
    let mut names: Vec<_> = tools
        .request_schemas()
        .unwrap()
        .into_iter()
        .map(|schema| schema.name)
        .collect();
    names.sort();
    assert_eq!(names, ["DescribeCodeTools", "ExecuteCode", "ReadCodeDocs"]);

    let prompt = structured_completion_prompt(
        &selection,
        &"Unrelated tools",
        None,
        &tools.request_schemas().unwrap(),
    );
    assert!(prompt.contains("check every database's tables"));
    assert!(prompt.contains("macro.databases"));
    assert!(prompt.contains("### ExecuteCode"));
    assert!(!prompt.contains("Unrelated tools"));
}
