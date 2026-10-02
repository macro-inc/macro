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
        ToolSet::None | ToolSet::DatabasesReadOnly => &prompt::BASE_PROMPT,
        ToolSet::Databases => &prompt::DATABASE_TOOL_USE_PROMPT,
    }
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
