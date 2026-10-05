use crate::model::stream::ToolSet;
use ai_tools::{AiToolSet, ToolMcpSelector, ToolServiceContext};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_select::ConnectorSelect;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// The tools this service runs for a turn, as one dispatchable set.
pub(crate) type SelectedTools<Context> = Arc<dyn ai_toolset::ToolSet<Context> + Send + Sync>;

/// The system prompt that describes the tools `selection` grants.
pub(crate) fn choose_tools_prompt<'a>(
    selection: &ToolSet,
    all_tools_prompt: &'a (dyn std::fmt::Display + Sync),
) -> &'a (dyn std::fmt::Display + Sync) {
    match selection {
        ToolSet::All => all_tools_prompt,
        ToolSet::None => &prompt::BASE_PROMPT,
        ToolSet::DatabasesReadOnly => &prompt::DATABASE_READ_ONLY_TOOL_USE_PROMPT,
        ToolSet::Databases => &prompt::DATABASE_TOOL_USE_PROMPT,
    }
}

/// Keep the database dialect and parameter reference in both discovery and
/// formatting. Tool descriptions come from the registered schemas, so frontend
/// callers cannot drift onto a second, obsolete copy of the SQL grammar.
pub(crate) fn structured_completion_prompt(
    selection: &ToolSet,
    all_tools_prompt: &(dyn std::fmt::Display + Sync),
    additional_instructions: Option<&str>,
    schemas: &[ai_toolset::RequestSchema],
) -> String {
    let mut prompt = choose_tools_prompt(selection, all_tools_prompt).to_string();
    if matches!(selection, ToolSet::Databases | ToolSet::DatabasesReadOnly) {
        prompt.push_str("\n## Registered database tools\nThese are the available tools and their authoritative reference. Read-only host restrictions override any write examples in a shared tool description.\n");
        for tool in schemas {
            prompt.push_str(&format!(
                "\n### {}\n{:#}\n",
                tool.name,
                tool.schema.as_value()
            ));
        }
    }
    if let Some(instructions) = additional_instructions {
        prompt.push('\n');
        prompt.push_str(instructions);
    }
    prompt
}

/// The service's tools for `selection`: a database toolset, or every static
/// tool plus the user's connectors.
pub(crate) async fn service_tools(
    selection: &ToolSet,
    static_tools: Arc<AiToolSet>,
    mcp_selector: &ToolMcpSelector,
    user_id: &MacroUserIdStr<'static>,
) -> SelectedTools<ToolServiceContext> {
    select_tools(
        selection,
        async {
            let tools: SelectedTools<ToolServiceContext> = Arc::new(ai_tools::database_tools());
            tools
        },
        async {
            let tools: SelectedTools<ToolServiceContext> =
                Arc::new(ai_tools::database_read_only_tools());
            tools
        },
        async {
            let mcp_tools = mcp_selector.user_toolset(user_id).await;
            let tools: SelectedTools<ToolServiceContext> =
                Arc::new(mcp_select::CombinedToolSet::new(static_tools, mcp_tools));
            tools
        },
    )
    .await
}

/// Select actual capabilities before polling discovery. Restricting the prompt
/// alone does not remove tools, and scoped requests must not load connectors.
pub(crate) async fn select_tools<Context: Send + Sync + 'static>(
    selection: &ToolSet,
    database_tools: impl Future<Output = SelectedTools<Context>>,
    database_read_only_tools: impl Future<Output = SelectedTools<Context>>,
    all_tools: impl Future<Output = SelectedTools<Context>>,
) -> SelectedTools<Context> {
    match selection {
        ToolSet::None => Arc::new(ai_toolset::AsyncToolCollection::new()),
        ToolSet::Databases => database_tools.await,
        ToolSet::DatabasesReadOnly => database_read_only_tools.await,
        ToolSet::All => all_tools.await,
    }
}
