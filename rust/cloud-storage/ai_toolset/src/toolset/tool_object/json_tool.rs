use crate::{AsyncTool, ToolResult};
use crate::{RequestContext, ServiceContext, ToolCallError};

/// Wrapper that converts an asynchronous tool's output to JSON.
/// This wraps an [`AsyncTool`] and serializes its output to a [`serde_json::Value`].
pub struct JsonAsyncTool<Context, O>(Box<dyn AsyncTool<Context, Output = O>>);

impl<Context, O> JsonAsyncTool<Context, O> {
    /// Creates a new `JsonAsyncTool` from a boxed async tool.
    pub fn from_boxed<T>(t: Box<T>) -> Self
    where
        T: AsyncTool<Context, Output = O> + 'static,
        O: serde::Serialize,
    {
        Self(t)
    }
}

#[async_trait::async_trait]
impl<Context, O> AsyncTool<Context> for JsonAsyncTool<Context, O>
where
    O: serde::Serialize + 'static,
    Context: Send + Sync,
{
    type Output = serde_json::Value;
    async fn call(
        &self,
        service_context: ServiceContext<Context>,
        request_context: RequestContext,
    ) -> ToolResult<serde_json::Value> {
        self.0
            .call(service_context, request_context)
            .await
            .and_then(|out| {
                serde_json::to_value(out).map_err(|err| ToolCallError {
                    description: "An internal error occurred".to_string(),
                    internal_error: anyhow::Error::from(err),
                })
            })
    }
}
