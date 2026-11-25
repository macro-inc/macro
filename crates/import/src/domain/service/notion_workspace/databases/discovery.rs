//! Discover page-level review dependencies without reading any source rows.

use crate::domain::models::{FidelityWarning, ImportNotice, ImportNoticeKind};
use std::collections::{HashMap, HashSet};

use futures::{StreamExt, stream};
use import_notion::domain::databases::{DatabaseLoss, ReadFailure};
use import_notion::domain::model::{DataSourceSummary, Inventory, InventoryProgress, NotionId};
use import_notion::domain::ports::NotionApi;

use super::super::write::Cancel;
use super::{read_failure, resolve_page};

/// Match inventory's bounded source-sampling fanout.
const DISCOVERY_CONCURRENCY: usize = 4;

/// An external source, including one the connection cannot read.
pub(crate) struct Dependency {
    pub title: String,
    pub url: String,
    pub referenced_by: Vec<NotionId>,
    pub unavailable: Option<ReadFailure>,
}

/// Page-level dependencies join the review. Row-body discovery waits for writing.
pub(crate) struct Discovery {
    pub inventory: Inventory,
    pub dependencies: HashMap<NotionId, Dependency>,
    pub inline_on: HashMap<NotionId, Vec<NotionId>>,
    pub warnings: HashMap<NotionId, Vec<FidelityWarning>>,
}

struct PageScan {
    dependencies: HashMap<NotionId, Dependency>,
    warnings: HashMap<NotionId, Vec<FidelityWarning>>,
    inline_on: HashMap<NotionId, Vec<NotionId>>,
}

/// Keep search summaries and discard each page body as soon as its references are read.
#[tracing::instrument(name = "notion.database_dependencies", skip_all, fields(dependencies = tracing::field::Empty, sources = tracing::field::Empty), err)]
pub(crate) async fn discover<Api: NotionApi>(
    api: &Api,
    mut inventory: Inventory,
    cancel: &Cancel,
    progress: &(dyn Fn(InventoryProgress) + Send + Sync),
) -> anyhow::Result<Discovery> {
    let PageScan {
        dependencies,
        mut warnings,
        inline_on,
    } = scan_pages(api, &inventory, cancel, progress).await?;
    let dependencies = load_dependencies(
        api,
        &mut inventory,
        dependencies,
        &mut warnings,
        cancel,
        progress,
    )
    .await?;
    tracing::Span::current().record("dependencies", dependencies.len() as i64);
    tracing::Span::current().record("sources", inventory.data_sources.len() as i64);
    Ok(Discovery {
        inventory,
        dependencies,
        inline_on,
        warnings,
    })
}

#[tracing::instrument(name = "notion.database_page_scan", skip_all, fields(pages = inventory.pages.len() as i64, pages_read = tracing::field::Empty), err)]
async fn scan_pages<Api: NotionApi>(
    api: &Api,
    inventory: &Inventory,
    cancel: &Cancel,
    progress: &(dyn Fn(InventoryProgress) + Send + Sync),
) -> anyhow::Result<PageScan> {
    let known: HashSet<_> = inventory
        .data_sources
        .iter()
        .map(|summary| summary.source.id.clone())
        .collect();
    let mut scan = PageScan {
        dependencies: HashMap::new(),
        warnings: HashMap::new(),
        inline_on: HashMap::new(),
    };
    cancel.ensure_running()?;
    progress(InventoryProgress {
        pages: 0,
        data_sources: known.len(),
    });
    let mut pages_read = 0usize;
    // Own only identifiers and titles across the stream's awaits, never all bodies.
    let inputs: Vec<_> = inventory
        .pages
        .iter()
        .map(|page| (page.id.clone(), page.title.clone()))
        .collect();
    let mut pages = stream::iter(inputs)
        .map(|(page, title)| async move {
            if cancel.stopped() {
                return (page, title, None);
            }
            let resolved = resolve_page(api, &page).await;
            (page, title, Some(resolved))
        })
        .buffered(DISCOVERY_CONCURRENCY);
    while let Some((page, title, outcome)) = pages.next().await {
        cancel.ensure_running()?;
        pages_read += 1;
        let losses = scan.warnings.entry(page.clone()).or_default();
        match outcome {
            Some(Ok(resolved)) => {
                losses.extend(
                    resolved
                        .warnings
                        .into_iter()
                        .map(|notice| FidelityWarning::Notice { notice }),
                );
                for occurrence in resolved.body.occurrences {
                    losses.extend(
                        occurrence
                            .losses
                            .iter()
                            .map(|loss| FidelityWarning::Notice {
                                notice: ImportNotice::new(
                                    &page,
                                    &title,
                                    ImportNoticeKind::PageDatabaseOccurrence {
                                        database: occurrence.title.clone(),
                                        loss: loss.clone(),
                                    },
                                ),
                            }),
                    );
                    for reference in occurrence.sources {
                        let origins = scan.inline_on.entry(reference.id.clone()).or_default();
                        if !origins.contains(&page) {
                            origins.push(page.clone());
                        }
                        if known.contains(&reference.id) {
                            continue;
                        }
                        let unavailable = occurrence.losses.iter().find_map(|loss| match loss {
                            DatabaseLoss::SourceUnavailable { source_id, reason }
                                if source_id == &reference.id =>
                            {
                                Some(*reason)
                            }
                            _ => None,
                        });
                        let dependency = scan
                            .dependencies
                            .entry(reference.id.clone())
                            .or_insert_with(|| Dependency {
                                title: occurrence.title.clone(),
                                url: reference.id.url(),
                                referenced_by: vec![],
                                unavailable,
                            });
                        if !dependency.referenced_by.contains(&page) {
                            dependency.referenced_by.push(page.clone());
                        }
                    }
                }
                // The potentially large markdown and view payloads are dropped here.
            }
            Some(Err(error)) => {
                let Some(reason) = read_failure(&error) else {
                    return Err(error.into());
                };
                losses.push(FidelityWarning::Notice {
                    notice: ImportNotice::new(
                        &page,
                        &title,
                        ImportNoticeKind::ReferencesUnavailable { reason },
                    ),
                });
            }
            None => cancel.ensure_running()?,
        }
        progress(InventoryProgress {
            pages: pages_read,
            data_sources: known.len() + scan.dependencies.len(),
        });
    }
    tracing::Span::current().record("pages_read", pages_read as i64);
    Ok(scan)
}

#[tracing::instrument(name = "notion.database_dependency_metadata", skip_all, fields(dependencies = tracing::field::Empty), err)]
async fn load_dependencies<Api: NotionApi>(
    api: &Api,
    inventory: &mut Inventory,
    candidates: HashMap<NotionId, Dependency>,
    warnings: &mut HashMap<NotionId, Vec<FidelityWarning>>,
    cancel: &Cancel,
    progress: &(dyn Fn(InventoryProgress) + Send + Sync),
) -> anyhow::Result<HashMap<NotionId, Dependency>> {
    let known = inventory.data_sources.len();
    let mut candidates: Vec<_> = candidates.into_iter().collect();
    candidates.sort_by(|left, right| left.0.as_str().cmp(right.0.as_str()));
    let mut reads = stream::iter(candidates)
        .map(|(id, dependency)| async move {
            if cancel.stopped() || dependency.unavailable.is_some() {
                return (id, dependency, None);
            }
            let source = api.data_source(&id).await;
            (id, dependency, Some(source))
        })
        .buffered(DISCOVERY_CONCURRENCY);
    let mut dependencies = HashMap::new();
    while let Some((id, mut dependency, loaded)) = reads.next().await {
        cancel.ensure_running()?;
        match loaded {
            Some(Ok(source)) if !source.in_trash => {
                dependency.title = source.title.clone();
                dependency.url = source.database_id.url();
                warnings
                    .entry(id.clone())
                    .or_default()
                    .push(FidelityWarning::Notice {
                        notice: ImportNotice::new(
                            &id,
                            &dependency.title,
                            ImportNoticeKind::DependencyRowsUnknown,
                        ),
                    });
                inventory.data_sources.push(DataSourceSummary {
                    source,
                    row_count: 0,
                    sample_titles: vec![],
                });
            }
            Some(Ok(_)) => dependency.unavailable = Some(ReadFailure::Trashed),
            Some(Err(error)) => {
                let Some(reason) = read_failure(&error) else {
                    return Err(error.into());
                };
                dependency.unavailable = Some(reason);
            }
            None => {}
        }
        dependencies.insert(id, dependency);
        progress(InventoryProgress {
            pages: inventory.pages.len(),
            data_sources: known + dependencies.len(),
        });
    }
    tracing::Span::current().record("dependencies", dependencies.len() as i64);
    Ok(dependencies)
}
