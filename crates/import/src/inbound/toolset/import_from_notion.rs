//! The agent's one tool for importing a Notion workspace.

use std::time::Duration;

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use import_notion::domain::model::{ImportScope, NotionId};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{ImportToolContext, import_error, tool_error};
use crate::domain::models::{NotionImportReport, NotionSharing, RunStatus};
use crate::domain::ports::ImportError;
use crate::domain::service::NotionWorkspaceImporter;

#[cfg(test)]
mod test;

/// How long `plan` waits for planning before handing back a plan that is
/// still being made: long enough for a tiny workspace to come back ready,
/// short enough that the agent presents the review while it fills in.
const PLAN_WAIT: Duration = Duration::from_secs(5);

/// What the tool is asked to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum NotionImportAction {
    /// Read the workspace and plan the import, replacing any earlier plan.
    Plan,
    /// Report where planning or importing stands.
    Status,
    /// Stop planning or importing; what is already imported stays.
    Cancel,
}

/// Plan, check on, or cancel an import of the user's Notion workspace.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ImportFromNotion",
    description = "Import the user's Notion workspace (or part of it) into Macro: pages become documents in folders mirroring Notion's page tree, databases become Macro databases with their rows and relations, and task-tracker databases become Macro tasks. `plan` reads the workspace through the user's Notion connection, decides per page and database what to do (and, with `sharing` \"ai\", who sees it), links anything a teammate already imported and shared, and stages a plan without writing anything. Who sees the import: unless the user already said, call `plan` without `sharing` first. A user who is not on a team gets a personal import straight away; tell them so and do not offer team sharing. For a user on a team it answers that `sharing` is required: then ask them in one short question with three options (shared with their team, only them, or let AI decide per page), do not guess, and plan again with their answer. `plan` answers within seconds while planning goes on in the background: present the plan right away with PresentReview (kind \"import\", drafts [{\"source\":\"notion\"}]). The review fills in as Notion is read and each object is decided, and the user approves it there once it is ready; do not wait for planning or check `status` in a loop. Approving that review writes the plan; never import plan items with other tools. End your message after presenting it by asking \"Should I kick it off?\"; if the user says yes, approve it yourself with DecideReview, submitting the reviewId PresentReview returned. `status` reports progress; `cancel` stops planning or importing. Use this for anything bigger than a single page instead of ImportNotionPage."
)]
pub struct ImportFromNotion {
    /// What to do.
    pub action: NotionImportAction,
    /// For `plan`: Notion page or database URLs (or ids) to import, each
    /// with everything under it. Leave empty to plan everything the
    /// connection can see.
    #[serde(default)]
    pub roots: Vec<String>,
    /// For `plan`: who sees what the import writes, as the user answered
    /// when asked: `team` shares everything with their team, `personal`
    /// keeps everything visible only to them, `ai` lets the decision model
    /// choose per page. Leave it out for a user who is not on a team.
    #[serde(default)]
    pub sharing: Option<NotionSharing>,
}

/// The tool's answer.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportFromNotionResponse {
    /// Where the import stands.
    pub report: NotionImportReport,
    /// What happened and what to do next.
    pub message: String,
}

impl ToolAnnotated for ImportFromNotion {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::additive("Import from Notion").with_open_world();
}

#[async_trait]
impl<T: NotionWorkspaceImporter> AsyncTool<ImportToolContext<T>> for ImportFromNotion {
    type Output = ImportFromNotionResponse;

    #[tracing::instrument(skip_all, fields(user_id = %request_context.user_id, action = ?self.action, roots = self.roots.len(), sharing = ?self.sharing), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ImportToolContext<T>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let service = service_context.require_service()?;
        let user = request_context.user_id.clone();
        let report = match self.action {
            NotionImportAction::Plan => {
                let scope = scope(&self.roots)?;
                let planned = service.prepare_notion_import(&user, scope, self.sharing, PLAN_WAIT);
                tokio::select! {
                    report = planned => report,
                    // Planning carries on in the background; report where it is.
                    () = request_context.cancel.cancelled() => service.notion_import_report(&user).await,
                }
            }
            NotionImportAction::Status => service.notion_import_report(&user).await,
            NotionImportAction::Cancel => match service.cancel_notion_import(&user).await {
                Ok(_) => service.notion_import_report(&user).await,
                Err(error) => Err(error),
            },
        }
        .map_err(|error| match error {
            ImportError::NotionSharingRequired => tool_error(
                "The user is on a team, so `sharing` is required for `plan`. Ask them whether the import should be shared with their team, kept to themselves, or left to AI to decide per page, then plan again with their answer.".to_string(),
                error,
            ),
            ImportError::NotionNotConnected => tool_error(
                "Notion is not connected. Ask the user to connect Notion, then plan again."
                    .to_string(),
                error,
            ),
            other => import_error("Notion import failed", other),
        })?;
        let message = message(self.action, &report);
        Ok(ImportFromNotionResponse { report, message })
    }
}

fn scope(roots: &[String]) -> ToolResult<ImportScope> {
    if roots.iter().all(|root| root.trim().is_empty()) {
        return Ok(ImportScope::Everything);
    }
    let ids = roots
        .iter()
        .filter(|root| !root.trim().is_empty())
        .map(|root| {
            NotionId::parse(root).ok_or_else(|| {
                tool_error(
                    format!("`{root}` is not a Notion page or database URL or id."),
                    anyhow::anyhow!("unparseable Notion root"),
                )
            })
        })
        .collect::<ToolResult<Vec<_>>>()?;
    Ok(ImportScope::Roots { ids })
}

/// What the model should know and do next.
pub(super) fn message(action: NotionImportAction, report: &NotionImportReport) -> String {
    let planned = planned_summary(report);
    let already = already_in_macro(report);
    let hand = if report.hand_items.is_empty() {
        String::new()
    } else {
        format!(
            " Objects to handle by hand (with your own tools, after the import): {}.",
            report
                .hand_items
                .iter()
                .map(|item| match &item.reason {
                    Some(reason) => format!("\"{}\" ({reason})", item.title),
                    None => format!("\"{}\"", item.title),
                })
                .collect::<Vec<_>>()
                .join(", ")
        )
    };
    let personal = if report.on_team {
        ""
    } else {
        " The user is not on a team, so everything this import writes is visible only to them; do not offer to share it with a team."
    };
    let present = "PresentReview (kind \"import\", a short title such as \"Import from Notion\", drafts [{\"source\":\"notion\"}])";
    match (action, report.status) {
        (NotionImportAction::Cancel, _) => format!(
            "The Notion import is stopped. {} objects were already imported and stay in Macro.",
            report.imported
        ),
        (_, Some(RunStatus::Running)) => {
            let progress = planning_progress(report);
            match report.review_id {
                None => format!(
                    "Planning has started and goes on in the background{progress}.{personal} Present the plan now with {present} and tell the user in a sentence that the review fills in as Notion is read and each object is decided, and that they approve it there once it is ready. Do not wait for planning or check `status` in a loop. End your message by asking \"Should I kick it off once it's ready?\". If they say yes, approve it with DecideReview (a submit decision); while the plan is still being made it refuses, so tell them it is not ready yet and that they can say so again, or approve it on the card, once it is."
                ),
                Some(_) => format!(
                    "The plan is presented and still being made{progress}.{personal} The review fills in as planning goes, and the user approves it there once it is ready. Do not wait for planning or check `status` in a loop."
                ),
            }
        }
        (_, Some(RunStatus::Ready)) if report.review_id.is_none() => {
            let choose = if report.on_team {
                "; they can change who sees each object on the card"
            } else {
                ""
            };
            format!(
                "The plan is ready: {planned}.{already}{personal} Tell the user these numbers as they are, then present the plan now with {present}. Nothing is written until they approve it{choose}. End your message by asking \"Should I kick it off?\"; if they say yes, approve it with DecideReview (a submit decision).{hand}"
            )
        }
        (_, Some(RunStatus::Ready)) => {
            format!(
                "The plan ({planned}) is presented and waiting for the user's approval. If they tell you to go ahead, approve it with DecideReview (a submit decision).{already}{hand}"
            )
        }
        (_, Some(RunStatus::Importing)) => format!(
            "Importing: {} done, {} being written, {} waiting.{}",
            report.imported,
            report.writing,
            report.waiting,
            waiting_on_teammates(report)
        ),
        (_, Some(RunStatus::Completed)) => format!(
            "The import finished: {} objects imported{}.{}{hand}",
            report.imported,
            report
                .error
                .as_deref()
                .map(|error| format!(" ({error})"))
                .unwrap_or_default(),
            waiting_on_teammates(report)
        ),
        (_, Some(RunStatus::Failed)) => format!(
            "The Notion import failed: {}. Fix the cause and plan again.",
            report.error.as_deref().unwrap_or("unknown error")
        ),
        (_, Some(RunStatus::Dismissed)) => "The last Notion import was cancelled.".to_string(),
        (_, None) => "No Notion import has been planned yet. Use action `plan`.".to_string(),
    }
}

/// How far planning has got: what Notion has shown so far while it is read,
/// then how many staged objects the decision model has answered for.
fn planning_progress(report: &NotionImportReport) -> String {
    let staged = report.pages + report.data_sources;
    if staged > 0 {
        return format!(
            " ({} of {staged} objects decided so far)",
            staged.saturating_sub(report.deciding)
        );
    }
    report
        .scanned
        .map(|scanned| {
            format!(
                " ({} pages and {} databases found in Notion so far)",
                scanned.pages, scanned.data_sources
            )
        })
        .unwrap_or_default()
}

/// The plan in exact numbers, so the agent repeats what will really be
/// written rather than a count of top-level objects.
pub(super) fn planned_summary(report: &NotionImportReport) -> String {
    let mut parts = Vec::new();
    if report.documents > 0 {
        parts.push(format!("{} pages as documents", report.documents));
    }
    if report.databases > 0 {
        parts.push(format!(
            "{} databases with {} rows",
            report.databases, report.database_rows
        ));
    }
    if report.tasks > 0 {
        parts.push(format!(
            "{} task lists as {} tasks",
            report.tasks, report.task_rows
        ));
    }
    let writes = if parts.is_empty() {
        "nothing".to_string()
    } else {
        parts.join(", ")
    };
    let shared = if report.copy + report.tasks == 0 {
        String::new()
    } else if !report.on_team {
        "; all of it visible only to the user".to_string()
    } else {
        let personal = (report.copy + report.tasks).saturating_sub(report.shared_with_team);
        format!(
            "; {} of them shared with the user's team, {personal} visible only to the user",
            report.shared_with_team
        )
    };
    format!(
        "of the {} pages and {} databases Notion shared, it imports {writes}{shared}; {} skipped, {} to handle by hand",
        report.pages, report.data_sources, report.skip, report.hand
    )
}

/// What teammates already imported, by whom: these link to the teammates'
/// copies and are not imported again.
pub(super) fn already_in_macro(report: &NotionImportReport) -> String {
    if report.already_in_macro == 0 {
        return String::new();
    }
    let by = report
        .already_imported_by
        .iter()
        .map(|importer| format!("{} ({})", importer.by, importer.count))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        " {} more are already in Macro, imported and shared with the team by {by}; they link to those copies and are not imported again.",
        report.already_in_macro
    )
}

fn waiting_on_teammates(report: &NotionImportReport) -> String {
    if report.waiting_on_teammates == 0 {
        return String::new();
    }
    format!(
        " {} are being imported by a teammate at the same time and link to their copies once those are written.",
        report.waiting_on_teammates
    )
}
