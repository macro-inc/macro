//! Memory host composition using the shared, configured tool services.

use ai_tools::{ToolServiceContext, build_tool_service_context_from_env};
use tokio_util::task::TaskTracker;

use crate::config::Config;

/// Build memory's tools at startup with the same quota policy as other hosts.
/// The memory domain binds its exempt `Memory` feature when it starts an operation;
/// the shared context must not globally exempt independently initiated AI tools.
#[tracing::instrument(skip_all, err)]
pub async fn build_tool_service_context(
    pool: sqlx::PgPool,
    config: &Config,
    event_task_tracker: TaskTracker,
) -> anyhow::Result<ToolServiceContext> {
    build_tool_service_context_from_env(
        pool,
        event_task_tracker,
        config.enable_ai_usage_enforcement,
        config.ai_pricing,
    )
    .await
}
