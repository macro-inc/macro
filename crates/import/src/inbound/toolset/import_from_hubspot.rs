//! The HubSpot CRM import tool.
use super::{ImportToolContext, NotionImportAction, import_error, tool_error};
use crate::domain::{
    models::{HubspotReport, ImportSource, NotionImportReport, RunStatus},
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

/// Plan, inspect or cancel a read-only HubSpot CRM import.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ImportFromHubspot",
    description = "Import a connected HubSpot portal into the team's Macro CRM: deal pipelines become Sales pipelines with their stages, companies and contacts become CRM records, and deals become pipeline entries with stage, outcome, amount, close date and owner. Plan reads every company, contact and deal through the user's connected HubSpot account; nothing is written to HubSpot. Records belong to the team, so there is no sharing question. Present the plan immediately with PresentReview kind import, drafts [{source: hubspot}], even while it is running. Do not poll status or recreate records with other tools. Nothing is written until approval. Once the plan is ready, ask Should I kick it off? If the user says yes, approve it with DecideReview (a submit decision) using the review id. While it is still being planned, do not ask or approve: the user approves it on the card once it is ready. Status reports progress; cancel stops this import and keeps records already written."
)]
pub struct ImportFromHubspot {
    /// Plan, status or cancel.
    pub action: NotionImportAction,
}

/// Where a HubSpot import stands and what the agent should do next.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HubspotImportResponse {
    /// Ledger report with HubSpot counts, owners and losses.
    pub report: NotionImportReport,
    /// Guidance on presenting or approving the current plan.
    pub message: String,
}

impl ToolAnnotated for ImportFromHubspot {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::additive("Import from HubSpot").with_open_world();
}

#[async_trait]
impl<T: WorkspaceImporter> AsyncTool<ImportToolContext<T>> for ImportFromHubspot {
    type Output = HubspotImportResponse;

    #[tracing::instrument(skip_all, fields(action = ?self.action), err)]
    async fn call(
        &self,
        context: ServiceContext<ImportToolContext<T>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let service = context.require_service()?;
        let user = &request.user_id;
        let source = ImportSource::Hubspot;
        let report = match self.action {
            NotionImportAction::Plan => {
                service
                    .prepare_workspace_import(user, source, None, Duration::from_secs(5))
                    .await
            }
            NotionImportAction::Status => service.workspace_import_report(user, source).await,
            NotionImportAction::Cancel => match service.cancel_workspace_import(user, source).await {
                Ok(_) => service.workspace_import_report(user, source).await,
                Err(error) => Err(error),
            },
        }
        .map_err(|error| match error {
            ImportError::CrmAccessRequired => tool_error(
                "Importing into the CRM needs a team whose CRM the user may use. Tell them to join a team or ask an admin for CRM access.".into(),
                error,
            ),
            ImportError::Hubspot(import_hubspot::domain::HubspotError::NotConnected) => tool_error(
                "HubSpot is not connected. Ask the user to connect HubSpot, then plan again."
                    .into(),
                error,
            ),
            other => import_error("HubSpot import failed", other),
        })?;
        let message = message(self.action, &report);
        Ok(HubspotImportResponse { report, message })
    }
}

fn counts(hubspot: Option<&HubspotReport>) -> String {
    let Some(hubspot) = hubspot else {
        return "no records".into();
    };
    format!(
        "{} pipelines, {} companies, {} contacts and {} deals; {} of {} owners match team members",
        hubspot.pipelines,
        hubspot.companies,
        hubspot.contacts,
        hubspot.deals,
        hubspot.owners_matched,
        hubspot.owners
    )
}

fn message(action: NotionImportAction, report: &NotionImportReport) -> String {
    let present = "PresentReview (kind \"import\", title \"Import from HubSpot\", drafts [{\"source\":\"hubspot\"}])";
    match (action, report.status) {
        (NotionImportAction::Cancel, _) => format!(
            "The HubSpot import is stopped. {} records already written stay in the CRM.",
            report.imported
        ),
        (_, Some(RunStatus::Running)) => format!(
            "Reading HubSpot in the background. Present the review now with {present}; it fills in as planning runs, and the user can approve it on the card once it is ready. Do not wait or poll status. Do not offer to start it once it is ready, and do not call DecideReview while it is still being planned: a yes now cannot approve a plan that does not exist yet, and nothing acts on it later. If they ask you to start it before it is ready, tell them it is still being planned and that they approve it on the card, or ask you again, once it is ready."
        ),
        (_, Some(RunStatus::Ready)) => format!(
            "The HubSpot plan has {}; {} skipped, {} already in Macro. Present it with {present} if not presented yet. Nothing is written until approval. Ask \"Should I kick it off?\"; if they say yes, approve it with DecideReview (a submit decision).",
            counts(report.hubspot.as_ref()),
            report.skip,
            report.already_in_macro
        ),
        (_, Some(RunStatus::Importing)) => format!(
            "Importing HubSpot: {} written, {} being written, {} waiting on teammates. The presenting session receives review.settled when it ends.",
            report.imported, report.writing, report.waiting_on_teammates
        ),
        (_, Some(RunStatus::Completed)) => format!(
            "The HubSpot import finished: {} records written; {} failed.{}",
            report.imported,
            report.failures.len(),
            report
                .error
                .as_ref()
                .map(|error| format!(" {error}"))
                .unwrap_or_default()
        ),
        (_, Some(RunStatus::Failed)) => format!(
            "The HubSpot import failed: {}. Fix the cause and plan again.",
            report.error.as_deref().unwrap_or("unknown error")
        ),
        (_, Some(RunStatus::Dismissed)) => "The HubSpot import was cancelled.".into(),
        (_, None) => "No HubSpot plan yet. Use action plan.".into(),
    }
}

#[cfg(test)]
mod test;
