//! Project durable fidelity facts into the review card's typed details.

use std::collections::{BTreeMap, BTreeSet};

use import_notion::domain::model::NotionId;
use import_notion::domain::views::{ViewLossKind, ViewSetting, ViewType};

use super::REPORT_LIST_LIMIT;
use crate::domain::models::{
    FidelityWarning, ImportKind, ImportNotice, ImportNoticeKind, NotionChangedView,
    NotionDatabaseViewChanges, NotionReportDetails, NotionReportNote, NotionReportNoteCount,
    NotionReportNoteKind, NotionReviewOmission, NotionReviewOmissionCount,
    NotionReviewOmissionKind, NotionTabChoice, NotionViewChange, NotionViewChangeKind, ViewWarning,
};

#[derive(Default)]
pub(super) struct Details {
    views: BTreeMap<NotionId, BTreeMap<NotionId, Vec<ViewWarning>>>,
    tabs: BTreeMap<(Option<NotionId>, NotionId, NotionId), NotionTabChoice>,
    omissions: BTreeMap<NotionReviewOmissionKind, NotionReviewOmissionCount>,
    notes: BTreeMap<NotionReportNoteKind, NotionReportNoteCount>,
    report: NotionReportDetails,
}

impl Details {
    pub fn warning(&mut self, warning: &FidelityWarning, rendered: &str) {
        let (kind, count) = match warning {
            FidelityWarning::ViewLoss(view) => {
                self.views
                    .entry(view.source_id.clone())
                    .or_default()
                    .entry(view.view_id.clone())
                    .or_default()
                    .push(view.clone());
                return;
            }
            FidelityWarning::Notice {
                notice:
                    ImportNotice {
                        object,
                        source,
                        kind:
                            ImportNoticeKind::TabChosen {
                                view_id,
                                view,
                                page_id,
                                container_title,
                            },
                    },
            } => {
                self.tabs
                    .entry((page_id.clone(), object.clone(), view_id.clone()))
                    .or_insert_with(|| NotionTabChoice {
                        container_id: object.to_string(),
                        container_title: container_title.clone(),
                        database: source.clone(),
                        tab: view.clone(),
                    });
                return;
            }
            FidelityWarning::UnmappedPeople { count, .. }
            | FidelityWarning::OmittedOptions { count, .. } => {
                (NotionReportNoteKind::Omitted, *count)
            }
            FidelityWarning::PropertyOmitted { .. } => (NotionReportNoteKind::Omitted, 1),
            FidelityWarning::PropertySnapshot { .. } => (NotionReportNoteKind::Snapshot, 1),
            FidelityWarning::References { count, .. } => (NotionReportNoteKind::Reference, *count),
            FidelityWarning::UnsupportedEntries {
                unsupported_entries,
            } => (NotionReportNoteKind::Other, *unsupported_entries),
            FidelityWarning::Notice { .. }
            | FidelityWarning::SourceStopped { .. }
            | FidelityWarning::Text(_) => (NotionReportNoteKind::Other, 1),
        };
        self.note(kind, count, rendered.to_owned());
    }

    pub fn other(&mut self, message: String) {
        self.note(NotionReportNoteKind::Other, 1, message);
    }

    fn note(&mut self, kind: NotionReportNoteKind, count: u32, message: String) {
        let total = self.notes.entry(kind).or_insert(NotionReportNoteCount {
            kind,
            lines: 0,
            count: 0,
        });
        total.lines += 1;
        total.count = total.count.saturating_add(count);
        if total.lines as usize <= REPORT_LIST_LIMIT {
            self.report.notes.push(NotionReportNote {
                kind,
                count,
                message,
            });
        }
    }

    pub fn omission(&mut self, omission: NotionReviewOmission) {
        let kind = omission.kind;
        let total = self
            .omissions
            .entry(kind)
            .or_insert(NotionReviewOmissionCount {
                kind,
                pages: 0,
                databases: 0,
                other: 0,
            });
        match omission.item.kind {
            ImportKind::Page => total.pages += 1,
            ImportKind::DataSource => total.databases += 1,
            _ => total.other += 1,
        }
        if (total.pages + total.databases + total.other) as usize <= REPORT_LIST_LIMIT {
            self.report.not_imported.push(omission);
        }
    }

    pub fn finish(mut self) -> NotionReportDetails {
        self.report.omission_counts = self.omissions.into_values().collect();
        self.report.note_counts = self.notes.into_values().collect();
        self.report.tab_choice_count = u32::try_from(self.tabs.len()).unwrap_or(u32::MAX);
        self.report.tab_choices = self.tabs.into_values().take(REPORT_LIST_LIMIT).collect();
        self.report.view_changes = self
            .views
            .into_iter()
            .filter_map(|(id, by_view)| {
                let title = by_view
                    .values()
                    .find_map(|warnings| warnings.first())?
                    .source
                    .clone();
                let mut views: Vec<_> = by_view
                    .into_iter()
                    .filter_map(|(view_id, mut warnings)| {
                        warnings.sort();
                        warnings.dedup();
                        let title = warnings.first()?.view.clone();
                        let changes = changes(warnings);
                        (!changes.is_empty()).then_some(NotionChangedView {
                            view_id: view_id.to_string(),
                            title,
                            changes,
                        })
                    })
                    .collect();
                views.sort_by(|a, b| {
                    first_change(a)
                        .cmp(&first_change(b))
                        .then_with(|| a.title.cmp(&b.title))
                });
                (!views.is_empty()).then_some(NotionDatabaseViewChanges {
                    database_id: id.to_string(),
                    title,
                    views,
                })
            })
            .collect();
        self.report.view_changes.sort_by(|a, b| {
            a.views
                .first()
                .and_then(first_change)
                .cmp(&b.views.first().and_then(first_change))
                .then_with(|| a.title.cmp(&b.title))
        });
        let views = self
            .report
            .view_changes
            .iter()
            .flat_map(|database| &database.views);
        self.report.view_count = u32::try_from(views.clone().count()).unwrap_or(u32::MAX);
        self.report.view_change_count =
            u32::try_from(views.map(|view| view.changes.len()).sum::<usize>()).unwrap_or(u32::MAX);
        // Give each view a line before including additional settings. The first
        // line is the most consequential change for that view.
        let mut remaining_views = REPORT_LIST_LIMIT;
        let mut remaining_details = REPORT_LIST_LIMIT;
        for database in &mut self.report.view_changes {
            database.views.truncate(remaining_views);
            remaining_views -= database.views.len();
            for view in &mut database.views {
                view.changes.truncate(1 + remaining_details);
                remaining_details -= view.changes.len().saturating_sub(1);
            }
        }
        self.report
            .view_changes
            .retain(|database| !database.views.is_empty());
        self.report
    }
}

fn first_change(view: &NotionChangedView) -> Option<NotionViewChangeKind> {
    view.changes.first().map(|change| change.kind)
}

fn changes(warnings: Vec<ViewWarning>) -> Vec<NotionViewChange> {
    let mut changes = Vec::new();
    let mut hidden = BTreeSet::new();
    let mut hidden_count = 0u32;
    for warning in warnings {
        let kind = match warning.kind {
            ViewLossKind::Filter | ViewLossKind::FilterIncludesBlankStatus => {
                NotionViewChangeKind::Filter
            }
            ViewLossKind::Layout => NotionViewChangeKind::Layout,
            ViewLossKind::Sort => NotionViewChangeKind::Sort,
            ViewLossKind::Setting => match warning.setting {
                ViewSetting::Grouping => NotionViewChangeKind::Layout,
                ViewSetting::ColumnVisibility | ViewSetting::HiddenColumn => {
                    NotionViewChangeKind::Visibility
                }
                _ => NotionViewChangeKind::Display,
            },
        };
        if warning.setting == ViewSetting::HiddenColumn
            && warning.layout == ViewType::Table
            && !warning.properties.is_empty()
        {
            hidden.extend(warning.properties);
            hidden_count = hidden_count.saturating_add(warning.count);
            continue;
        }
        let message = warning.detail();
        let mut characters = message.chars();
        let message = characters
            .next()
            .map(|first| first.to_uppercase().chain(characters).collect())
            .unwrap_or_default();
        changes.push(NotionViewChange {
            kind,
            count: warning.count,
            message,
        });
    }
    if hidden_count > 0 {
        changes.push(NotionViewChange {
            kind: NotionViewChangeKind::Visibility,
            count: hidden_count,
            message: format!(
                "Shown here, hidden in Notion: {}.",
                hidden.into_iter().collect::<Vec<_>>().join(", ")
            ),
        });
    }
    changes.sort_by_key(|change| change.kind);
    changes
}
