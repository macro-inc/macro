//! The report on a workspace import: what the current plan holds and how far
//! writing it got.

use std::collections::HashMap;

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
) -> NotionImportReport {
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
    let current: Vec<&(&ImportEntity, NotionDocMeta)> = planned
        .iter()
        .filter(|(row, _)| match review_id {
            Some(review) => {
                row.review_id == Some(review)
                    || (row.review_id.is_none() && row.status == ImportStatus::Staged)
            }
            None => true,
        })
        .collect();

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
        let Some(plan) = &meta.plan else { continue };
        match row.kind {
            ImportKind::DataSource => report.data_sources += 1,
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
    let mut importers: Vec<NotionImporter> = importers
        .into_iter()
        .map(|(by, count)| NotionImporter {
            by: by.to_string(),
            count,
        })
        .collect();
    importers.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.by.cmp(&b.by)));
    report.already_imported_by = importers;
    report
}
