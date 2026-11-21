//! Database placements in page bodies and sources that need import review.
//!
//! Reading a placement never imports its source or grants access. A container
//! with no source references still needs the Views API checked: it may hold
//! linked views. Keep its tag and losses until the caller resolves that case.

use std::collections::{HashMap, HashSet};
use std::ops::Range;

#[cfg(test)]
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use super::inventory::full_markdown;
#[cfg(test)]
use super::model::Inventory;
use super::model::{NotionDataSource, NotionId};
use super::ports::{NotionApi, NotionError};

mod markdown;

/// A placement's identity within one page, also visible to the card converter.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OccurrenceKey {
    /// Database id from the tag URL's pathname, excluding query and fragment.
    pub container_id: NotionId,
    /// Zero-based occurrence number for this container in this page.
    pub ordinal: usize,
}

/// Whether a source belongs to the placement's container or is linked into it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SourceOwnership {
    /// The source's owning database is this container.
    Owned,
    /// The source's owning database is a different container.
    Linked,
}

/// A source named by a container, including sources whose metadata is unreadable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OccurrenceSource {
    /// Stable source identity; never inferred from its title.
    pub id: NotionId,
    /// Unknown when source metadata could not be read.
    pub ownership: Option<SourceOwnership>,
}

/// Why a specific object could not be used, distinct from transient API failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ReadFailure {
    /// Missing or not shared with the connection.
    NotFound,
    /// The connection lacks permission.
    Forbidden,
    /// The id is not readable as the requested resource (HTTP 400).
    InvalidObject,
    /// The object is in the trash.
    Trashed,
    /// The connector exhausted its retries for this object.
    TemporarilyUnavailable,
}

impl std::fmt::Display for ReadFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::NotFound => "not found or not shared with the connection",
            Self::Forbidden => "the connection does not have access",
            Self::InvalidObject => "the reference does not identify a supported database",
            Self::Trashed => "the object is in the trash",
            Self::TemporarilyUnavailable => "Notion is temporarily unavailable after retries",
        })
    }
}

/// A placement loss that the import review/report must retain.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DatabaseLoss {
    /// The tag has no parseable container id; keep a named link to its page.
    MissingContainerId,
    /// The database endpoint returned no sources; resolve linked views first.
    NeedsViews,
    /// Both container sources and views are empty, confirmed by the caller.
    EmptyContainer,
    /// The container could not be read; keep a named Notion link.
    ContainerUnavailable {
        /// The access or object failure.
        reason: ReadFailure,
    },
    /// One source could not be read; other sources remain available.
    SourceUnavailable {
        /// The source that failed.
        source_id: NotionId,
        /// The access or object failure.
        reason: ReadFailure,
    },
}

impl std::fmt::Display for DatabaseLoss {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingContainerId => {
                f.write_str("the database reference has no usable destination")
            }
            Self::NeedsViews => f.write_str("the database tabs could not be resolved"),
            Self::EmptyContainer => f.write_str("the database has no readable data source"),
            Self::ContainerUnavailable { reason } => {
                write!(f, "the database is unavailable: {reason}")
            }
            Self::SourceUnavailable { reason, .. } => {
                write!(f, "the referenced data source is unavailable: {reason}")
            }
        }
    }
}

/// One `<database>` block, in original body order, including unresolved blocks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseOccurrence {
    /// Present when the URL contains a container id.
    pub key: Option<OccurrenceKey>,
    /// UTF-8 byte range of the complete tag in [`PageDatabases::markdown`].
    pub range: Range<usize>,
    /// Title from the tag; blank titles receive a named fallback.
    pub title: String,
    /// Original URL, including query and fragment, when supplied.
    pub url: Option<String>,
    /// Explicit `v` query parameter; never inferred from a fragment.
    pub view_id: Option<NotionId>,
    /// The markdown tag's inline attribute, independent of source ownership.
    pub inline: Option<bool>,
    /// All distinct sources, in the order the database endpoint returned them.
    pub sources: Vec<OccurrenceSource>,
    /// Explicit resolution losses; the original tag is never removed.
    pub losses: Vec<DatabaseLoss>,
}

impl DatabaseOccurrence {
    /// A link for unresolved placements, using the containing page if URL-less.
    pub fn fallback_url(&self, page: &NotionId) -> String {
        self.url
            .as_deref()
            .filter(|url| !url.trim().is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| page.url())
    }
}

/// The expanded markdown and its database placements, ready for conversion.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageDatabases {
    /// Page whose body was read (standalone or a data source row).
    pub page_id: NotionId,
    /// Unmodified result of [`full_markdown`]; byte ranges refer to this string.
    pub markdown: String,
    /// Ordered placements, retaining repeated references to the same container.
    pub occurrences: Vec<DatabaseOccurrence>,
}

/// A source outside the selected inventory, requiring an explicit review choice.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg(test)]
pub struct DatabaseDependency {
    /// Source metadata only; this discovery does not query or copy its rows.
    pub source: NotionDataSource,
    /// Selected pages that refer to it, each once, in discovery order.
    pub referenced_by: Vec<NotionId>,
}

/// Body placements and dependencies, without expanding the reviewed inventory.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg(test)]
pub struct DatabaseDiscovery {
    /// Bodies of the inventory's standalone pages.
    pub pages: Vec<PageDatabases>,
    /// Readable, non-trashed sources absent from `Inventory::data_sources`.
    pub dependencies: Vec<DatabaseDependency>,
}

/// Read a page's full body and resolve database tags without changing its text.
///
/// Unreadable objects become typed losses. Transient/API failures propagate
/// through the existing retry contract instead of pretending an object is absent.
#[tracing::instrument(skip(api), err)]
pub async fn read_page_databases<Api: NotionApi>(
    api: &Api,
    page: &NotionId,
) -> Result<PageDatabases, NotionError> {
    Resolver::default().read_page(api, page).await
}

/// Discover dependencies for review, deduplicated by source id within this
/// workspace client. The importer must include workspace identity in its mapping.
///
/// This walks the inventory's standalone pages. Call [`read_page_databases`] for
/// row bodies as needed. It never follows a dependency's body or expands scope
/// transitively, queries dependency rows, copies data, or creates grants.
#[cfg(test)]
#[tracing::instrument(skip_all, err, fields(pages = inventory.pages.len(), dependencies))]
pub async fn discover_database_dependencies<Api: NotionApi>(
    api: &Api,
    inventory: &Inventory,
) -> Result<DatabaseDiscovery, NotionError> {
    let selected: HashSet<_> = inventory
        .data_sources
        .iter()
        .map(|summary| summary.source.id.clone())
        .collect();
    let mut resolver = Resolver::default();
    for summary in &inventory.data_sources {
        resolver.sources.insert(
            summary.source.id.clone(),
            Lookup::Ready(summary.source.clone()),
        );
    }
    let mut pages = Vec::new();
    let mut dependencies: IndexMap<NotionId, DatabaseDependency> = IndexMap::new();
    for page in &inventory.pages {
        let body = resolver.read_page(api, &page.id).await?;
        for occurrence in &body.occurrences {
            for reference in &occurrence.sources {
                if selected.contains(&reference.id) {
                    continue;
                }
                let Some(Lookup::Ready(source)) = resolver.sources.get(&reference.id) else {
                    continue;
                };
                let dependency =
                    dependencies
                        .entry(source.id.clone())
                        .or_insert_with(|| DatabaseDependency {
                            source: source.clone(),
                            referenced_by: Vec::new(),
                        });
                if !dependency.referenced_by.contains(&page.id) {
                    dependency.referenced_by.push(page.id.clone());
                }
            }
        }
        pages.push(body);
    }
    tracing::Span::current().record("dependencies", dependencies.len());
    Ok(DatabaseDiscovery {
        pages,
        dependencies: dependencies.into_values().collect(),
    })
}

#[derive(Clone)]
enum Lookup<T> {
    Ready(T),
    Unavailable(ReadFailure),
}

/// Cache both successes and access failures across repeated page placements.
#[derive(Default)]
struct Resolver {
    containers: HashMap<NotionId, Lookup<Vec<NotionId>>>,
    sources: HashMap<NotionId, Lookup<NotionDataSource>>,
}

impl Resolver {
    #[tracing::instrument(skip(self, api), err, fields(occurrences, losses))]
    async fn read_page<Api: NotionApi>(
        &mut self,
        api: &Api,
        page: &NotionId,
    ) -> Result<PageDatabases, NotionError> {
        let markdown = full_markdown(api, page).await?;
        let mut occurrences = markdown::occurrences(&markdown);
        for occurrence in &mut occurrences {
            self.resolve(api, occurrence).await?;
        }
        let losses: usize = occurrences.iter().map(|item| item.losses.len()).sum();
        let span = tracing::Span::current();
        span.record("occurrences", occurrences.len());
        span.record("losses", losses);
        Ok(PageDatabases {
            page_id: page.clone(),
            markdown,
            occurrences,
        })
    }

    async fn resolve<Api: NotionApi>(
        &mut self,
        api: &Api,
        occurrence: &mut DatabaseOccurrence,
    ) -> Result<(), NotionError> {
        let Some(key) = &occurrence.key else {
            tracing::warn!(
                offset = occurrence.range.start,
                "database placement has no container id; retaining a page link"
            );
            occurrence.losses.push(DatabaseLoss::MissingContainerId);
            return Ok(());
        };
        let container = &key.container_id;
        let sources = match self.containers.get(container) {
            Some(found) => found.clone(),
            None => {
                let found = match api.database_sources(container).await {
                    Ok(ids) => Lookup::Ready(ids),
                    Err(error) => Lookup::Unavailable(read_failure(error)?),
                };
                self.containers.insert(container.clone(), found.clone());
                found
            }
        };
        let ids = match sources {
            Lookup::Ready(ids) => ids,
            Lookup::Unavailable(reason) => {
                tracing::warn!(container_id = %container, ?reason, "database placement is unreadable; retaining its link");
                occurrence
                    .losses
                    .push(DatabaseLoss::ContainerUnavailable { reason });
                return Ok(());
            }
        };
        if ids.is_empty() {
            tracing::debug!(container_id = %container, "database placement needs view lookup before resolving sources");
            occurrence.losses.push(DatabaseLoss::NeedsViews);
        }
        let mut seen = HashSet::new();
        for id in ids.into_iter().filter(|id| seen.insert(id.clone())) {
            let source = match self.sources.get(&id) {
                Some(found) => found.clone(),
                None => {
                    let found = match api.data_source(&id).await {
                        Ok(source) if source.in_trash => Lookup::Unavailable(ReadFailure::Trashed),
                        Ok(source) => Lookup::Ready(source),
                        Err(error) => Lookup::Unavailable(read_failure(error)?),
                    };
                    self.sources.insert(id.clone(), found.clone());
                    found
                }
            };
            let ownership = match source {
                Lookup::Ready(source) if &source.database_id == container => {
                    Some(SourceOwnership::Owned)
                }
                Lookup::Ready(_) => Some(SourceOwnership::Linked),
                Lookup::Unavailable(reason) => {
                    tracing::warn!(container_id = %container, source_id = %id, ?reason, "placement source is unreadable; retaining its link");
                    occurrence.losses.push(DatabaseLoss::SourceUnavailable {
                        source_id: id.clone(),
                        reason,
                    });
                    None
                }
            };
            occurrence.sources.push(OccurrenceSource { id, ownership });
        }
        Ok(())
    }
}

fn read_failure(error: NotionError) -> Result<ReadFailure, NotionError> {
    match error {
        NotionError::NotFound => Ok(ReadFailure::NotFound),
        NotionError::Forbidden => Ok(ReadFailure::Forbidden),
        NotionError::Decode(_) => Ok(ReadFailure::InvalidObject),
        NotionError::Upstream { status: 400, .. } => Ok(ReadFailure::InvalidObject),
        other => Err(other),
    }
}
