use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use dynamic_ui::View;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::ToolServiceContext;

/// The view, decoded. Readers render it from the result, never from the
/// model's streamed arguments.
#[derive(Debug, Serialize, JsonSchema)]
pub struct DisplayResultsResponse {
    pub view: View,
}

#[cfg(test)]
mod test;

/// Decoding the arguments checks the view: one the renderer would not draw
/// fails the call with what to fix, and the model can call again.
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "DisplayResults",
    description = include_str!("display_results/description.md")
)]
pub struct DisplayResults {
    #[serde(deserialize_with = "dynamic_ui::deserialize_view")]
    #[schemars(with = "dynamic_ui::ViewWithoutDashboards")]
    pub view: View,
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
        Ok(DisplayResultsResponse {
            view: self.view.clone(),
        })
    }
}
