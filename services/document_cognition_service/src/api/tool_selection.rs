use crate::model::stream::ToolSet;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// Select actual capabilities before polling discovery. Restricting the prompt
/// alone does not remove tools, and scoped requests must not load connectors.
pub(crate) async fn select_tools<Context: Send + Sync + 'static>(
    selection: &ToolSet,
    database_tools: impl Future<Output = Arc<dyn ai_toolset::ToolSet<Context> + Send + Sync>>,
    database_read_only_tools: impl Future<Output = Arc<dyn ai_toolset::ToolSet<Context> + Send + Sync>>,
    all_tools: impl Future<Output = Arc<dyn ai_toolset::ToolSet<Context> + Send + Sync>>,
) -> Arc<dyn ai_toolset::ToolSet<Context> + Send + Sync> {
    match selection {
        ToolSet::None => Arc::new(ai_toolset::AsyncToolCollection::new()),
        ToolSet::Databases => database_tools.await,
        ToolSet::DatabasesReadOnly => database_read_only_tools.await,
        ToolSet::All => all_tools.await,
    }
}
