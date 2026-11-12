use crate::cognition::model::stream::ToolSet;
use agent_code_mode::domain::UserCodeMode;
use agent_code_mode::inbound::toolset::UserCodeModeToolContext;
use ai_tools::{AiToolSet, ToolMcpSelector, ToolServiceContext};
use ai_toolset::{AsyncToolCollection, RequestContext, ToolCaller};
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use mcp_select::ConnectorSelect;
use std::pin::Pin;
use std::sync::{Arc, LazyLock};

#[cfg(test)]
mod test;

/// The tools this service runs for a turn, as one dispatchable set.
pub(crate) type SelectedTools<Context> = Arc<dyn ai_toolset::ToolSet<Context> + Send + Sync>;

/// PostHog key evaluated for the requesting user.
pub const AI_DB_ASSISTANT_CODE_MODE: &str = "ai-db-assistant-code-mode";

/// Database-only agent instructions: the base prompt and how Macro databases
/// work, from `DatabaseNamespace`'s `@agent` guidance.
static DATABASE_TOOL_USE_PROMPT: LazyLock<String> = LazyLock::new(|| {
    format!(
        "{}# Macro databases\n{}\n",
        prompt::BASE_PROMPT,
        agent_code_mode::domain::entity_guide("databases").unwrap_or_default()
    )
});

/// The database assistant in code mode: the same guidance, worked through
/// `macro.databases` in `ExecuteCode` programs.
static DATABASE_CODE_MODE_PROMPT: LazyLock<String> = LazyLock::new(|| {
    format!(
        "{}{}",
        *DATABASE_TOOL_USE_PROMPT,
        include_str!("tool_selection/database_code_mode.md")
    )
});

/// What a request's toolset is for its user, once the database assistant's
/// flag has been read.
#[derive(Clone)]
pub(crate) enum ResolvedTools {
    All,
    None,
    Databases,
    /// The database assistant in code mode.
    DatabaseCode(Arc<DatabaseCodeSurface>),
    DatabasesReadOnly,
}

impl ResolvedTools {
    fn is_database(&self) -> bool {
        matches!(
            self,
            Self::Databases | Self::DatabaseCode(_) | Self::DatabasesReadOnly
        )
    }
}

/// User-scoped code execution for the database assistant.
pub struct DatabaseCodeSurface {
    /// `ExecuteCode`, `DescribeCodeTools` and `ReadCodeDocs`.
    tools: Arc<AsyncToolCollection<UserCodeModeToolContext>>,
    service: Arc<dyn UserCodeMode>,
    cognition: Option<Arc<dyn cognition::domain::Cognition>>,
}

impl DatabaseCodeSurface {
    pub fn new(
        service: Arc<dyn UserCodeMode>,
        cognition: Option<Arc<dyn cognition::domain::Cognition>>,
    ) -> Self {
        Self {
            tools: Arc::new(agent_code_mode::inbound::toolset::user_toolset()),
            service,
            cognition,
        }
    }
}

/// Whether a user's database assistant runs code mode.
pub trait DatabaseCodeModePolicy: Send + Sync {
    /// Whether `user`'s database assistant runs code mode; unavailable flags
    /// do not.
    fn enabled<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>>;
}

/// Default when this deployment has no feature-flag provider.
pub struct DirectDatabaseTools;

impl DatabaseCodeModePolicy for DirectDatabaseTools {
    fn enabled<'a>(
        &'a self,
        _: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(async { false })
    }
}

/// Code mode for users with [`AI_DB_ASSISTANT_CODE_MODE`].
pub struct FlaggedDatabaseCodeMode<F> {
    flags: F,
}

impl<F: FeatureFlags> FlaggedDatabaseCodeMode<F> {
    /// Compose with a provider whose load has a bounded deadline.
    pub fn new(flags: F) -> Self {
        Self { flags }
    }
}

impl<F: FeatureFlags> DatabaseCodeModePolicy for FlaggedDatabaseCodeMode<F> {
    fn enabled<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(async move {
            self.flags
                .load(user)
                .await
                .inspect_err(|error| {
                    tracing::warn!(
                        ?error,
                        "feature flags unavailable; the database assistant stays direct"
                    );
                })
                .unwrap_or_default()
                .is_enabled(AI_DB_ASSISTANT_CODE_MODE)
        })
    }
}

/// The flagged user's database assistant needs code mode, and this
/// deployment cannot run code.
#[derive(Debug, thiserror::Error)]
#[error("The code runner is unavailable, so the database assistant could not run. Please retry.")]
pub(crate) struct CodeRunnerUnavailable;

/// How the database assistant runs: the flag, and the code execution it
/// needs when the flag is on.
pub struct DatabaseCodeMode {
    policy: Arc<dyn DatabaseCodeModePolicy>,
    surface: Option<Arc<DatabaseCodeSurface>>,
}

impl DatabaseCodeMode {
    /// The direct database tools for everyone.
    pub fn direct() -> Self {
        Self {
            policy: Arc::new(DirectDatabaseTools),
            surface: None,
        }
    }

    /// Code mode for users `policy` enables, run on `surface`.
    pub fn new(
        policy: Arc<dyn DatabaseCodeModePolicy>,
        surface: Option<DatabaseCodeSurface>,
    ) -> Self {
        Self {
            policy,
            surface: surface.map(Arc::new),
        }
    }

    /// `selection` for `user`. Only the database assistant reads the flag;
    /// document answers keep the direct read-only tools, whose access is
    /// capped at view.
    pub(crate) async fn resolve(
        &self,
        selection: &ToolSet,
        user: &MacroUserIdStr<'_>,
    ) -> Result<ResolvedTools, CodeRunnerUnavailable> {
        Ok(match selection {
            ToolSet::All => ResolvedTools::All,
            ToolSet::None => ResolvedTools::None,
            ToolSet::DatabasesReadOnly => ResolvedTools::DatabasesReadOnly,
            ToolSet::Databases => {
                if !self.policy.enabled(user).await {
                    return Ok(ResolvedTools::Databases);
                }
                match &self.surface {
                    Some(surface) => ResolvedTools::DatabaseCode(Arc::clone(surface)),
                    None => {
                        tracing::error!("code runner unavailable; refusing the database assistant");
                        return Err(CodeRunnerUnavailable);
                    }
                }
            }
        })
    }
}

/// The user code-mode tools, run for the request's user with no session, and
/// attributed to the Macro bot as an API key caller's programs are.
struct DatabaseCodeTools {
    tools: Arc<AsyncToolCollection<UserCodeModeToolContext>>,
    context: UserCodeModeToolContext,
}

impl<Context: Send + Sync + 'static> ai_toolset::ToolSet<Context> for DatabaseCodeTools {
    fn dispatch_tool_call<'a>(
        &'a self,
        _: Context,
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> ai_toolset::ToolCallFuture<'a> {
        self.tools
            .dispatch_tool_call(self.context.clone(), request_context, tool_name, json)
    }

    fn request_schemas(&self) -> Option<Vec<ai_toolset::RequestSchema>> {
        self.tools.request_schemas()
    }
}

fn database_code_tools<Context: Send + Sync + 'static>(
    surface: &DatabaseCodeSurface,
) -> SelectedTools<Context> {
    Arc::new(DatabaseCodeTools {
        tools: Arc::clone(&surface.tools),
        context: UserCodeModeToolContext {
            service: Arc::clone(&surface.service),
            cognition: surface.cognition.clone(),
            caller: ToolCaller::ApiKey,
            session: None,
        },
    })
}

/// The system prompt that describes the tools `selection` grants.
pub(crate) fn choose_tools_prompt<'a>(
    selection: &ResolvedTools,
    all_tools_prompt: &'a (dyn std::fmt::Display + Sync),
) -> &'a (dyn std::fmt::Display + Sync) {
    match selection {
        ResolvedTools::All => all_tools_prompt,
        ResolvedTools::None => &prompt::BASE_PROMPT,
        ResolvedTools::DatabasesReadOnly => &prompt::DATABASE_READ_ONLY_TOOL_USE_PROMPT,
        ResolvedTools::Databases => &*DATABASE_TOOL_USE_PROMPT,
        ResolvedTools::DatabaseCode(_) => &*DATABASE_CODE_MODE_PROMPT,
    }
}

/// Keep the database dialect and parameter reference in both discovery and
/// formatting. Tool descriptions come from the registered schemas, so frontend
/// callers cannot drift onto a second, obsolete copy of the SQL grammar.
pub(crate) fn structured_completion_prompt(
    selection: &ResolvedTools,
    all_tools_prompt: &(dyn std::fmt::Display + Sync),
    additional_instructions: Option<&str>,
    schemas: &[ai_toolset::RequestSchema],
) -> String {
    let mut prompt = choose_tools_prompt(selection, all_tools_prompt).to_string();
    if selection.is_database() {
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
    selection: &ResolvedTools,
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
    selection: &ResolvedTools,
    database_tools: impl Future<Output = SelectedTools<Context>>,
    database_read_only_tools: impl Future<Output = SelectedTools<Context>>,
    all_tools: impl Future<Output = SelectedTools<Context>>,
) -> SelectedTools<Context> {
    match selection {
        ResolvedTools::None => Arc::new(ai_toolset::AsyncToolCollection::new()),
        ResolvedTools::Databases => database_tools.await,
        ResolvedTools::DatabaseCode(surface) => database_code_tools(surface),
        ResolvedTools::DatabasesReadOnly => database_read_only_tools.await,
        ResolvedTools::All => all_tools.await,
    }
}
