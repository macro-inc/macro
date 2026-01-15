use crate::ToolCallError;
use crate::{AsyncTool, Tool, ToolResult};

/// Wrapper that converts a synchronous tool's output to JSON.
///
/// This wraps a [`Tool`] and serializes its output to a [`serde_json::Value`].
pub struct JsonTool<Sc, Rc, O>(Box<dyn Tool<Sc, Rc, Output = O>>);

impl<Sc, Rc, O> JsonTool<Sc, Rc, O> {
    /// Creates a new `JsonTool` from a boxed tool.
    pub fn from_boxed<T>(t: Box<T>) -> Self
    where
        T: Tool<Sc, Rc, Output = O> + 'static,
        O: serde::Serialize,
    {
        Self(t)
    }
}

/// Wrapper that converts an asynchronous tool's output to JSON.
///
/// This wraps an [`AsyncTool`] and serializes its output to a [`serde_json::Value`].
pub struct JsonAsyncTool<Sc, Rc, O>(Box<dyn AsyncTool<Sc, Rc, Output = O>>);

impl<Sc, Rc, O> JsonAsyncTool<Sc, Rc, O> {
    /// Creates a new `JsonAsyncTool` from a boxed async tool.
    pub fn from_boxed<T>(t: Box<T>) -> Self
    where
        T: AsyncTool<Sc, Rc, Output = O> + 'static,
        O: serde::Serialize,
    {
        Self(t)
    }
}

impl<Sc, Rc, O> Tool<Sc, Rc> for JsonTool<Sc, Rc, O>
where
    O: serde::Serialize + 'static,
{
    type Output = serde_json::Value;
    fn call(&self, service_context: Sc, request_context: Rc) -> ToolResult<Self::Output> {
        self.0
            .call(service_context, request_context)
            .and_then(|out| {
                serde_json::to_value(out).map_err(|err| ToolCallError {
                    description: "An internal error occurred".to_string(),
                    internal_error: anyhow::Error::from(err),
                })
            })
    }
}

#[async_trait::async_trait]
impl<Sc, Rc, O> AsyncTool<Sc, Rc> for JsonAsyncTool<Sc, Rc, O>
where
    O: serde::Serialize + 'static,
    Sc: Send + Sync,
    Rc: Send + Sync,
{
    type Output = serde_json::Value;
    async fn call(
        &self,
        service_context: Sc,
        request_context: Rc,
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
