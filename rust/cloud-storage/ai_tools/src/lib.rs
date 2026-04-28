#![recursion_limit = "256"]

use ai_toolset::AsyncToolSet;
use ai_toolset::schema::{CombinedToolSchemas, ToolSchemaGenerator};
mod build_context;
pub mod prompts;
mod schemas;
pub mod search;
pub mod serde_utils;
mod subagent;
mod tool_context;

use call::inbound::toolset::call_toolset;
use chat::inbound::toolset::chat_toolset;
use documents::inbound::toolset::document_toolset;
use email::inbound::toolset::email_toolset;
use properties::inbound::toolset::properties_toolset;
use schemas::{anthropic_tools, read};
use soup::inbound::toolset::{ListEntities, SoupToolContext};
use std::sync::Arc;
use subagent::Subagent;

pub use build_context::build_tool_service_context_from_env;
pub use search::search_toolset;
pub use tool_context::*;

pub type AiToolSet = AsyncToolSet<ToolServiceContext>;

pub struct ToolSetWithPrompt {
    pub toolset: Arc<AiToolSet>,
    pub prompt: &'static str,
}

impl ToolSchemaGenerator for ToolSetWithPrompt {
    fn generate_schemas(&self) -> ai_toolset::schema::ToolSchemas {
        self.toolset.generate_schemas()
    }

    fn register_schemas(
        &self,
        generator: &mut schemars::SchemaGenerator,
    ) -> Vec<ai_toolset::schema::CombinedToolEntry> {
        self.toolset.register_schemas(generator)
    }
}

/// Toolset available to subagents — everything except email and the Subagent
/// tool itself (subagents cannot create subagents).
pub(crate) fn subagent_toolset() -> AiToolSet {
    AsyncToolSet::new()
        .add_toolset(search_toolset())
        .add_tool::<ListEntities, SoupToolContext<ToolSoupService, ToolEmailService>>()
        .add_subtoolset::<ToolDocumentToolContext>(document_toolset())
        .add_subtoolset::<ToolPropertiesToolContext>(properties_toolset())
        .add_subtoolset::<ToolCallToolContext>(call_toolset())
        .add_subtoolset::<ToolChatToolContext>(chat_toolset())
}

/// These are actually sent to the AI provider
pub fn all_tools() -> ToolSetWithPrompt {
    let toolset = subagent_toolset()
        .add_subtoolset::<ToolEmailToolContext>(email_toolset())
        .add_tool::<Subagent, ToolServiceContext>();
    let prompt = prompts::TOOLS_PROMPT;
    let toolset = Arc::new(toolset);
    ToolSetWithPrompt { toolset, prompt }
}

/// Combined schema with shared, deduplicated `$defs`.
///
/// Uses a single [`schemars::SchemaGenerator`] so types referenced by
/// multiple tools (e.g. `CodeExecutionErrorCode`) appear exactly once.
pub fn all_tool_combined_schema() -> CombinedToolSchemas {
    use ai_toolset::schema::NormaliseRefSiblings;
    use schemars::transform::RecursiveTransform;

    let mut generator = schemars::generate::SchemaSettings::draft2020_12()
        .with(|s| s.meta_schema = None)
        .with_transform(RecursiveTransform(NormaliseRefSiblings))
        .into_generator();

    let mut tools = Vec::new();
    tools.extend(all_tools().register_schemas(&mut generator));
    tools.extend(anthropic_tools::web_search().register_schemas(&mut generator));
    tools.extend(anthropic_tools::web_fetch().register_schemas(&mut generator));
    tools.extend(anthropic_tools::bash_code_execution().register_schemas(&mut generator));
    tools.extend(anthropic_tools::text_editor_code_execution().register_schemas(&mut generator));
    tools.extend(read::read_thread().register_schemas(&mut generator));

    let defs = generator.take_definitions(true);
    let mut combined = CombinedToolSchemas { defs, tools };
    combined.mangle_collisions();
    combined
}

pub fn no_tools() -> ToolSetWithPrompt {
    ToolSetWithPrompt {
        prompt: prompts::BASE_PROMPT,
        toolset: Arc::new(AsyncToolSet::new()),
    }
}
