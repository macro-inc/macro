//! Convert each body against destinations that already exist.

use import_notion::domain::databases::{DatabaseLoss, ReadFailure};
use import_notion::domain::macro_cells::derived_id;
use models_databases::views::ViewId;

use super::super::write::Progress;
use super::*;
use crate::domain::models::{
    ImportNotice, ImportNoticeKind, ReferenceLossReason, SourceLossDetail, SourceLossFact,
};
use crate::domain::ports::{
    NotionDatabaseFallback, NotionDatabaseOccurrence, NotionDatabaseTarget, WrittenObjects,
};

/// Resolve one page-local occurrence map, recording every fallback before conversion.
#[tracing::instrument(name = "notion.database_occurrence_links", skip_all, fields(page_id = %page, occurrences = tracing::field::Empty, unresolved = tracing::field::Empty), err)]
pub(in super::super) async fn body_links<Api: NotionApi, Store: WrittenObjects>(
    api: &Api,
    page: &NotionId,
    destinations: &DatabaseDestinations,
    progress: &Progress<'_, Store>,
) -> anyhow::Result<(String, Vec<NotionDatabaseOccurrence>)> {
    let resolved = resolve_page(api, page).await?;
    let mut warnings = resolved.warnings;
    let reference = |occurrence: &import_notion::domain::databases::DatabaseOccurrence, reason| {
        progress.loss(SourceLossFact {
            object: page.clone(),
            detail: SourceLossDetail::Reference {
                container: occurrence.key.as_ref().map(|key| key.container_id.clone()),
                ordinal: occurrence
                    .key
                    .as_ref()
                    .map_or(occurrence.range.start, |key| key.ordinal),
                title: occurrence.title.clone(),
                reason,
            },
        })
    };
    let mut databases = Vec::new();
    let mut unresolved = 0i64;
    for occurrence in &resolved.body.occurrences {
        for loss in &occurrence.losses {
            warnings.push(ImportNotice::new(
                occurrence
                    .key
                    .as_ref()
                    .map(|key| &key.container_id)
                    .unwrap_or(page),
                &occurrence.title,
                ImportNoticeKind::DatabaseOccurrence { loss: loss.clone() },
            ));
        }
        let Some(key) = &occurrence.key else {
            reference(occurrence, ReferenceLossReason::Unresolved)?;
            unresolved += 1;
            warnings.push(ImportNotice::new(
                page,
                &occurrence.title,
                ImportNoticeKind::MissingContainerIdentity,
            ));
            continue;
        };
        let fallback = |reason| NotionDatabaseTarget::Fallback(reason);
        let failure = resolved
            .unavailable
            .get(&key.container_id)
            .copied()
            .or_else(|| {
                occurrence.losses.iter().find_map(|loss| match loss {
                    DatabaseLoss::ContainerUnavailable { reason } => Some(*reason),
                    _ => None,
                })
            });
        let uniquely_identified =
            (occurrence.sources.len() == 1).then(|| &occurrence.sources[0].id);
        let ready_without_views = uniquely_identified
            .and_then(|id| destinations.get(id))
            .is_some_and(|destination| matches!(destination, DatabaseDestination::Ready(_)));
        let target = if let Some(reason) = failure.filter(|_| !ready_without_views) {
            fallback(fallback_reason(reason))
        } else {
            let tabs = resolved.views.get(&key.container_id);
            let selected_tab = match &occurrence.view_id {
                Some(id) => tabs.and_then(|tabs| tabs.iter().find(|tab| tab.id() == id)),
                None => tabs.and_then(|tabs| tabs.first()),
            };
            let selected = selected_tab
                .and_then(ViewTab::view)
                .filter(|view| view.parent.database_id == key.container_id);
            let source = selected
                .and_then(|view| view.data_source_id.as_ref())
                .or_else(|| {
                    if selected.is_none() {
                        uniquely_identified
                    } else {
                        None
                    }
                });
            match source.and_then(|source| destinations.get(source)) {
                Some(DatabaseDestination::Ready(destination)) => {
                    let mut view_id = selected.map(|view| {
                        ViewId::from_uuid(derived_id(
                            destination.database_id,
                            &format!("view/{}", view.id),
                        ))
                    });
                    if view_id.is_some_and(|id| !destination.views.contains(&id))
                        || selected.is_none()
                        || failure.is_some()
                    {
                        reference(occurrence, ReferenceLossReason::DefaultView)?;
                        view_id = None;
                    } else if occurrence.view_id.is_none()
                        && tabs.is_some_and(|tabs| tabs.len() > 1)
                        && let Some(view) = selected
                    {
                        warnings.push(ImportNotice::new(
                            &key.container_id,
                            &occurrence.title,
                            ImportNoticeKind::TabChosen {
                                view_id: view.id.clone(),
                                view: view.name.clone(),
                            },
                        ));
                    }
                    NotionDatabaseTarget::Resolved {
                        database_id: destination.database_id,
                        table_id: destination.table,
                        view_id,
                    }
                }
                Some(DatabaseDestination::Fallback(reason)) => fallback(*reason),
                None => {
                    let unavailable = occurrence.losses.iter().find_map(|loss| match loss {
                        DatabaseLoss::SourceUnavailable { source_id, reason }
                            if source == Some(source_id) =>
                        {
                            Some(*reason)
                        }
                        _ => None,
                    });
                    if let Some(reason) = unavailable {
                        fallback(fallback_reason(reason))
                    } else if source.is_some() {
                        fallback(NotionDatabaseFallback::NotImported)
                    } else {
                        fallback(NotionDatabaseFallback::Unresolved)
                    }
                }
            }
        };
        if let NotionDatabaseTarget::Fallback(reason) = &target {
            unresolved += 1;
            let reason = match reason {
                NotionDatabaseFallback::NotImported => {
                    let reviewed = occurrence
                        .sources
                        .iter()
                        .any(|source| destinations.contains_key(&source.id));
                    if reviewed {
                        ReferenceLossReason::NotImported
                    } else {
                        ReferenceLossReason::NotReviewed
                    }
                }
                NotionDatabaseFallback::NoAccess => ReferenceLossReason::NoAccess,
                NotionDatabaseFallback::NotFound => ReferenceLossReason::NotFound,
                NotionDatabaseFallback::Unresolved => ReferenceLossReason::Unresolved,
            };
            reference(occurrence, reason)?;
        }
        databases.push(NotionDatabaseOccurrence {
            container_id: key.container_id.clone(),
            ordinal: key.ordinal,
            target,
        });
    }
    let mut markdown = resolved.body.markdown;
    // Reader-provided ranges identify only actual database tags. A missing id
    // still gets a usable link to its containing page at that exact position.
    for occurrence in resolved
        .body
        .occurrences
        .iter()
        .rev()
        .filter(|occurrence| occurrence.key.is_none())
    {
        let label = occurrence
            .title
            .replace('\\', "\\\\")
            .replace('[', "\\[")
            .replace(']', "\\]")
            .replace(['\n', '\r'], " ");
        markdown.replace_range(
            occurrence.range.clone(),
            &format!("[{label}]({})", occurrence.fallback_url(page)),
        );
    }
    for notice in warnings {
        progress.loss(SourceLossFact {
            object: page.clone(),
            detail: SourceLossDetail::Notice { notice },
        })?;
    }
    tracing::Span::current().record("occurrences", databases.len() as i64);
    tracing::Span::current().record("unresolved", unresolved);
    Ok((markdown, databases))
}

fn fallback_reason(reason: ReadFailure) -> NotionDatabaseFallback {
    match reason {
        ReadFailure::Forbidden => NotionDatabaseFallback::NoAccess,
        ReadFailure::NotFound | ReadFailure::Trashed => NotionDatabaseFallback::NotFound,
        ReadFailure::InvalidObject | ReadFailure::TemporarilyUnavailable => {
            NotionDatabaseFallback::Unresolved
        }
    }
}
