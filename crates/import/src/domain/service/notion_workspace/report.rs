//! The report on a workspace import: what the current plan holds and how far
//! writing it got.

use std::collections::HashMap;

use crate::domain::ports::{
    FolderSeparation, Result, TaskImportNoticeCount, TaskImportNoticeReason,
};

use crate::domain::models::{
    ImportEntity, ImportKind, ImportRun, ImportStatus, NotionDecision, NotionDocMeta,
    NotionImportReport, NotionImporter, NotionReportItem, RunStatus,
};

#[cfg(test)]
mod test;

/// Failures and by-hand items a report lists, at most.
const REPORT_LIST_LIMIT: usize = 50;

/// Summarize the ledger for the current plan: the rows tied to the newest
/// review, plus staged rows not yet tied to one. Objects a teammate already
/// imported are counted apart: they link to that copy, so they are neither
/// copies nor progress.
pub(in crate::domain::service) fn report(
    run: Option<&ImportRun>,
    rows: &[ImportEntity],
    notices: &[TaskImportNoticeCount],
) -> Result<NotionImportReport> {
    let CurrentPlan {
        review_id,
        items: current,
    } = current_plan(run, rows);

    let mut report = NotionImportReport {
        status: run.map(|run| run.status),
        error: run.and_then(|run| run.error.clone()),
        scanned: run
            .filter(|run| run.status == RunStatus::Running)
            .and_then(|run| run.scanned),
        review_id,
        ..NotionImportReport::default()
    };
    let mut importers: HashMap<&str, u32> = HashMap::new();
    for (row, meta) in &current {
        if let Some(warnings) = row
            .metadata
            .get("warnings")
            .and_then(serde_json::Value::as_array)
        {
            for warning in warnings.iter().filter_map(serde_json::Value::as_str) {
                if !report.warnings.iter().any(|existing| existing == warning) {
                    report.warnings.push(warning.to_string());
                }
            }
        }
        let Some(plan) = &meta.plan else { continue };
        if !plan.shared
            && row
                .metadata
                .get("personalFolderId")
                .and_then(serde_json::Value::as_str)
                .is_some()
        {
            report.warnings.push(format!(
                "{} was kept in Notion (personal) to avoid inherited folder sharing.",
                meta.title
            ));
        }

        let separation = row.metadata.get("separateFolder");
        let reason = match separation.and_then(|separation| separation.get("reason")) {
            Some(reason) => Some(serde_json::from_value::<FolderSeparation>(reason.clone())?),
            // Older records have only visibility. New writes always record the typed reason.
            None => match separation
                .and_then(|separation| separation.get("visibility"))
                .and_then(serde_json::Value::as_str)
            {
                Some("shared") => Some(FolderSeparation::SharedFromPersonal),
                Some("personal") => Some(FolderSeparation::PersonalFromShared),
                _ => None,
            },
        };
        match reason {
            Some(FolderSeparation::SharedAfterGrantRemoval) => {
                report.warnings.push(format!(
                    "{}: created a separate shared folder because the existing folder's sharing was removed.",
                    meta.title,
                ));
            }
            Some(FolderSeparation::SharedFromPersonal) => {
                report.warnings.push(format!(
                    "{}: created a separate shared folder because the existing one holds personal items.",
                    meta.title,
                ));
            }
            Some(FolderSeparation::PersonalFromShared) => {
                report.warnings.push(format!(
                    "{}: created a separate personal folder to keep it apart from the existing shared folder.",
                    meta.title,
                ));
            }
            None => {}
        }

        match row.kind {
            ImportKind::DataSource => report.data_sources += 1,
            ImportKind::Issue | ImportKind::JiraIssue => report.issues += 1,
            ImportKind::Project | ImportKind::JiraProject | ImportKind::JiraEpic => {
                report.projects += 1
            }
            _ => report.pages += 1,
        }
        if let Some(copy) = &plan.already_imported {
            report.already_in_macro += 1;
            *importers.entry(copy.by.as_str()).or_insert(0) += 1;
            continue;
        }
        let Some(decision) = plan.decision else {
            report.deciding += 1;
            continue;
        };
        let rows = plan.rows.unwrap_or(0);
        match (decision, row.kind) {
            (NotionDecision::Copy, ImportKind::Issue | ImportKind::JiraIssue) => {
                report.tasks += 1;
                report.task_rows += 1;
            }
            (
                NotionDecision::Copy,
                ImportKind::Project | ImportKind::JiraProject | ImportKind::JiraEpic,
            ) => {
                report.copy += 1;
            }
            (NotionDecision::Copy, ImportKind::DataSource) => {
                report.copy += 1;
                report.databases += 1;
                report.database_rows += rows;
            }
            (NotionDecision::Copy, _) => {
                report.copy += 1;
                report.documents += 1;
            }
            (NotionDecision::Tasks, _) => {
                report.tasks += 1;
                report.task_rows += rows;
            }
            (NotionDecision::Skip, _) => report.skip += 1,
            (NotionDecision::Hand, _) => report.hand += 1,
        }
        let written = matches!(decision, NotionDecision::Copy | NotionDecision::Tasks);
        if written && plan.shared && row.status != ImportStatus::Discarded {
            report.shared_with_team += 1;
        }
        let reported = || NotionReportItem {
            import_id: row.id,
            title: meta.title.clone(),
            kind: row.kind,
            url: meta.url.clone(),
            reason: plan.reason.clone(),
        };
        match row.status {
            ImportStatus::Imported => report.imported += 1,
            ImportStatus::Importing if row.waiting_on.is_some() => {
                report.waiting_on_teammates += 1;
            }
            ImportStatus::Importing => report.writing += 1,
            ImportStatus::Staged => {
                if decision == NotionDecision::Hand {
                    if report.hand_items.len() < REPORT_LIST_LIMIT {
                        report.hand_items.push(reported());
                    }
                } else if decision != NotionDecision::Skip {
                    report.waiting += 1;
                }
                if let Some(error) = &row.last_error
                    && report.failures.len() < REPORT_LIST_LIMIT
                {
                    report.failures.push(NotionReportItem {
                        reason: Some(error.clone()),
                        ..reported()
                    });
                }
            }
            ImportStatus::Discarded => {}
        }
    }
    let personal: std::collections::HashSet<_> = current
        .iter()
        .filter_map(|(row, meta)| {
            meta.plan
                .as_ref()
                .filter(|plan| !plan.shared)
                .map(|_| row.id)
        })
        .collect();
    let omitted: u64 = notices
        .iter()
        .filter(|notice| personal.contains(&notice.import_id))
        .map(|notice| match notice.reason {
            TaskImportNoticeReason::PersonalAssigneeOmitted => u64::from(notice.count),
        })
        .sum();
    if omitted > 0 {
        let assignees = if omitted == 1 {
            "assignee"
        } else {
            "assignees"
        };
        report.warnings.push(format!(
            "{omitted} teammate {assignees} omitted to keep tasks owner-only."
        ));
    }
    let mut importers: Vec<NotionImporter> = importers
        .into_iter()
        .map(|(by, count)| NotionImporter {
            by: by.to_string(),
            count,
        })
        .collect();
    importers.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.by.cmp(&b.by)));
    report.already_imported_by = importers;
    report.hubspot = super::super::hubspot_workspace::report(current.iter().map(|(row, _)| *row));
    Ok(report)
}

struct CurrentPlan<'a> {
    review_id: Option<uuid::Uuid>,
    items: Vec<(&'a ImportEntity, NotionDocMeta)>,
}

fn current_plan<'a>(run: Option<&ImportRun>, rows: &'a [ImportEntity]) -> CurrentPlan<'a> {
    let planned: Vec<(&ImportEntity, NotionDocMeta)> = rows
        .iter()
        .filter_map(|row| {
            let meta: NotionDocMeta = serde_json::from_value(row.metadata.clone()).ok()?;
            meta.plan.as_ref()?;
            Some((row, meta))
        })
        .collect();
    // A plan still being made is presented by the review its run records;
    // rows left from earlier plans belong to earlier reviews.
    let review_id = match run {
        Some(run) if run.status == RunStatus::Running => run.review_id,
        _ => planned
            .iter()
            .filter(|(row, _)| row.review_id.is_some())
            .max_by_key(|(row, _)| row.updated_at)
            .and_then(|(row, _)| row.review_id),
    };
    let current: Vec<(&ImportEntity, NotionDocMeta)> = planned
        .into_iter()
        .filter(|(row, _)| match review_id {
            Some(review) => {
                row.review_id == Some(review)
                    || (row.review_id.is_none() && row.status == ImportStatus::Staged)
            }
            None => true,
        })
        .collect();

    CurrentPlan {
        review_id,
        items: current,
    }
}

/// Read notice counts only for Personal items in the same review the report describes.
pub(in crate::domain::service) fn notice_import_ids(
    run: Option<&ImportRun>,
    rows: &[ImportEntity],
) -> Vec<uuid::Uuid> {
    current_plan(run, rows)
        .items
        .into_iter()
        .filter_map(|(row, meta)| meta.plan.filter(|plan| !plan.shared).map(|_| row.id))
        .collect()
}
