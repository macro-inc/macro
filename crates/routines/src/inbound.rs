//! AI workflow tools. Request identity is supplied by the host, never by the model.
use crate::domain::{
    RoutineConfiguration, RoutineDetails, RoutineInfo, RoutineList, RoutineRunStarted,
    RoutineService,
};
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolCallError, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

/// Routine capability injected by each tool host; default is explicitly unavailable for test hosts.
#[derive(Clone, Default)]
pub struct RoutineToolContext {
    /// Owning-service client.
    pub service: Option<Arc<dyn RoutineService>>,
}
impl RoutineToolContext {
    fn service(&self) -> ToolResult<&dyn RoutineService> {
        self.service.as_deref().ok_or_else(|| {
            error(anyhow::anyhow!(
                "Routine tools are unavailable in this host."
            ))
        })
    }
}
fn error(error: anyhow::Error) -> ToolCallError {
    ToolCallError {
        description: error.to_string(),
        internal_error: error,
    }
}
/// Register the routine workflows for MCP, chats, and agents.
pub fn routine_toolset() -> AsyncToolCollection<RoutineToolContext> {
    AsyncToolCollection::new()
        .add_tool::<CreateRoutine, RoutineToolContext>()
        .add_tool::<ListRoutines, RoutineToolContext>()
        .add_tool::<ReadRoutine, RoutineToolContext>()
        .add_tool::<UpdateRoutine, RoutineToolContext>()
        .add_tool::<RunRoutine, RoutineToolContext>()
        .add_tool::<DeleteRoutine, RoutineToolContext>()
}
/// Schedule future work.
#[derive(Deserialize, JsonSchema)]
#[schemars(
    title = "CreateRoutine",
    description = include_str!("create_routine.md")
)]
pub struct CreateRoutine {
    /// Name, triggers and steps.
    #[serde(deserialize_with = "crate::domain::deserialize_configuration")]
    pub configuration: RoutineConfiguration,
}
impl ToolAnnotated for CreateRoutine {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Create routine");
}
#[async_trait]
impl AsyncTool<RoutineToolContext> for CreateRoutine {
    type Output = RoutineInfo;
    async fn call(
        &self,
        context: ServiceContext<RoutineToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .service()?
            .create(&request.user_id, &self.configuration)
            .await
            .map_err(error)
    }
}
/// Find existing routines before scheduling or editing.
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ListRoutines",
    description = "Find the authenticated user’s routines, including work delegated to other agents. Filter by name/instructions or enabled state. Returns up to 50 matches and the full count; narrow the query if truncated. Use ReadRoutine for history."
)]
pub struct ListRoutines {
    /// Optional text to match in the routine name or task.
    pub query: Option<String>,
    /// Optional active/paused filter.
    pub enabled: Option<bool>,
}
impl ToolAnnotated for ListRoutines {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("List routines");
}
#[async_trait]
impl AsyncTool<RoutineToolContext> for ListRoutines {
    type Output = RoutineList;
    async fn call(
        &self,
        context: ServiceContext<RoutineToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let query = self.query.as_deref().unwrap_or("").to_lowercase();
        let routines: Vec<_> = context
            .service()?
            .list(&request.user_id)
            .await
            .map_err(error)?
            .into_iter()
            .filter(|routine| {
                self.enabled
                    .is_none_or(|enabled| routine.enabled == enabled)
                    && (routine.name.to_lowercase().contains(&query)
                        || routine.task.to_string().to_lowercase().contains(&query))
            })
            .collect();
        Ok(RoutineList {
            total: routines.len(),
            routines: routines.into_iter().take(50).collect(),
        })
    }
}
/// Inspect settings and execution results.
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReadRoutine",
    description = "Read a routine owned by the authenticated user, including its saved configuration and recent run history. Reading a run transcript still requires its own access."
)]
pub struct ReadRoutine {
    /// Routine UUID from CreateRoutine or ListRoutines.
    pub routine_id: Uuid,
}
impl ToolAnnotated for ReadRoutine {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read routine");
}
#[async_trait]
impl AsyncTool<RoutineToolContext> for ReadRoutine {
    type Output = RoutineDetails;
    async fn call(
        &self,
        context: ServiceContext<RoutineToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .service()?
            .read(&request.user_id, self.routine_id)
            .await
            .map_err(error)
    }
}
/// Exactly one update intention avoids partially-applied configuration/activation changes.
#[derive(Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RoutineChange {
    /// Pause or resume without rewriting configuration.
    Enabled {
        /// New activation state.
        enabled: bool,
    },
    /// Replace the saved name, triggers and steps. Read first; activation is preserved.
    Configuration {
        /// Complete replacement configuration.
        #[serde(deserialize_with = "crate::domain::deserialize_configuration")]
        configuration: RoutineConfiguration,
    },
}
/// Edit or pause an owned routine.
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "UpdateRoutine",
    description = "Pause/resume or replace the configuration of a routine owned by the authenticated user. ReadRoutine first, then send the complete configuration (name, triggers and steps, as CreateRoutine describes them): it replaces the saved one. Routines saved before steps existed read back as a single agent step. Does not change ownership. A running routine can be paused but cannot be reconfigured until it finishes."
)]
pub struct UpdateRoutine {
    /// Routine UUID.
    pub routine_id: Uuid,
    /// One explicit change.
    pub change: RoutineChange,
}
impl ToolAnnotated for UpdateRoutine {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Update routine");
}
#[async_trait]
impl AsyncTool<RoutineToolContext> for UpdateRoutine {
    type Output = RoutineInfo;
    async fn call(
        &self,
        context: ServiceContext<RoutineToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let service = context.service()?;
        match &self.change {
            RoutineChange::Enabled { enabled } => {
                service
                    .set_enabled(&request.user_id, self.routine_id, *enabled)
                    .await
            }
            RoutineChange::Configuration { configuration } => {
                service
                    .update(&request.user_id, self.routine_id, configuration)
                    .await
            }
        }
        .map_err(error)
    }
}
/// Run an owned routine immediately.
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "RunRoutine",
    description = "Start a routine owned by the authenticated user now, outside its schedule, as Run Now in the app does. The run continues after this returns; check its result later with ReadRoutine. Fails if the routine is already running."
)]
pub struct RunRoutine {
    /// Routine UUID.
    pub routine_id: Uuid,
}
impl ToolAnnotated for RunRoutine {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Run routine");
}
#[async_trait]
impl AsyncTool<RoutineToolContext> for RunRoutine {
    type Output = RoutineRunStarted;
    async fn call(
        &self,
        context: ServiceContext<RoutineToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .service()?
            .run_now(&request.user_id, self.routine_id)
            .await
            .map_err(error)
    }
}
/// Delete an owned routine.
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "DeleteRoutine",
    description = "Permanently delete a routine owned by the authenticated user, stopping all future runs. This cannot be undone; to stop it temporarily, pause it with UpdateRoutine instead. Use only when the user explicitly asks to delete a routine."
)]
pub struct DeleteRoutine {
    /// Routine UUID.
    pub routine_id: Uuid,
}
/// The deleted routine.
#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeletedRoutine {
    /// Routine UUID.
    pub routine_id: Uuid,
}
impl ToolAnnotated for DeleteRoutine {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Delete routine").with_idempotent();
}
#[async_trait]
impl AsyncTool<RoutineToolContext> for DeleteRoutine {
    type Output = DeletedRoutine;
    async fn call(
        &self,
        context: ServiceContext<RoutineToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .service()?
            .delete(&request.user_id, self.routine_id)
            .await
            .map_err(error)?;
        Ok(DeletedRoutine {
            routine_id: self.routine_id,
        })
    }
}
