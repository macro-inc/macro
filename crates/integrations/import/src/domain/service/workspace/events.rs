//! Telling the agent session that presented a plan's review what became of
//! it: `import.planned` once the plan is ready to approve, and
//! `review.settled` with the final report once its write ends, however it
//! ended.
//!
//! Each event is produced in the transaction that moves the run (see
//! [`NotionRunRepo::transition_reviewed_run`]), so the session hears of every
//! change exactly when it happens, from whichever process made it.

use agent_runtime_protocol::domain::notification::{
    ImportItem, ImportOutcome, ImportPlan, ImportSettlement, ImportWorkspace, MAX_IMPORT_ITEMS,
    NotificationEvent, ReviewSettlement,
};
use agent_session::domain::notifications::{PendingNotification, ProduceNotification};
use import_notion::domain::ports::NotionConnections;
use macro_user_id::user_id::MacroUserIdStr;
use mcp_select::ConnectorSelect;
use uuid::Uuid;

use super::super::ImportServiceImpl;
use super::super::notion_workspace::report;
use crate::domain::models::{
    ImportSource, NotionImportReport, NotionReportItem, ReviewedRun, RunStatus,
};
use crate::domain::ports::{
    CanonicalImportRepo, EntityCreator, ImportRepo, NotionPlanRepo, NotionRunRepo, Result,
    SlackWorkspaceSource, WorkspaceWriter, WrittenObjects,
};

/// Longest title, error or reason a settlement carries, in characters.
const MAX_TEXT_CHARS: usize = 300;

impl<R, S, C, W, N> ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + NotionPlanRepo + NotionRunRepo + WrittenObjects + Clone,
    S: ConnectorSelect,
    C: EntityCreator + WorkspaceWriter,
    W: SlackWorkspaceSource,
    N: NotionConnections,
{
    /// End the user's write: move the run from `importing` to `to` (a
    /// cancelled run stays `dismissed`) and tell the session presenting its
    /// review how it went. Returns whether the run moved.
    pub(in crate::domain::service) async fn end_write(
        &self,
        user: &MacroUserIdStr<'static>,
        to: RunStatus,
        error: Option<&str>,
    ) -> Result<bool> {
        // Read before the run moves: once it has, the rows still claimed go
        // back to staged and no longer say they were part of this write.
        let report = self.current_report(user).await?;
        let root_folder = self.repo.root_folder(user).await?;
        let source = self.workspace_source;
        let moved = self
            .repo
            .transition_reviewed_run(
                user,
                &[RunStatus::Importing, RunStatus::Dismissed],
                to,
                error,
                |run| {
                    let review = run.review?;
                    let settlement = settlement(source, &report, root_folder, run)?;
                    produce(ProduceNotification {
                        session_id: review.session_id,
                        subject_id: review.review_id.to_string(),
                        event: NotificationEvent::ReviewSettled(ReviewSettlement::Import {
                            import: settlement,
                        }),
                        dedupe_key: None,
                        wake: true,
                    })
                },
            )
            .await?;
        Ok(moved.is_some())
    }

    /// Finish planning: move the run from `running` to `to` and, once the
    /// plan is ready, tell the session presenting its review. Returns
    /// whether the run moved.
    pub(in crate::domain::service) async fn end_plan(
        &self,
        user: &MacroUserIdStr<'static>,
        to: RunStatus,
        error: Option<&str>,
    ) -> Result<bool> {
        let report = self.current_report(user).await?;
        let source = self.workspace_source;
        let moved = self
            .repo
            .transition_reviewed_run(user, &[RunStatus::Running], to, error, |run| {
                let review = run.review?;
                if run.status != RunStatus::Ready {
                    return None;
                }
                produce(ProduceNotification {
                    session_id: review.session_id,
                    subject_id: review.review_id.to_string(),
                    event: NotificationEvent::ImportPlanned(plan(source, &report)?),
                    dedupe_key: None,
                    wake: true,
                })
            })
            .await?;
        Ok(moved.is_some())
    }

    /// The report on the user's current plan as the ledger has it now,
    /// without adopting or settling anything.
    pub(in crate::domain::service) async fn current_report(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<NotionImportReport> {
        let run = self
            .repo
            .list_runs(user)
            .await?
            .into_iter()
            .find(|run| run.source == self.workspace_source);
        let rows = self
            .repo
            .list(user, Some(self.workspace_source), None)
            .await?;
        let mut report = report(run.as_ref(), &rows);
        report.on_team = self.repo.user_team_id(user).await?.is_some();
        Ok(report)
    }
}

/// Validate an event and capture the producing span; a malformed event is
/// dropped rather than holding the run in its old state.
fn produce(input: ProduceNotification) -> Option<PendingNotification> {
    PendingNotification::new(input)
        .inspect_err(|error| tracing::warn!(error = ?error, "could not produce an import event"))
        .ok()
}

/// The workspace a `source` import reads; `None` for Slack, which has no
/// reviewed workspace run.
fn workspace(source: ImportSource) -> Option<ImportWorkspace> {
    match source {
        ImportSource::Notion => Some(ImportWorkspace::Notion),
        ImportSource::Linear => Some(ImportWorkspace::Linear),
        ImportSource::Jira => Some(ImportWorkspace::Jira),
        ImportSource::Slack => None,
    }
}

/// What the plan in `report` proposes.
fn plan(source: ImportSource, report: &NotionImportReport) -> Option<ImportPlan> {
    Some(ImportPlan {
        source: workspace(source)?,
        copy: report.copy,
        task_lists: report.tasks,
        skipped: report.skip,
        by_hand: report.hand,
    })
}

/// The final report of the write `report` describes, now that `run` ended
/// it; `None` while the run has not ended.
fn settlement(
    source: ImportSource,
    report: &NotionImportReport,
    root_folder: Option<Uuid>,
    run: &ReviewedRun,
) -> Option<ImportSettlement> {
    let outcome = match run.status {
        RunStatus::Completed => ImportOutcome::Completed,
        RunStatus::Failed => ImportOutcome::Failed,
        RunStatus::Dismissed => ImportOutcome::Cancelled,
        RunStatus::Running | RunStatus::Ready | RunStatus::Importing => return None,
    };
    Some(ImportSettlement {
        source: workspace(source)?,
        outcome,
        error: run.error.as_deref().map(bounded),
        imported: report.imported,
        planned: report.copy + report.tasks,
        documents: report.documents,
        databases: report.databases,
        database_rows: report.database_rows,
        task_lists: report.tasks,
        task_rows: report.task_rows,
        skipped: report.skip,
        not_written: report.waiting + report.writing,
        shared_with_team: report.shared_with_team,
        already_in_macro: report.already_in_macro,
        waiting_on_teammates: report.waiting_on_teammates,
        root_folder_id: root_folder,
        failures: items(&report.failures),
        hand_items: items(&report.hand_items),
    })
}

fn items(items: &[NotionReportItem]) -> Vec<ImportItem> {
    items
        .iter()
        .take(MAX_IMPORT_ITEMS)
        .map(|item| ImportItem {
            title: bounded(&item.title),
            url: item.url.clone(),
            reason: item.reason.as_deref().map(bounded),
        })
        .collect()
}

fn bounded(text: &str) -> String {
    let mut chars = text.chars();
    let mut bounded: String = chars.by_ref().take(MAX_TEXT_CHARS).collect();
    if chars.next().is_some() {
        bounded.push('…');
    }
    bounded
}
