use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use schemars::{JsonSchema, Schema, SchemaGenerator};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;

use crate::ToolServiceContext;

#[derive(Debug, Serialize, JsonSchema)]
pub struct ShowResponse {
    pub message: String,
}

#[cfg(test)]
mod test;
mod view_check;

/// The model-facing schema, generated from the renderer's Zod schema.
const SCHEMA_JSON: &str = include_str!("show/schema.generated.json");

/// How many of a view's problems the model is told at once.
const PROBLEMS_LISTED: usize = 10;

/// What the renderer would reject in a view, each problem with its place in
/// the view; empty for a view it draws. Code mode checks the view a program
/// returns with it, as this tool checks its own.
pub fn view_problems(view: &serde_json::Value) -> Vec<String> {
    view_check::view_problems(view)
}

/// A view rendered by the frontend directly from the tool-call arguments.
///
/// The AI input schema is generated from the renderer's Zod schema. Keeping it
/// on the tool means agent sessions do not depend on frontend instructions.
#[derive(Debug, Deserialize)]
pub struct Show {
    /// Kept as JSON: the renderer reads it from the tool-call arguments as
    /// they stream, and the call checks it against the generated schema.
    pub view: serde_json::Value,
}

// Frontend wire typegen must remain permissive: streamed arguments are incomplete
// until the call finishes, and DashboardToolView owns validation/error rendering.
// Preserve this contract separately from the model-facing recursive input schema.
#[derive(JsonSchema)]
#[schemars(
    title = "Show",
    description = "Show the user a rich view. The `view` argument is a dynamic-UI view object (a title plus an ordered list of widgets) following the dynamic-UI schema provided to you. The view is rendered immediately in the chat; this tool returns as soon as it is dispatched."
)]
struct ShowWire {
    #[expect(dead_code, reason = "only used to generate the frontend wire schema")]
    #[schemars(
        description = "The dynamic-UI view to render: an object with an optional `title` and a `widgets` array, per the provided dynamic-UI schema."
    )]
    view: serde_json::Value,
}

impl JsonSchema for Show {
    fn schema_name() -> Cow<'static, str> {
        "Show".into()
    }

    fn json_schema(generator: &mut SchemaGenerator) -> Schema {
        if generator.settings().inline_subschemas {
            // The AI pipeline requests a complete root schema. Its recursive
            // widget refs and $defs must stay together at that root; nesting
            // this schema below `view` would break their JSON-pointer targets.
            serde_json::from_str(SCHEMA_JSON)
                .expect("the generated Show tool schema must be valid JSON Schema")
        } else {
            ShowWire::json_schema(generator)
        }
    }
}

impl ToolAnnotated for Show {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::read_only("Show the user").without_idempotent();
}

#[async_trait]
impl AsyncTool<ToolServiceContext> for Show {
    type Output = ShowResponse;

    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        _service_context: ServiceContext<ToolServiceContext>,
        _request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        // The view is rendered on the frontend from the tool call arguments.
        // One the renderer would not draw is turned back while the model can
        // still fix it, instead of being posted as a broken dashboard.
        check_view(&self.view)?;
        Ok(ShowResponse {
            message: "The view has been shown to the user.".to_string(),
        })
    }
}

/// A view the renderer would not draw is not posted. The model is told what
/// to change, so it can send the view again.
fn check_view(view: &serde_json::Value) -> ToolResult<()> {
    let problems = view_check::view_problems(view);
    if problems.is_empty() {
        return Ok(());
    }
    let mut lines: Vec<String> = problems
        .iter()
        .take(PROBLEMS_LISTED)
        .map(|problem| format!("- {problem}"))
        .collect();
    if problems.len() > PROBLEMS_LISTED {
        lines.push(format!("- and {} more", problems.len() - PROBLEMS_LISTED));
    }
    Err(ToolCallError {
        description: format!(
            "The view was not shown: it does not match the Show schema.\n{}\nFix these and call Show again with the whole view.",
            lines.join("\n")
        ),
        internal_error: anyhow::anyhow!(
            "the view does not match the Show schema ({} problems)",
            problems.len()
        ),
    })
}
