use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::ToolServiceContext;

// The about-page is `agent_code_mode::domain::about_macro`, which code mode
// reads as the `AboutMacro` symbol instead of this tool.

/// `selfKnowledge` returns an overview of Macro plus a routing map into the live
/// docs at docs.macro.com. It takes no arguments and does no I/O — it hands the
/// model a curated about-page so it can answer "what is Macro / how do I…"
/// questions accurately instead of guessing from stale training data, and then
/// read specific docs pages with WebFetch for detail.
#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[schemars(
    title = "SelfKnowledge",
    description = "\
Learn what Macro is and how it works. Call this whenever the user asks an open-ended \
question about Macro itself — what it is, what it's for, what it can do, or how to do \
something in Macro — instead of answering from memory (your training data may be stale). \
Takes no arguments. Returns an overview of Macro and a map of links into the official \
docs at docs.macro.com; every docs page is readable as Markdown (append `.md` to its URL), \
so follow up with WebFetch on the relevant page for details and cite it."
)]
pub struct SelfKnowledge {}

/// The response for the [`SelfKnowledge`] tool: a single Markdown about-page.
#[derive(Debug, Serialize, JsonSchema)]
pub struct SelfKnowledgeResponse {
    /// An overview of Macro and a routing map into the docs at docs.macro.com.
    pub about: String,
}

impl ToolAnnotated for SelfKnowledge {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("About Macro");
}

#[async_trait]
impl AsyncTool<ToolServiceContext> for SelfKnowledge {
    type Output = SelfKnowledgeResponse;

    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        _service_context: ServiceContext<ToolServiceContext>,
        _request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        Ok(SelfKnowledgeResponse {
            about: agent_code_mode::domain::about_macro().to_owned(),
        })
    }
}
