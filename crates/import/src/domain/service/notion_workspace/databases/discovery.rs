//! Extend the reviewed inventory with sources reached through body placements.

use std::collections::{HashMap, HashSet, VecDeque};

use import_notion::domain::databases::{ReadFailure, discover_database_dependencies};
use import_notion::domain::inventory::all_rows;
use import_notion::domain::model::{DataSourceSummary, Inventory, NotionDataSource, NotionId};
use import_notion::domain::ports::{NotionApi, NotionError};

use super::{enrich, read_failure, resolve_page};

/// An external source, including one the connection cannot read.
pub(crate) struct Dependency {
    pub title: String,
    pub url: String,
    pub referenced_by: Vec<NotionId>,
    pub unavailable: Option<ReadFailure>,
}

/// All readable sources are staged; unavailable ones remain visible for review.
pub(crate) struct Discovery {
    pub inventory: Inventory,
    pub dependencies: HashMap<NotionId, Dependency>,
    pub inline_on: HashMap<NotionId, Vec<NotionId>>,
    pub warnings: HashMap<NotionId, Vec<String>>,
}

/// Follow linked sources and row bodies to a fixed point before asking for approval.
#[tracing::instrument(name = "notion.database_dependencies", skip_all, fields(dependencies = tracing::field::Empty, sources = tracing::field::Empty), err)]
pub(crate) async fn discover<Api: NotionApi>(
    api: &Api,
    mut inventory: Inventory,
) -> Result<Discovery, NotionError> {
    let found = discover_database_dependencies(api, &inventory).await?;
    let mut cached: HashMap<NotionId, NotionDataSource> = found
        .dependencies
        .into_iter()
        .map(|dependency| (dependency.source.id.clone(), dependency.source))
        .collect();
    let mut known: HashSet<NotionId> = inventory
        .data_sources
        .iter()
        .map(|summary| summary.source.id.clone())
        .collect();
    let mut sources: VecDeque<NotionId> = inventory
        .data_sources
        .iter()
        .map(|summary| summary.source.id.clone())
        .collect();
    let mut bodies = VecDeque::new();
    for body in found.pages {
        let page = body.page_id.clone();
        bodies.push_back((page, enrich(api, body).await?));
    }
    let mut dependencies: HashMap<NotionId, Dependency> = HashMap::new();
    let mut warnings: HashMap<NotionId, Vec<String>> = HashMap::new();
    let mut scanned = HashSet::new();
    let mut inline_on: HashMap<NotionId, Vec<NotionId>> = HashMap::new();
    loop {
        while let Some((origin, resolved)) = bodies.pop_front() {
            warnings
                .entry(origin.clone())
                .or_default()
                .extend(resolved.warnings);
            for occurrence in resolved.body.occurrences {
                for reference in occurrence.sources {
                    let origins = inline_on.entry(reference.id.clone()).or_default();
                    if !origins.contains(&origin) {
                        origins.push(origin.clone());
                    }
                    // Selected sources retain their original place. Repeated references
                    // to an external source only add provenance to the same review row.
                    if let Some(dependency) = dependencies.get_mut(&reference.id) {
                        if !dependency.referenced_by.contains(&origin) {
                            dependency.referenced_by.push(origin.clone());
                        }
                        continue;
                    }
                    if known.contains(&reference.id) {
                        continue;
                    }
                    let loaded = match cached.remove(&reference.id) {
                        Some(source) => Ok(source),
                        None => api.data_source(&reference.id).await,
                    };
                    let (source, unavailable) = match loaded {
                        Ok(source) if !source.in_trash => (Some(source), None),
                        Ok(_) => (None, Some(ReadFailure::Trashed)),
                        Err(error) => match read_failure(&error) {
                            Some(reason) => (None, Some(reason)),
                            None => return Err(error),
                        },
                    };
                    let title = source
                        .as_ref()
                        .map(|source| source.title.clone())
                        .unwrap_or_else(|| occurrence.title.clone());
                    let url = source
                        .as_ref()
                        .map(|source| source.database_id.url())
                        .unwrap_or_else(|| reference.id.url());
                    dependencies.insert(
                        reference.id.clone(),
                        Dependency {
                            title,
                            url,
                            referenced_by: vec![origin.clone()],
                            unavailable,
                        },
                    );
                    if let Some(source) = source {
                        known.insert(source.id.clone());
                        sources.push_back(source.id.clone());
                        inventory.data_sources.push(DataSourceSummary {
                            source,
                            row_count: 0,
                            sample_titles: vec![],
                        });
                    }
                }
            }
        }
        let Some(source) = sources.pop_front() else {
            break;
        };
        if !scanned.insert(source.clone()) {
            continue;
        }
        let rows = match all_rows(api, &source).await {
            Ok(rows) => rows,
            Err(error) if read_failure(&error).is_some() => {
                warnings.entry(source.clone()).or_default().push(format!(
                    "Source {source}: rows unavailable ({:?})",
                    read_failure(&error)
                ));
                continue;
            }
            Err(error) => return Err(error),
        };
        if !rows.complete {
            warnings.entry(source.clone()).or_default().push(format!(
                "Source {source}: Notion returned an incomplete row query"
            ));
        }
        if let Some(summary) = inventory
            .data_sources
            .iter_mut()
            .find(|summary| summary.source.id == source)
        {
            summary.row_count = rows.rows.len();
            summary.sample_titles = rows
                .rows
                .iter()
                .take(5)
                .map(|row| row.title.clone())
                .collect();
        }
        for row in rows.rows {
            match resolve_page(api, &row.id).await {
                Ok(body) => bodies.push_back((source.clone(), body)),
                Err(error) if read_failure(&error).is_some() => {
                    warnings.entry(source.clone()).or_default().push(format!(
                        "Row {}: body unavailable ({:?})",
                        row.id,
                        read_failure(&error)
                    ));
                }
                Err(error) => return Err(error),
            }
        }
    }
    tracing::Span::current().record("dependencies", dependencies.len() as i64);
    tracing::Span::current().record("sources", inventory.data_sources.len() as i64);
    Ok(Discovery {
        inventory,
        dependencies,
        inline_on,
        warnings,
    })
}
