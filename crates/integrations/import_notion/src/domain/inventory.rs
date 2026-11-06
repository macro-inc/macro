//! Walking a Notion workspace: everything in scope, every row of a data
//! source, every member, and a page's whole body.

use std::collections::{HashMap, HashSet};

use futures::{StreamExt, TryStreamExt, stream};
use lazy_regex::regex;

use super::model::{
    DataSourceSummary, ImportScope, Inventory, InventoryProgress, NotionDataSource, NotionId,
    NotionPage, NotionParent, NotionUser, SearchHit, SearchObject,
};
use super::ports::{NotionApi, NotionError};

/// How many data sources are sampled at once.
const SAMPLE_CONCURRENCY: usize = 4;

/// How many row titles a summary keeps.
const SAMPLE_TITLES: usize = 5;

/// How many rounds of unknown blocks [`full_markdown`] follows.
const MARKDOWN_DEPTH: u8 = 8;

/// How many unknown blocks are fetched at once.
const MARKDOWN_CONCURRENCY: usize = 4;

/// Everything in `scope`: standalone pages (rows and trashed objects
/// excluded) and data sources with their rows counted.
///
/// `progress` is called as the counts grow, and once more with the final,
/// scoped counts. Roots that are not shared with the connection are skipped,
/// as are data sources whose rows cannot be read. Rows are counted from the
/// search results; a data source is queried only when search showed none
/// of its rows.
#[tracing::instrument(skip_all, err, fields(pages, data_sources, queried_data_sources))]
pub async fn inventory<Api: NotionApi>(
    api: &Api,
    scope: &ImportScope,
    progress: &(dyn Fn(InventoryProgress) + Send + Sync),
) -> Result<Inventory, NotionError> {
    // Every live page, rows included: rows are not documents, but pages
    // nested under a row walk up through it.
    let mut pages: Vec<NotionPage> = Vec::new();
    let mut data_sources: Vec<NotionDataSource> = Vec::new();
    let mut documents = 0;

    for object in [SearchObject::Page, SearchObject::DataSource] {
        let mut cursor = None;
        loop {
            let page = api.search(object, cursor).await?;
            for hit in page.results {
                match hit {
                    SearchHit::Page(page) if !page.in_trash => {
                        if !is_row(&page) {
                            documents += 1;
                        }
                        pages.push(page);
                    }
                    SearchHit::DataSource(source) if !source.in_trash => data_sources.push(source),
                    SearchHit::Page(_) | SearchHit::DataSource(_) => {}
                }
            }
            progress(InventoryProgress {
                pages: documents,
                data_sources: data_sources.len(),
            });
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
    }
    dedupe_pages(&mut pages);
    dedupe_sources(&mut data_sources);
    // Search lists every row as a page, so rows are counted from it; only a
    // data source search did not show rows for is queried.
    let searched_rows = rows_by_data_source(&pages, &data_sources);

    if let ImportScope::Roots { ids } = scope {
        let roots: HashSet<NotionId> = ids.iter().cloned().collect();
        add_missing_roots(api, &roots, &mut pages, &mut data_sources).await?;
        let tree = Tree::new(&pages, &data_sources);
        pages.retain(|page| tree.is_under(&page.id, &roots));
        data_sources.retain(|source| tree.is_under(&source.id, &roots));
    }
    pages.retain(|page| !is_row(page));

    tracing::Span::current().record(
        "queried_data_sources",
        data_sources
            .iter()
            .filter(|source| !searched_rows.contains_key(&source.id))
            .count(),
    );
    let summaries: Vec<Option<DataSourceSummary>> = stream::iter(data_sources)
        .map(|source| {
            let rows = searched_rows.get(&source.id);
            async move {
                match rows {
                    Some(titles) => Ok(Some(DataSourceSummary {
                        row_count: titles.len(),
                        sample_titles: titles.iter().take(SAMPLE_TITLES).cloned().collect(),
                        source,
                    })),
                    None => summarize(api, source).await,
                }
            }
        })
        .buffered(SAMPLE_CONCURRENCY)
        .try_collect()
        .await?;
    let data_sources: Vec<DataSourceSummary> = summaries.into_iter().flatten().collect();

    progress(InventoryProgress {
        pages: pages.len(),
        data_sources: data_sources.len(),
    });
    let span = tracing::Span::current();
    span.record("pages", pages.len());
    span.record("data_sources", data_sources.len());
    Ok(Inventory {
        pages,
        data_sources,
    })
}

/// Every row of a data source, oldest first, each once.
#[tracing::instrument(skip(api), err, fields(rows))]
pub async fn all_rows<Api: NotionApi>(
    api: &Api,
    data_source: &NotionId,
) -> Result<Vec<NotionPage>, NotionError> {
    let mut rows: Vec<NotionPage> = Vec::new();
    let mut seen: HashSet<NotionId> = HashSet::new();
    let mut cursor = None;
    loop {
        let page = api.query_data_source(data_source, cursor).await?;
        // A query that restarts past Notion's result cap repeats the rows
        // created in the same instant as the last one it returned.
        rows.extend(
            page.results
                .into_iter()
                .filter(|row| seen.insert(row.id.clone())),
        );
        match page.next_cursor {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }
    tracing::Span::current().record("rows", rows.len());
    Ok(rows)
}

/// Every workspace member the connection may list, bots excluded.
#[tracing::instrument(skip(api), err, fields(users))]
pub async fn all_users<Api: NotionApi>(api: &Api) -> Result<Vec<NotionUser>, NotionError> {
    let mut users = Vec::new();
    let mut cursor = None;
    loop {
        let page = api.users(cursor).await?;
        users.extend(page.results);
        match page.next_cursor {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }
    tracing::Span::current().record("users", users.len());
    Ok(users)
}

/// A page's whole body as markdown, with the subtrees Notion left out of a
/// large page fetched and spliced back in.
///
/// Each left-out block replaces the `<unknown ...>` placeholder that names
/// it, or is appended when no placeholder does. Blocks the connection cannot
/// read keep their placeholder.
#[tracing::instrument(skip(api), err, fields(unknown_blocks))]
pub async fn full_markdown<Api: NotionApi>(
    api: &Api,
    page: &NotionId,
) -> Result<String, NotionError> {
    let root = api.page_markdown(page).await?;
    let mut markdown = root.markdown;
    let mut seen: HashSet<NotionId> = HashSet::from([page.clone()]);
    let mut pending = root.unknown_block_ids;
    let mut fetched = 0;

    for _ in 0..MARKDOWN_DEPTH {
        pending.retain(|id| seen.insert(id.clone()));
        if pending.is_empty() {
            break;
        }
        fetched += pending.len();
        let blocks: Vec<(NotionId, Option<_>)> = stream::iter(std::mem::take(&mut pending))
            .map(|id| async move {
                match api.page_markdown(&id).await {
                    Ok(block) => Ok((id, Some(block))),
                    // Not readable as markdown: unshared, gone, or not a page
                    // at all (an embedded database answers 400). The page
                    // keeps the placeholder rather than failing outright.
                    Err(
                        NotionError::NotFound
                        | NotionError::Forbidden
                        | NotionError::Upstream { status: 400, .. },
                    ) => {
                        tracing::warn!(block = %id, "unknown block is not readable; keeping its placeholder");
                        Ok((id, None))
                    }
                    Err(error) => Err(error),
                }
            })
            .buffered(MARKDOWN_CONCURRENCY)
            .try_collect()
            .await?;
        for (id, block) in blocks {
            let Some(block) = block else { continue };
            markdown = splice(&markdown, &id, &block.markdown);
            pending.extend(block.unknown_block_ids);
        }
    }
    if !pending.is_empty() {
        tracing::warn!(
            remaining = pending.len(),
            "page nests unknown blocks deeper than the importer follows"
        );
    }
    tracing::Span::current().record("unknown_blocks", fetched);
    Ok(markdown)
}

/// `markdown` with the placeholder naming `id` replaced by `block`, or with
/// `block` appended when no placeholder names it.
fn splice(markdown: &str, id: &NotionId, block: &str) -> String {
    // The placeholder names its block somewhere in its attributes, with or
    // without dashes.
    let placeholder = regex!(r"<unknown\b[^>]*>").find_iter(markdown).find(|tag| {
        regex!(r"(?i)[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}")
            .find_iter(tag.as_str())
            .any(|found| NotionId::parse(found.as_str()).as_ref() == Some(id))
    });
    match placeholder {
        Some(tag) => format!(
            "{}{}{}",
            &markdown[..tag.start()],
            block.trim_end(),
            &markdown[tag.end()..]
        ),
        None if markdown.is_empty() => block.to_owned(),
        None => format!("{}\n\n{}", markdown.trim_end(), block),
    }
}

/// The titles of the rows search listed, by the data source they belong to,
/// for each data source search listed with at least one row. A data source
/// search did not list (a root fetched by id), or listed without rows, is
/// left out: its rows have to be queried.
fn rows_by_data_source(
    pages: &[NotionPage],
    data_sources: &[NotionDataSource],
) -> HashMap<NotionId, Vec<String>> {
    let searched: HashSet<&NotionId> = data_sources.iter().map(|source| &source.id).collect();
    let mut rows: HashMap<NotionId, Vec<String>> = HashMap::new();
    for page in pages {
        if let NotionParent::DataSource { data_source, .. } = &page.parent
            && searched.contains(data_source)
        {
            rows.entry(data_source.clone())
                .or_default()
                .push(page.title.clone());
        }
    }
    rows
}

fn is_row(page: &NotionPage) -> bool {
    matches!(page.parent, NotionParent::DataSource { .. })
}

fn dedupe_pages(pages: &mut Vec<NotionPage>) {
    let mut seen = HashSet::new();
    pages.retain(|page| seen.insert(page.id.clone()));
}

fn dedupe_sources(sources: &mut Vec<NotionDataSource>) {
    let mut seen = HashSet::new();
    sources.retain(|source| seen.insert(source.id.clone()));
}

/// Fetch roots the search did not return: a database container's data
/// sources, a data source, or a page.
async fn add_missing_roots<Api: NotionApi>(
    api: &Api,
    roots: &HashSet<NotionId>,
    pages: &mut Vec<NotionPage>,
    data_sources: &mut Vec<NotionDataSource>,
) -> Result<(), NotionError> {
    for root in roots {
        let known = pages.iter().any(|page| &page.id == root)
            || data_sources
                .iter()
                .any(|source| &source.id == root || &source.database_id == root);
        if known {
            continue;
        }
        match api.database_sources(root).await {
            Ok(sources) => {
                for id in sources {
                    if data_sources.iter().any(|source| source.id == id) {
                        continue;
                    }
                    match api.data_source(&id).await {
                        Ok(source) if !source.in_trash => data_sources.push(source),
                        Ok(_) => {}
                        Err(NotionError::NotFound | NotionError::Forbidden) => {
                            tracing::warn!(data_source = %id, "root's data source is not readable; skipping it");
                        }
                        Err(error) => return Err(error),
                    }
                }
                continue;
            }
            Err(NotionError::NotFound | NotionError::Forbidden) => {}
            Err(error) => return Err(error),
        }
        match api.data_source(root).await {
            Ok(source) => {
                if !source.in_trash {
                    data_sources.push(source);
                }
                continue;
            }
            Err(NotionError::NotFound | NotionError::Forbidden) => {}
            Err(error) => return Err(error),
        }
        match api.page(root).await {
            Ok(page) if !page.in_trash => pages.push(page),
            Ok(_) => {}
            Err(NotionError::NotFound | NotionError::Forbidden) => {
                tracing::warn!(root = %root, "import root is not shared with the connection; skipping it");
            }
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

/// Parent links between the collected objects.
struct Tree {
    parents: HashMap<NotionId, NotionId>,
}

impl Tree {
    fn new(pages: &[NotionPage], data_sources: &[NotionDataSource]) -> Self {
        let mut parents = HashMap::new();
        for page in pages {
            if let Some(parent) = parent_id(&page.parent) {
                parents.insert(page.id.clone(), parent);
            }
        }
        for source in data_sources {
            parents.insert(source.id.clone(), source.database_id.clone());
            if let Some(parent) = parent_id(&source.database_parent) {
                parents.insert(source.database_id.clone(), parent);
            }
        }
        Self { parents }
    }

    /// Whether `id` is a root or sits anywhere under one.
    fn is_under(&self, id: &NotionId, roots: &HashSet<NotionId>) -> bool {
        let mut visited = HashSet::new();
        let mut current = id;
        loop {
            if roots.contains(current) {
                return true;
            }
            if !visited.insert(current) {
                return false;
            }
            match self.parents.get(current) {
                Some(parent) => current = parent,
                None => return false,
            }
        }
    }
}

fn parent_id(parent: &NotionParent) -> Option<NotionId> {
    match parent {
        NotionParent::Page { id } | NotionParent::Database { id } | NotionParent::Block { id } => {
            Some(id.clone())
        }
        NotionParent::DataSource { data_source, .. } => Some(data_source.clone()),
        NotionParent::Workspace | NotionParent::Other => None,
    }
}

/// A data source with its rows counted, or `None` when its rows
/// cannot be read.
async fn summarize<Api: NotionApi>(
    api: &Api,
    source: NotionDataSource,
) -> Result<Option<DataSourceSummary>, NotionError> {
    // Every row is counted, so the plan can say how much it will write.
    let mut row_count = 0;
    let mut sample_titles = Vec::new();
    let mut cursor = None;
    loop {
        let page = match api.query_data_source(&source.id, cursor).await {
            Ok(page) => page,
            Err(NotionError::NotFound | NotionError::Forbidden) => {
                tracing::warn!(data_source = %source.id, "data source rows are not readable; leaving it out");
                return Ok(None);
            }
            Err(error) => return Err(error),
        };
        row_count += page.results.len();
        sample_titles.extend(
            page.results
                .iter()
                .take(SAMPLE_TITLES.saturating_sub(sample_titles.len()))
                .map(|row| row.title.clone()),
        );
        match page.next_cursor {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }
    Ok(Some(DataSourceSummary {
        row_count,
        sample_titles,
        source,
    }))
}

#[cfg(test)]
mod test;
