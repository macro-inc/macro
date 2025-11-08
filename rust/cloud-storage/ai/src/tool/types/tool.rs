use async_trait::async_trait;
use serde::Serialize;

pub type ToolResult<T> = std::result::Result<T, ToolCallError>;

#[derive(Debug)]
pub struct ToolCallError {
    pub internal_error: anyhow::Error,
    pub description: String,
}

impl std::fmt::Display for ToolCallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "description: {}. error: {}",
            self.description, self.internal_error
        )
    }
}

pub trait Tool<Sc, Rc>: Sync + Send {
    type Output: Serialize + 'static;
    fn call(&self, service_context: Sc, request_context: Rc) -> ToolResult<Self::Output>;
}

#[async_trait]
pub trait AsyncTool<Sc, Rc>: Sync + Send {
    type Output: Serialize + 'static;
    async fn call(&self, service_context: Sc, request_context: Rc) -> ToolResult<Self::Output>;
}

pub struct NoContext();
