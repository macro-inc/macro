//! Workspace import tools for the two issue trackers.
use super::{ImportToolContext, NotionImportAction, import_error, tool_error};
use crate::domain::{
    models::{ImportSource, NotionImportReport, NotionSharing, RunStatus},
    ports::ImportError,
    service::WorkspaceImporter,
};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Plan, inspect or cancel a read-only Linear workspace import.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ImportFromLinear",
    description = "Import a Linear workspace into Macro: issues become tasks, and teams, projects and initiatives become Macro projects. Plan reads only through the user's connected Linear account; no source writes are possible. First plan without sharing unless the user already chose. If sharing is required, ask team, personal, or AI; users without a team get a personal import. Present the plan immediately with PresentReview kind import, drafts [{source: linear}], even while it is running. Do not poll status or recreate plan items with other tools. Nothing is written until approval. Ask Should I kick it off? If the user says yes, approve it with DecideReview (a submit decision) using the review id. Status reports progress; cancel stops this import and keeps completed copies."
)]
pub struct ImportFromLinear {
    /// Plan, status or cancel.
    pub action: NotionImportAction,
    /// The user's visibility choice: team, personal or AI. Ask if required.
    #[serde(default)]
    pub sharing: Option<NotionSharing>,
}

/// Plan, inspect or cancel a read-only Jira Cloud workspace import.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ImportFromJira",
    description = "Import Jira Cloud into Macro: issues become tasks, and projects and epics become Macro projects. Plan reads all sites visible through the user's connected Jira account; no source writes are possible. First plan without sharing unless the user already chose. If sharing is required, ask team, personal, or AI; users without a team get a personal import. Present the plan immediately with PresentReview kind import, drafts [{source: jira}], even while it is running. Do not poll status or recreate plan items with other tools. Nothing is written until approval. Ask Should I kick it off? If the user says yes, approve it with DecideReview (a submit decision) using the review id. Status reports progress; cancel stops this import and keeps completed copies."
)]
pub struct ImportFromJira {
    /// Plan, status or cancel.
    pub action: NotionImportAction,
    /// The user's visibility choice: team, personal or AI. Ask if required.
    #[serde(default)]
    pub sharing: Option<NotionSharing>,
}

/// Where a reviewed tracker import stands and what the agent should do next.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TrackerImportResponse {
    /// Ledger report and exact plan counts.
    pub report: NotionImportReport,
    /// Guidance on presenting or approving the current plan.
    pub message: String,
}

impl ToolAnnotated for ImportFromLinear {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::additive("Import from Linear").with_open_world();
}
impl ToolAnnotated for ImportFromJira {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::additive("Import from Jira").with_open_world();
}
#[async_trait]
impl<T: WorkspaceImporter> AsyncTool<ImportToolContext<T>> for ImportFromLinear {
    type Output = TrackerImportResponse;
    async fn call(
        &self,
        context: ServiceContext<ImportToolContext<T>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        call(
            context,
            request,
            ImportSource::Linear,
            self.action,
            self.sharing,
        )
        .await
    }
}
#[async_trait]
impl<T: WorkspaceImporter> AsyncTool<ImportToolContext<T>> for ImportFromJira {
    type Output = TrackerImportResponse;
    async fn call(
        &self,
        context: ServiceContext<ImportToolContext<T>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        call(
            context,
            request,
            ImportSource::Jira,
            self.action,
            self.sharing,
        )
        .await
    }
}

#[tracing::instrument(skip_all, fields(source = source.as_ref(), ?action), err)]
async fn call<T: WorkspaceImporter>(
    context: ServiceContext<ImportToolContext<T>>,
    request: RequestContext,
    source: ImportSource,
    action: NotionImportAction,
    sharing: Option<NotionSharing>,
) -> ToolResult<TrackerImportResponse> {
    let service = context.require_service()?;
    let user = &request.user_id;
    let report = match action {
        NotionImportAction::Plan => service.prepare_workspace_import(user, source, sharing, Duration::from_secs(5)).await,
        NotionImportAction::Status => service.workspace_import_report(user, source).await,
        NotionImportAction::Cancel => match service.cancel_workspace_import(user, source).await {
            Ok(_) => service.workspace_import_report(user, source).await,
            Err(error) => Err(error),
        },
    }.map_err(|error| match error {
        ImportError::NotionSharingRequired => tool_error("The user is on a team. Ask whether to share with their team, keep everything personal, or let AI choose per group, then plan with their answer.".into(), error),
        other => import_error(&format!("{} import failed", source.label()), other),
    })?;
    let message = message(source, action, &report);
    Ok(TrackerImportResponse { report, message })
}

fn message(
    source: ImportSource,
    action: NotionImportAction,
    report: &NotionImportReport,
) -> String {
    let name = source.label();
    let present = format!(
        "PresentReview (kind \"import\", title \"Import from {name}\", drafts [{{\"source\":\"{}\"}}])",
        source.as_ref()
    );
    let visibility = if report.on_team {
        "The owner can adjust sharing on the review card."
    } else {
        "The user is not on a team: everything is personal; do not offer team sharing."
    };
    match (action, report.status) {
        (NotionImportAction::Cancel, _) => format!(
            "The {name} import is stopped. {} copied objects stay in Macro.",
            report.imported
        ),
        (_, Some(RunStatus::Running)) => format!(
            "Planning {name} in the background. {visibility} Present the review now with {present}; it fills in as planning runs. Do not wait or poll status. Ask \"Should I kick it off once it's ready?\". If they say yes, approve it with DecideReview (a submit decision); it refuses until the plan is ready."
        ),
        (_, Some(RunStatus::Ready)) => format!(
            "The {name} plan has {} issues and {} groups: {} tasks and {} other copies; {} skipped, {} by hand, {} already in Macro. {visibility} Present it with {present} if not presented yet. Nothing is written until approval. Ask \"Should I kick it off?\"; if they say yes, approve it with DecideReview (a submit decision).",
            report.issues,
            report.projects,
            report.task_rows,
            report.copy,
            report.skip,
            report.hand,
            report.already_in_macro
        ),
        (_, Some(RunStatus::Importing)) => format!(
            "Importing {name}: {} copied, {} being written, {} waiting on teammates. The presenting session receives review.settled when it ends.",
            report.imported, report.writing, report.waiting_on_teammates
        ),
        (_, Some(RunStatus::Completed)) => format!(
            "The {name} import finished: {} objects copied; {} failed.{}",
            report.imported,
            report.failures.len(),
            report
                .error
                .as_ref()
                .map(|error| format!(" {error}"))
                .unwrap_or_default()
        ),
        (_, Some(RunStatus::Failed)) => format!(
            "The {name} import failed: {}. Fix the cause and plan again.",
            report.error.as_deref().unwrap_or("unknown error")
        ),
        (_, Some(RunStatus::Dismissed)) => format!("The {name} import was cancelled."),
        (_, None) => format!("No {name} plan yet. Use action plan."),
    }
}

#[cfg(test)]
mod test;
