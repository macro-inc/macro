use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolResult};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::ToolServiceContext;

#[derive(Debug, Serialize, JsonSchema)]
pub struct DisplayResultsResponse {
    pub message: String,
}

/// `displayResults` is intentionally a thin pass-through tool: the model emits
/// a dynamic-UI "view" as the `view` argument, the FRONTEND renders that view
/// from the tool call arguments (using the dynamic-ui component library), and the
/// backend does no work — it just acknowledges so the model can continue.
///
/// The input is arbitrary JSON (`view`) because the dynamic-UI schema is owned by
/// the frontend (a Zod schema) and conveyed to the model out-of-band rather than
/// duplicated here in Rust.
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "DisplayResults",
    description = "Present results to the user as a rich view. The `view` argument is a dynamic-UI view object (a title plus an ordered list of widgets) following the dynamic-UI schema provided to you. The view is rendered immediately in the chat; this tool returns as soon as it is dispatched."
)]
pub struct DisplayResults {
    // The frontend renders the view from the tool-call arguments; the backend
    // never reads it (hence allow(dead_code)).
    #[allow(dead_code)]
    #[schemars(
        description = "The dynamic-UI view to render: an object with an optional `title` and a `widgets` array, per the provided dynamic-UI schema."
    )]
    pub view: serde_json::Value,
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
