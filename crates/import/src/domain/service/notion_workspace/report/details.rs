//! Project durable fidelity facts into the review card's typed details.

use std::collections::{BTreeMap, BTreeSet};

use import_notion::domain::model::NotionId;
use import_notion::domain::views::{ViewLossKind, ViewSetting, ViewType};

use crate::domain::models::{
    FidelityWarning, ImportNotice, ImportNoticeKind, NotionChangedView, NotionDatabaseViewChanges,
    NotionReportDetails, NotionReportNote, NotionReportNoteKind, NotionTabChoice, NotionViewChange,
    NotionViewChangeKind, ViewWarning,
};

#[derive(Default)]
pub(super) struct Details {
    views: BTreeMap<NotionId, BTreeMap<NotionId, Vec<ViewWarning>>>,
    tabs: BTreeMap<(NotionId, NotionId), NotionTabChoice>,
    pub report: NotionReportDetails,
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
                        kind: ImportNoticeKind::TabChosen { view_id, view },
                    },
            } => {
                self.tabs
                    .entry((object.clone(), view_id.clone()))
                    .or_insert_with(|| NotionTabChoice {
                        container_id: object.to_string(),
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
        self.report.notes.push(NotionReportNote {
            kind,
            count,
            message: rendered.to_owned(),
        });
    }

    pub fn other(&mut self, message: String) {
        self.report.notes.push(NotionReportNote {
            kind: NotionReportNoteKind::Other,
            count: 1,
            message,
        });
    }

    pub fn finish(mut self) -> NotionReportDetails {
        self.report.tab_choices = self.tabs.into_values().collect();
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
