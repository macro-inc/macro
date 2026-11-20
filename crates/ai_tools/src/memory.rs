//! Memory composition root. The domain never depends on the combined tool host.
use crate::{ToolEmailToolContext, ToolServiceContext, base_toolset};
use macro_user_id::user_id::MacroUserIdStr;
use memory::{
    domain::{ports::*, service::MemoryServiceImpl},
    outbound::{
        generator::AgentMemoryGenerator,
        jev_judge::{JevMemoryJudge, UnconfiguredJudge},
        pg_memory_repo::PgMemoryRepo,
    },
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

/// Activity presence comes from the activity log, which records authored
/// documents, task changes, sent email and channel messages.
struct MemoryActivityLog<R>(R);
#[async_trait::async_trait]
impl<R: activity::SubjectActivityPresence + Send + Sync> MemoryActivity for MemoryActivityLog<R> {
    #[tracing::instrument(skip_all, fields(date = %date), err)]
    async fn acted_on(&self, user: &MacroUserIdStr<'_>, date: chrono::NaiveDate) -> Result<bool> {
        let from = date.and_time(chrono::NaiveTime::MIN).and_utc();
        self.0
            .touched_between(user.as_ref(), from, from + chrono::Duration::days(1))
            .await
            .map_err(|e| MemoryError::Db(rootcause::report!(e).into_dynamic()))
    }
}

fn memory_activity(pool: sqlx::PgPool) -> Arc<dyn MemoryActivity> {
    Arc::new(MemoryActivityLog(
        activity::outbound::pg_activity_repo::PgActivityRepo::new(pool),
    ))
}

/// The privacy judge: TypeSafe's Jev when `TYPESAFE_API_KEY` is set. Without
/// it nothing passes review, so this host saves no memory.
fn build_memory_judge(recorder: Arc<dyn ai_usage::UsageRecorder>) -> Arc<dyn MemoryJudge> {
    let provider = jev::outbound::TypesafeApiKey::new()
        .and_then(|key| key.value().map(jev::outbound::SystemOneJev::typesafe));
    match provider {
        Some(Ok(provider)) => Arc::new(JevMemoryJudge::new(jev::domain::JevClassifier::new(
            provider, recorder,
        ))),
        Some(Err(error)) => {
            tracing::error!(error = ?error, "memory privacy review is misconfigured; no memory will be saved");
            Arc::new(UnconfiguredJudge)
        }
        None => {
            tracing::warn!("TYPESAFE_API_KEY is unset; no memory will be saved on this host");
            Arc::new(UnconfiguredJudge)
        }
    }
}

/// Build the daily generator with a deliberately bounded set of read capabilities.
pub fn build_memory_service(
    pool: sqlx::PgPool,
    context: ToolServiceContext,
) -> MemoryServiceImpl<PgMemoryRepo> {
    let mut toolset = base_toolset()
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
    let judge = build_memory_judge(context.recorder.clone());
    let generator = AgentMemoryGenerator {
        recorder: context.recorder.clone(),
        context,
        tools: Arc::new(toolset),
        tool_prompt: prompt::DIRECT_TOOL_USE_PROMPT.to_string(),
    };
    MemoryServiceImpl::new(
        PgMemoryRepo::new(pool.clone()),
        Arc::new(generator),
        judge,
        Arc::new(MemoryTeamRepository(
            teams::outbound::team_repo::TeamRepositoryImpl::new(pool.clone()),
        )),
        memory_activity(pool),
    )
}

/// Explicit edits require only the privacy judge, not the research host.
pub fn build_memory_tool_context(
    pool: sqlx::PgPool,
    recorder: Arc<dyn ai_usage::UsageRecorder>,
) -> ToolMemoryContext {
    let judge = build_memory_judge(recorder.clone());
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
            judge,
            Arc::new(MemoryTeamRepository(
                teams::outbound::team_repo::TeamRepositoryImpl::new(pool.clone()),
            )),
            memory_activity(pool),
        )),
    }
}
