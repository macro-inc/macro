//! Resolve inline placements, preserving sources and container tab order.

use crate::domain::models::{ImportNotice, ImportNoticeKind};
use std::collections::{HashMap, HashSet};

use import_notion::domain::databases::{
    DatabaseLoss, OccurrenceSource, PageDatabases, ReadFailure, SourceOwnership,
    read_page_databases,
};
use import_notion::domain::model::NotionId;
use import_notion::domain::ports::{NotionApi, NotionError};
use import_notion::domain::views::{NotionView, ViewScope};

mod cache;
pub(super) use cache::CachedNotion;
pub(super) mod discovery;
pub(super) use discovery::discover;
mod body;
pub(super) use body::body_links;

#[cfg(test)]
mod test;

/// A source is either ready for cards or has an explicit resolution loss.
pub(super) enum DatabaseDestination {
    Ready(crate::domain::ports::ImportedDatabase),
    Fallback(crate::domain::ports::NotionDatabaseFallback),
}

pub(super) type DatabaseDestinations = HashMap<NotionId, DatabaseDestination>;

/// A tab keeps its listed position even when its detail endpoint is unavailable.
pub(super) enum ViewTab {
    Ready(Box<NotionView>),
    Unavailable { id: NotionId, reason: ReadFailure },
}
impl ViewTab {
    pub fn id(&self) -> &NotionId {
        match self {
            Self::Ready(view) => &view.id,
            Self::Unavailable { id, .. } => id,
        }
    }
    pub fn view(&self) -> Option<&NotionView> {
        match self {
            Self::Ready(view) => Some(view),
            Self::Unavailable { .. } => None,
        }
    }
}

/// A body with its container-local views, in Notion's tab order.
pub(super) struct ResolvedPage {
    pub body: PageDatabases,
    pub views: HashMap<NotionId, Vec<ViewTab>>,
    pub warnings: Vec<ImportNotice>,
    pub unavailable: HashMap<NotionId, ReadFailure>,
}

/// Read a standalone page or row body, then resolve linked and owned tabs.
#[tracing::instrument(name = "notion.database_resolution", skip_all, fields(page_id = %page, occurrences = tracing::field::Empty), err)]
pub(super) async fn resolve_page<Api: NotionApi>(
    api: &Api,
    page: &NotionId,
) -> Result<ResolvedPage, NotionError> {
    enrich(api, read_page_databases(api, page).await?).await
}

/// Enrich a body already read by dependency discovery without fetching it twice.
#[tracing::instrument(name = "notion.enrich_database_occurrences", skip_all, fields(page_id = %body.page_id, occurrences = tracing::field::Empty), err)]
pub(super) async fn enrich<Api: NotionApi>(
    api: &Api,
    mut body: PageDatabases,
) -> Result<ResolvedPage, NotionError> {
    let mut views = HashMap::new();
    let mut unavailable = HashMap::new();
    let mut warnings = Vec::new();
    for occurrence in &body.occurrences {
        let Some(key) = &occurrence.key else { continue };
        if views.contains_key(&key.container_id) || unavailable.contains_key(&key.container_id) {
            continue;
        }
        match read_views(api, &ViewScope::Database(key.container_id.clone())).await {
            Ok(found) => {
                views.insert(key.container_id.clone(), found);
            }
            Err(error) => match read_failure(&error) {
                Some(reason) => {
                    unavailable.insert(key.container_id.clone(), reason);
                    warnings.push(ImportNotice::new(
                        &key.container_id,
                        &occurrence.title,
                        ImportNoticeKind::ContainerViewsUnavailable { reason },
                    ));
                }
                None => return Err(error),
            },
        }
    }
    let mut source_owners: HashMap<NotionId, Result<NotionId, ReadFailure>> = HashMap::new();
    for occurrence in &mut body.occurrences {
        let Some(key) = &occurrence.key else { continue };
        let Some(tabs) = views.get(&key.container_id) else {
            continue;
        };
        occurrence
            .losses
            .retain(|loss| *loss != DatabaseLoss::NeedsViews);
        for tab in tabs.iter().filter_map(ViewTab::view) {
            if tab.parent.database_id != key.container_id {
                warnings.push(ImportNotice::new(
                    &tab.id,
                    &tab.name,
                    ImportNoticeKind::ViewContainerMismatch,
                ));
                continue;
            }
            if let Some(source) = &tab.data_source_id
                && !occurrence.sources.iter().any(|known| &known.id == source)
            {
                if !source_owners.contains_key(source) {
                    let owner = match api.data_source(source).await {
                        Ok(metadata) if !metadata.in_trash => Ok(metadata.database_id),
                        Ok(_) => Err(ReadFailure::Trashed),
                        Err(error) => match read_failure(&error) {
                            Some(reason) => Err(reason),
                            None => return Err(error),
                        },
                    };
                    source_owners.insert(source.clone(), owner);
                }
                let ownership = match source_owners.get(source) {
                    Some(Ok(owner)) => Some(if owner == &key.container_id {
                        SourceOwnership::Owned
                    } else {
                        SourceOwnership::Linked
                    }),
                    Some(Err(reason)) => {
                        occurrence.losses.push(DatabaseLoss::SourceUnavailable {
                            source_id: source.clone(),
                            reason: *reason,
                        });
                        None
                    }
                    None => None,
                };
                occurrence.sources.push(OccurrenceSource {
                    id: source.clone(),
                    ownership,
                });
            }
        }
        if tabs
            .iter()
            .filter_map(ViewTab::view)
            .any(|view| view.parent.database_id == key.container_id)
            && occurrence
                .sources
                .iter()
                .any(|source| source.ownership.is_some())
        {
            occurrence
                .losses
                .retain(|loss| !matches!(loss, DatabaseLoss::ContainerUnavailable { .. }));
        }
        if occurrence.sources.is_empty() {
            occurrence.losses.push(DatabaseLoss::EmptyContainer);
        }
    }
    tracing::Span::current().record("occurrences", body.occurrences.len() as i64);
    Ok(ResolvedPage {
        body,
        views,
        warnings,
        unavailable,
    })
}

/// Drain the container's reference pages before retrieving their full presets.
#[tracing::instrument(name = "notion.database_views", skip_all, fields(container_id = tracing::field::Empty, source_id = tracing::field::Empty, views = tracing::field::Empty), err)]
pub(super) async fn read_views<Api: NotionApi>(
    api: &Api,
    scope: &ViewScope,
) -> Result<Vec<ViewTab>, NotionError> {
    match scope {
        ViewScope::Database(id) => {
            tracing::Span::current().record("container_id", tracing::field::display(id));
        }
        ViewScope::DataSource(id) => {
            tracing::Span::current().record("source_id", tracing::field::display(id));
        }
    }
    let mut cursor = None;
    let mut cursors = HashSet::new();
    let mut ids = HashSet::new();
    let mut views = Vec::new();
    loop {
        let page = api.list_views(scope, cursor).await?;
        for id in page.results {
            if ids.insert(id.clone()) {
                let tab = match api.retrieve_view(&id).await {
                    Ok(view) if view.id == id => ViewTab::Ready(Box::new(view)),
                    Ok(_) => ViewTab::Unavailable {
                        id,
                        reason: ReadFailure::InvalidObject,
                    },
                    Err(error) => match read_failure(&error) {
                        Some(reason) => ViewTab::Unavailable { id, reason },
                        None => return Err(error),
                    },
                };
                views.push(tab);
            }
        }
        cursor = page.next_cursor;
        let Some(next) = &cursor else { break };
        if !cursors.insert(next.clone()) {
            return Err(NotionError::Decode(
                "view pagination repeated its cursor".into(),
            ));
        }
    }
    tracing::Span::current().record("views", views.len() as i64);
    Ok(views)
}

/// Access failures are visible fallbacks; outages must keep the run retryable.
pub(super) fn read_failure(error: &NotionError) -> Option<ReadFailure> {
    match error {
        NotionError::NotFound => Some(ReadFailure::NotFound),
        NotionError::Forbidden => Some(ReadFailure::Forbidden),
        NotionError::Decode(_) => Some(ReadFailure::InvalidObject),
        NotionError::Upstream { status: 400, .. } => Some(ReadFailure::InvalidObject),
        _ => None,
    }
}
