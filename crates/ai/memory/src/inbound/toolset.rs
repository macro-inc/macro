//! User-invoked explicit memory edits and authorized professional activity reads.
use crate::domain::{models::*, ports::ComposedMemoryRepo, service::MemoryServiceImpl};
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolCallError, ToolResult,
};
use chrono::NaiveDate;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub struct MemoryToolContext<R> {
    pub service: Arc<MemoryServiceImpl<R>>,
}
impl<R> Clone for MemoryToolContext<R> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

pub fn memory_toolset<R: ComposedMemoryRepo>() -> AsyncToolCollection<MemoryToolContext<R>> {
    AsyncToolCollection::new()
        .add_tool::<ReadMemory, MemoryToolContext<R>>()
        .add_tool::<UpdateMemory, MemoryToolContext<R>>()
        .add_tool::<GetUserActivity, MemoryToolContext<R>>()
}

#[derive(Deserialize, JsonSchema)]
#[schemars(
    title = "ReadMemory",
    description = "Read your private explicit memory and revision before a remember/forget edit. Content is one-based lines; use the returned revision for UpdateMemory. Generated activity and profiles are separate."
)]
pub struct ReadMemory {}
impl ToolAnnotated for ReadMemory {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read memory");
}
#[async_trait::async_trait]
impl<R: ComposedMemoryRepo> AsyncTool<MemoryToolContext<R>> for ReadMemory {
    type Output = ExplicitMemory;
    async fn call(
        &self,
        ctx: ServiceContext<MemoryToolContext<R>>,
        req: RequestContext,
    ) -> ToolResult<Self::Output> {
        ctx.service
            .explicit(&req.user_id)
            .await
            .map_err(memory_error)
    }
}

#[derive(Deserialize, JsonSchema)]
#[schemars(
    title = "UpdateMemory",
    description = "Change your private explicit memory only when you explicitly ask to remember, correct, or forget something. ReadMemory first. Never save inferred preferences automatically. Private/sensitive information is rejected. A stale revision makes no change: reread and reconcile before another edit."
)]
pub struct UpdateMemory {
    #[schemars(
        description = "The exact revision returned by ReadMemory or the last successful edit."
    )]
    pub revision: i64,
    pub edit: MemoryEdit,
}
impl ToolAnnotated for UpdateMemory {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Update memory").with_idempotent();
}
#[async_trait::async_trait]
impl<R: ComposedMemoryRepo> AsyncTool<MemoryToolContext<R>> for UpdateMemory {
    type Output = ExplicitMemory;
    async fn call(
        &self,
        ctx: ServiceContext<MemoryToolContext<R>>,
        req: RequestContext,
    ) -> ToolResult<Self::Output> {
        ctx.service
            .update_memory(req.user_id, self.revision, &self.edit)
            .await
            .map_err(memory_error)
    }
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "GetUserActivity",
    description = "Read privacy-reviewed professional activity for yourself or a current teammate. Reports use UTC calendar days, Monday-start weeks, and calendar months. Empty results mean no stored activity, not no work. At most 366 days per request."
)]
pub struct GetUserActivity {
    #[schemars(description = "A macro| user id, or omit for yourself.")]
    pub user_id: Option<String>,
    #[schemars(description = "Inclusive first UTC date (YYYY-MM-DD).")]
    pub start: NaiveDate,
    #[schemars(description = "Inclusive last UTC date (YYYY-MM-DD).")]
    pub end: NaiveDate,
}
impl ToolAnnotated for GetUserActivity {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Get user activity");
}
#[async_trait::async_trait]
impl<R: ComposedMemoryRepo> AsyncTool<MemoryToolContext<R>> for GetUserActivity {
    type Output = ActivityReports;
    async fn call(
        &self,
        ctx: ServiceContext<MemoryToolContext<R>>,
        req: RequestContext,
    ) -> ToolResult<Self::Output> {
        let user = match &self.user_id {
            Some(id) => {
                macro_user_id::user_id::MacroUserIdStr::try_from(id.clone()).map_err(|e| {
                    ToolCallError {
                        description: "Invalid Macro user id".into(),
                        internal_error: e.into(),
                    }
                })?
            }
            None => req.user_id.clone(),
        };
        ctx.service
            .get_user_activity(req.user_id, user, self.start, self.end)
            .await
            .map(|reports| ActivityReports { reports })
            .map_err(memory_error)
    }
}

#[derive(Serialize, JsonSchema)]
pub struct ActivityReports {
    pub reports: Vec<Activity>,
}

fn memory_error(error: crate::domain::MemoryError) -> ToolCallError {
    let description = match &error {
        crate::domain::MemoryError::Db(_)
        | crate::domain::MemoryError::Other(_)
        | crate::domain::MemoryError::AgentError(_) => {
            "Memory is temporarily unavailable".to_owned()
        }
        _ => error.to_string(),
    };
    ToolCallError {
        description,
        internal_error: error.into(),
    }
}
