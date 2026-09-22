use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use schemars::{JsonSchema, Schema, SchemaGenerator};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;

use crate::ToolServiceContext;

#[derive(Debug, Serialize, JsonSchema)]
pub struct DisplayResultsResponse {
    pub message: String,
}

#[cfg(test)]
mod test;

/// A view rendered by the frontend directly from the tool-call arguments.
///
/// The AI input schema is generated from the renderer's Zod schema. Keeping it
/// on the tool means agent sessions do not depend on frontend instructions.
#[derive(Debug, Deserialize)]
pub struct DisplayResults {
    /// Kept opaque so the renderer can handle partial and malformed views.
    #[expect(dead_code, reason = "the frontend consumes the tool-call arguments")]
    pub view: serde_json::Value,
}

// Frontend wire typegen must remain permissive: streamed arguments are incomplete
// until the call finishes, and DashboardToolView owns validation/error rendering.
// Preserve this contract separately from the model-facing recursive input schema.
#[derive(JsonSchema)]
#[schemars(
    title = "DisplayResults",
    description = "Present results to the user as a rich view. The `view` argument is a dynamic-UI view object (a title plus an ordered list of widgets) following the dynamic-UI schema provided to you. The view is rendered immediately in the chat; this tool returns as soon as it is dispatched."
)]
struct DisplayResultsWire {
    #[expect(dead_code, reason = "only used to generate the frontend wire schema")]
    #[schemars(
        description = "The dynamic-UI view to render: an object with an optional `title` and a `widgets` array, per the provided dynamic-UI schema."
    )]
    view: serde_json::Value,
}

impl JsonSchema for DisplayResults {
    fn schema_name() -> Cow<'static, str> {
        "DisplayResults".into()
    }

    fn json_schema(generator: &mut SchemaGenerator) -> Schema {
        if generator.settings().inline_subschemas {
            // The AI pipeline requests a complete root schema. Its recursive
            // widget refs and $defs must stay together at that root; nesting
            // this schema below `view` would break their JSON-pointer targets.
            serde_json::from_str(include_str!("display_results/schema.generated.json"))
                .expect("the generated DisplayResults tool schema must be valid JSON Schema")
        } else {
            DisplayResultsWire::json_schema(generator)
        }
    }
}

impl ToolAnnotated for DisplayResults {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::read_only("Show results").without_idempotent();
}

#[async_trait]
impl AsyncTool<ToolServiceContext> for DisplayResults {
    type Output = DisplayResultsResponse;

    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        _service_context: ServiceContext<ToolServiceContext>,
        _request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        // The view is rendered on the frontend from the tool call arguments.
        // The backend has nothing to do; acknowledge immediately.
        Ok(DisplayResultsResponse {
            message: "The results have been displayed to the user.".to_string(),
        })
    }
}
