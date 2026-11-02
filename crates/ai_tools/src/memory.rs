//! Memory composition root. The domain never depends on the combined tool host.
use crate::{ToolEmailToolContext, ToolServiceContext, subagent_toolset};
use macro_user_id::user_id::MacroUserIdStr;
use memory::{
    domain::{ports::*, service::MemoryServiceImpl},
    outbound::{generator::AgentMemoryGenerator, pg_memory_repo::PgMemoryRepo},
};
use std::sync::Arc;
use teams::domain::team_repo::TeamRepository;

pub type ToolMemoryContext = memory::inbound::toolset::MemoryToolContext<PgMemoryRepo>;

struct MemoryTeamRepository<R>(R);
#[async_trait::async_trait]
impl<R: TeamRepository> MemoryTeams for MemoryTeamRepository<R> {
    #[tracing::instrument(skip_all, err)]
    async fn members(&self, user: &MacroUserIdStr<'_>) -> Result<Vec<(uuid::Uuid, Vec<String>)>> {
        let teams = self
            .0
            .get_user_teams(user)
            .await
            .map_err(|e| MemoryError::Other(anyhow::anyhow!(e)))?;
        let mut result = Vec::new();
        for team in teams {
            let members = self
                .0
                .get_team_members(team.id())
                .await
                .map_err(|e| MemoryError::Other(anyhow::anyhow!(e)))?;
            result.push((
                *team.id(),
                members
                    .into_iter()
                    .map(|m| m.user_id.as_ref().to_owned())
                    .collect(),
            ));
        }
        Ok(result)
    }
}

/// Build the daily generator with a deliberately bounded set of read capabilities.
pub fn build_memory_service(
    pool: sqlx::PgPool,
    context: ToolServiceContext,
) -> MemoryServiceImpl<PgMemoryRepo> {
    let mut toolset = subagent_toolset()
        .add_subtoolset::<ToolEmailToolContext>(email::inbound::toolset::mcp_toolset());
    // No shell, nested agents, connector discovery, mutations, memory reads, or
    // lazy tool loading: research cannot edit preferences or recursively read itself.
    toolset.tools.retain(|name, _| {
        matches!(
            name.as_str(),
            "ListEntities"
                | "NameSearch"
                | "ContentSearch"
                | "ReadContent"
                | "ReadMetadata"
                | "GetThread"
                | "ReadChannelMessages"
                | "ReadChannelThread"
                | "ReadChannelMessageContext"
        )
    });
    toolset.user_tools.clear();
    let generator = AgentMemoryGenerator {
        recorder: context.recorder.clone(),
        context,
        tools: Arc::new(toolset),
        tool_prompt: prompt::DIRECT_TOOL_USE_PROMPT.to_string(),
    };
    MemoryServiceImpl::new(
        PgMemoryRepo::new(pool.clone()),
        Arc::new(generator),
        Arc::new(MemoryTeamRepository(
            teams::outbound::team_repo::TeamRepositoryImpl::new(pool),
        )),
    )
}

/// Explicit edits require only a tool-free privacy judge, not the research host.
pub fn build_memory_tool_context(
    pool: sqlx::PgPool,
    recorder: Arc<dyn ai_usage::UsageRecorder>,
) -> ToolMemoryContext {
    let generator = AgentMemoryGenerator {
        context: (),
        tools: Arc::new(ai_toolset::AsyncToolCollection::<()>::new()),
        tool_prompt: String::new(),
        recorder,
    };
    ToolMemoryContext {
        service: Arc::new(MemoryServiceImpl::new(
            PgMemoryRepo::new(pool.clone()),
            Arc::new(generator),
            Arc::new(MemoryTeamRepository(
                teams::outbound::team_repo::TeamRepositoryImpl::new(pool),
            )),
        )),
    }
}
