//! A user tool is a tool that's executed by a user instead of an agent loop
//! A user tool transforms a `T: AsyncTool<Context>::call(..) -> R` into `T: AsyncTool<Context>::call(..) -> Defer`
//! A user execues a tool T by posting to /tools/call/{:tool_id} with body appliction/json T
//! User tools are _opaque_ to the tool loop. IE it will call the `call` method like it would
//! for any other tool, but the call method won't trigger execution
use crate::{AsyncTool, ToolResult};
use crate::{RequestContext, ServiceContext};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// User tool wrapper type that implements stubs [`AsyncTool`]
#[derive(Serialize, Deserialize)]
#[serde(transparent)]
pub struct UserTool<T>(pub T);

impl<T: JsonSchema> JsonSchema for UserTool<T> {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        T::schema_name()
    }
    fn json_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
        T::json_schema(generator)
    }
}

/// User tools are pending until a user executes them
#[derive(Serialize, Deserialize, JsonSchema, ToSchema, Debug, Clone, PartialEq)]
pub enum UserToolResponse<T> {
    /// Tool has not yet been executed
    PendingUserExecution,
    /// User rejected suggested tool execution
    Rejected,
    /// Tool is executed and has whatever return type the wrapped tool returns
    UserAction(T),
}

#[async_trait]
impl<T, Context> AsyncTool<Context> for UserTool<T>
where
    T: AsyncTool<Context>,
    T: Send + Sync + 'static + for<'de> Deserialize<'de>,
    Context: Send + Sync + 'static,
{
    type Output = UserToolResponse<T::Output>;

    /// Calling a user tool doesn't do anything
    async fn call(
        &self,
        _service_context: ServiceContext<Context>,
        _request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        ToolResult::Ok(UserToolResponse::PendingUserExecution)
    }
}
