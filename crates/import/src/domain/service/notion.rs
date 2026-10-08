//! Notion discovery and import over Notion's own API: the user's most
//! recently edited pages become Macro documents, converted by rule.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use mcp_select::ConnectorSelect;

use super::rate_limit::{Pacer, retry_rate_limited};
use super::{GatherMode, ImportServiceImpl, RowOutcome};
use crate::domain::models::{
    ImportEntity, ImportSource, ImportStatus, ImportedDocumentProperties, ImportedDocumentProperty,
    ImportedDocumentPropertyValue, NotionBlock, NotionBlockKind, NotionBlockPage, NotionContainer,
    NotionDocMeta, NotionId, NotionOwner, NotionPage, NotionParent, NotionProperty,
    NotionPropertyValue, NotionSearchPage,
};
use crate::domain::ports::{
    ApiSourceError, CanonicalImportRepo, EntityCreator, ImageRehoster, ImportApis, ImportRepo,
    NotionSession, NotionSource, RehostError, RehostedImage, SlackWorkspaceSource,
};

pub(crate) mod convert;
pub(crate) mod fetch;
pub(crate) mod folders;

#[cfg(test)]
pub(super) mod test;

use convert::{ConvertContext, HostedImage, LinkedDocument};
use folders::{FolderSpec, PlacedPage};

/// How many pages one run imports at most.
pub(crate) const MAX_NOTION_PAGES: usize = 30;
/// Search result pages read before giving up on finding more candidates.
pub(crate) const MAX_SEARCH_PAGES: usize = 5;
/// Database rows (task-tracker entries) need this much body text to count
/// as a page worth importing.
pub(crate) const DATABASE_ROW_MIN_CHARS: usize = 200;
/// Concurrent reads while judging database rows during discovery.
const CHECK_CONCURRENCY: usize = 3;
/// Images larger than this become links instead.
pub(crate) const IMAGE_LIMIT_BYTES: usize = 10 * 1024 * 1024;
/// Concurrent image copies for one page.
const IMAGE_CONCURRENCY: usize = 3;
/// Discovery stops judging candidates after this long and stages what
/// qualified, well inside the gather timeout: each database row costs one
/// paced read.
const DISCOVERY_BUDGET: Duration = Duration::from_secs(45);
/// Hard cap on importing one page (blocks, images, document).
pub(crate) const PAGE_IMPORT_TIMEOUT: Duration = Duration::from_secs(120);
/// Notion allows an average of three requests per second per connection.
pub(crate) const READ_INTERVAL: Duration = Duration::from_millis(334);

/// Default for hosts that have not attached a Notion reader.
pub struct NoNotionSource;

/// The session of [`NoNotionSource`]: every read reports not connected.
pub struct NoNotionSession;

impl NotionSource for NoNotionSource {
    type Session = NoNotionSession;

    fn open(&self, _: &MacroUserIdStr<'static>) -> NoNotionSession {
        NoNotionSession
    }
}

fn not_connected<T>() -> Result<T, ApiSourceError> {
    Err(ApiSourceError::NotConnected(ImportSource::Notion))
}

impl NotionSession for NoNotionSession {
    async fn owner(&self) -> Result<NotionOwner, ApiSourceError> {
        not_connected()
    }
    async fn search_pages(&self, _: Option<&str>) -> Result<NotionSearchPage, ApiSourceError> {
        not_connected()
    }
    async fn page(&self, _: &NotionId) -> Result<NotionPage, ApiSourceError> {
        not_connected()
    }
    async fn database(&self, _: &NotionId) -> Result<NotionContainer, ApiSourceError> {
        not_connected()
    }
    async fn data_source_database(&self, _: &NotionId) -> Result<NotionId, ApiSourceError> {
        not_connected()
    }
    async fn block_parent(&self, _: &NotionId) -> Result<NotionParent, ApiSourceError> {
        not_connected()
    }
    async fn children(
        &self,
        _: &NotionId,
        _: Option<&str>,
    ) -> Result<NotionBlockPage, ApiSourceError> {
        not_connected()
    }
}

/// Notion reads for one user, spaced to Notion's per-connection rate across
/// the user's batches and retried once after a throttled read.
pub(crate) struct PacedSession<N> {
    inner: N,
    pacer: Arc<Pacer>,
}

impl<N> PacedSession<N> {
    async fn paced<T>(&self, read: impl Future<Output = T>) -> T {
        self.pacer.wait_turn().await;
        read.await
    }
}

impl<N: NotionSession> NotionSession for PacedSession<N> {
    async fn owner(&self) -> Result<NotionOwner, ApiSourceError> {
        retry_rate_limited(|| self.paced(self.inner.owner())).await
    }
    async fn search_pages(&self, cursor: Option<&str>) -> Result<NotionSearchPage, ApiSourceError> {
        retry_rate_limited(|| self.paced(self.inner.search_pages(cursor))).await
    }
    async fn page(&self, id: &NotionId) -> Result<NotionPage, ApiSourceError> {
        retry_rate_limited(|| self.paced(self.inner.page(id))).await
    }
    async fn database(&self, id: &NotionId) -> Result<NotionContainer, ApiSourceError> {
        retry_rate_limited(|| self.paced(self.inner.database(id))).await
    }
    async fn data_source_database(&self, id: &NotionId) -> Result<NotionId, ApiSourceError> {
        retry_rate_limited(|| self.paced(self.inner.data_source_database(id))).await
    }
    async fn block_parent(&self, id: &NotionId) -> Result<NotionParent, ApiSourceError> {
        retry_rate_limited(|| self.paced(self.inner.block_parent(id))).await
    }
    async fn children(
        &self,
        id: &NotionId,
        cursor: Option<&str>,
    ) -> Result<NotionBlockPage, ApiSourceError> {
        retry_rate_limited(|| self.paced(self.inner.children(id, cursor))).await
    }
}

impl<R, S, C, W: SlackWorkspaceSource, A: ImportApis> ImportServiceImpl<R, S, C, W, A> {
    /// Open the user's Notion reader, paced with their other batches.
    pub(super) fn notion_session(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> PacedSession<<A::Notion as NotionSource>::Session> {
        PacedSession {
            inner: self.apis.notion().open(user),
            pacer: self.notion_pacers.pacer(user),
        }
    }
}

/// Default for hosts without static file storage: images become links.
pub struct NoImageRehoster;

impl ImageRehoster for NoImageRehoster {
    async fn rehost(&self, _: &str, _: usize) -> Result<RehostedImage, RehostError> {
        Err(RehostError::Other(anyhow::anyhow!(
            "image storage is not configured"
        )))
    }
}

/// The document name for a page: its plain title, prefixed with its emoji
/// icon when it has one.
pub(crate) fn document_name(title: &str, icon_emoji: Option<&str>) -> String {
    let title = title.trim();
    let title = if title.is_empty() { "Untitled" } else { title };
    match icon_emoji.map(str::trim).filter(|icon| !icon.is_empty()) {
        Some(icon) => format!("{icon} {title}"),
        None => title.to_string(),
    }
}

/// The ledger metadata discovery records for a page.
pub(crate) fn notion_doc_meta(page: &NotionPage, owner: &NotionOwner) -> NotionDocMeta {
    NotionDocMeta {
        title: page.title.clone(),
        url: Some(page.url.clone()),
        summary: None,
        icon_emoji: page.icon_emoji.clone(),
        last_edited_time: Some(page.last_edited_time.to_rfc3339()),
        edited_by_user: match owner {
            NotionOwner::User(id) => Some(page.last_edited_by.as_deref() == Some(id.as_str())),
            NotionOwner::NotAUser => None,
        },
        parent: Some(page.parent.clone()),
        properties: Some(document_properties(&page.properties))
            .filter(|properties| properties != &ImportedDocumentProperties::default()),
    }
}

/// Rich-text properties longer than this are body-like and skipped.
const MAX_STRING_PROPERTY_CHARS: usize = 300;
/// The link property pointing back to the page in Notion.
pub(crate) const SOURCE_PROPERTY: &str = "Source";

fn is_tag_property(name: &str) -> bool {
    matches!(
        name.trim().to_ascii_lowercase().as_str(),
        "tags" | "tag" | "labels" | "label"
    )
}

/// Map a database row's properties onto Macro property values. People,
/// relations, rollups, formulas, and files are skipped; multi-selects named
/// Tags/Tag/Labels/Label become tags.
pub(crate) fn document_properties(properties: &[NotionProperty]) -> ImportedDocumentProperties {
    let mut mapped = ImportedDocumentProperties::default();
    for property in properties {
        let name = property.name.trim();
        if name.is_empty() || name.eq_ignore_ascii_case(SOURCE_PROPERTY) {
            continue;
        }
        let value = match &property.value {
            NotionPropertyValue::Select(Some(option))
            | NotionPropertyValue::Status(Some(option)) => ImportedDocumentPropertyValue::Select {
                values: vec![option.clone()],
                multi: false,
            },
            NotionPropertyValue::MultiSelect(options) if options.is_empty() => continue,
            NotionPropertyValue::MultiSelect(options) if is_tag_property(name) => {
                mapped.tags.extend(options.iter().cloned());
                continue;
            }
            NotionPropertyValue::MultiSelect(options) => ImportedDocumentPropertyValue::Select {
                values: options.clone(),
                multi: true,
            },
            NotionPropertyValue::Date { start, .. } => ImportedDocumentPropertyValue::Date {
                value: start.clone(),
            },
            NotionPropertyValue::Checkbox(value) => {
                ImportedDocumentPropertyValue::Boolean { value: *value }
            }
            NotionPropertyValue::Number(Some(value)) => {
                ImportedDocumentPropertyValue::Number { value: *value }
            }
            NotionPropertyValue::Url(Some(url)) => ImportedDocumentPropertyValue::Link {
                urls: vec![url.clone()],
                multi: false,
            },
            NotionPropertyValue::RichText(text)
                if !text.trim().is_empty() && text.chars().count() <= MAX_STRING_PROPERTY_CHARS =>
            {
                ImportedDocumentPropertyValue::String {
                    value: text.trim().to_string(),
                }
            }
            _ => continue,
        };
        mapped.values.push(ImportedDocumentProperty {
            name: name.to_string(),
            value,
        });
    }
    mapped
}

/// A page's properties plus the **Source** link back to Notion.
fn with_source_link(
    mut properties: ImportedDocumentProperties,
    url: &str,
) -> ImportedDocumentProperties {
    properties.values.push(ImportedDocumentProperty {
        name: SOURCE_PROPERTY.to_string(),
        value: ImportedDocumentPropertyValue::Link {
            urls: vec![url.to_string()],
            multi: false,
        },
    });
    properties
}

/// Characters of body text in a page's top-level blocks.
pub(crate) fn body_text_chars(blocks: &[NotionBlock]) -> usize {
    fn text_of(kind: &NotionBlockKind) -> String {
        use NotionBlockKind as K;
        let runs = match kind {
            K::Paragraph(text)
            | K::BulletedListItem(text)
            | K::NumberedListItem(text)
            | K::Toggle(text)
            | K::Quote(text)
            | K::Heading { text, .. }
            | K::ToDo { text, .. }
            | K::Callout { text, .. }
            | K::Code { text, .. } => text,
            _ => return String::new(),
        };
        runs.iter().map(|run| run.plain_text.as_str()).collect()
    }
    blocks
        .iter()
        .map(|block| text_of(&block.kind).trim().chars().count())
        .sum()
}

/// Discover the pages to import and stage them, freshest first. A user
/// whose Notion connection is not a Pipedream one is skipped: the API path
/// needs the Pipedream connection.
pub(super) async fn gather_notion<R, S, C, W, A>(
    service: &ImportServiceImpl<R, S, C, W, A>,
    user: &MacroUserIdStr<'static>,
    mode: GatherMode,
) -> anyhow::Result<usize>
where
    R: ImportRepo + CanonicalImportRepo + Clone,
    S: ConnectorSelect,
    C: EntityCreator,
    W: SlackWorkspaceSource,
    A: ImportApis,
{
    let session = service.notion_session(user);
    let owner = match session.owner().await {
        Ok(owner) => owner,
        Err(ApiSourceError::NotConnected(_)) => {
            tracing::warn!("Notion is not connected through Pipedream; skipping Notion discovery");
            return Ok(0);
        }
        Err(error) => return Err(error.into()),
    };

    let selected = select_pages(&session).await?;

    let items = selected
        .iter()
        .map(|page| {
            Ok((
                page.id.as_str().to_string(),
                serde_json::to_value(notion_doc_meta(page, &owner))?,
            ))
        })
        .collect::<anyhow::Result<_>>()?;
    Ok(service
        .stage_discovered(user, mode, ImportSource::Notion, items)
        .await)
}

/// The pages discovery stages, freshest first: search results that are
/// not archived, database rows with a real body, at most
/// [`MAX_NOTION_PAGES`], judged within [`DISCOVERY_BUDGET`].
pub(crate) async fn select_pages(
    session: &impl NotionSession,
) -> Result<Vec<NotionPage>, ApiSourceError> {
    let deadline = tokio::time::Instant::now() + DISCOVERY_BUDGET;
    let mut selected: Vec<NotionPage> = Vec::new();
    let mut cursor: Option<String> = None;
    'search: for _ in 0..MAX_SEARCH_PAGES {
        let results = session.search_pages(cursor.as_deref()).await?;
        let candidates: Vec<NotionPage> = results
            .pages
            .into_iter()
            .filter(|page| !page.archived)
            .collect();
        // Judge in small ordered chunks so discovery stops reading as soon
        // as enough pages qualify, or its time is up.
        for chunk in candidates.chunks(CHECK_CONCURRENCY * 2) {
            if tokio::time::Instant::now() >= deadline {
                tracing::warn!(
                    selected = selected.len(),
                    "Notion discovery ran out of time"
                );
                break 'search;
            }
            let judged: Vec<Option<NotionPage>> = futures::stream::iter(chunk.iter().cloned())
                .map(|page| qualify(session, page))
                .buffered(CHECK_CONCURRENCY)
                .collect()
                .await;
            selected.extend(judged.into_iter().flatten());
            if selected.len() >= MAX_NOTION_PAGES {
                break 'search;
            }
        }
        match results.next_cursor {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }
    selected.truncate(MAX_NOTION_PAGES);
    Ok(selected)
}

/// Whether a search result is a page worth importing.
async fn qualify(session: &impl NotionSession, page: NotionPage) -> Option<NotionPage> {
    if !page.parent.is_database() {
        return Some(page);
    }
    match session.children(&page.id, None).await {
        Ok(first) if body_text_chars(&first.blocks) >= DATABASE_ROW_MIN_CHARS => Some(page),
        Ok(_) => None,
        Err(error) => {
            tracing::warn!(page = %page.id, error = ?error, "could not judge Notion database row; skipping it");
            None
        }
    }
}

/// The page facts an import needs, from discovery metadata when it
/// recorded them, otherwise read from Notion.
pub(crate) struct PageFacts {
    pub id: NotionId,
    pub title: String,
    pub icon_emoji: Option<String>,
    pub url: String,
    pub parent: NotionParent,
    pub properties: ImportedDocumentProperties,
}

impl PageFacts {
    pub(crate) fn name(&self) -> String {
        document_name(&self.title, self.icon_emoji.as_deref())
    }

    fn from_page(page: NotionPage) -> Self {
        Self {
            properties: document_properties(&page.properties),
            parent: page.parent,
            title: page.title,
            icon_emoji: page.icon_emoji,
            url: page.url,
            id: page.id,
        }
    }
}

pub(crate) async fn page_facts(
    session: &impl NotionSession,
    row: &ImportEntity,
) -> Result<PageFacts, anyhow::Error> {
    let id = NotionId::parse(&row.foreign_id)
        .ok_or_else(|| anyhow::anyhow!("not a Notion page id: {}", row.foreign_id))?;
    let meta: NotionDocMeta = serde_json::from_value(row.metadata.clone()).unwrap_or_default();
    if let Some(parent) = meta.parent.clone() {
        return Ok(PageFacts {
            url: meta.url.clone().unwrap_or_else(|| id.web_url()),
            title: meta.title.clone(),
            icon_emoji: meta.icon_emoji.clone(),
            parent,
            properties: meta.properties.clone().unwrap_or_default(),
            id,
        });
    }
    let page = session.page(&id).await.map_err(|error| match error {
        ApiSourceError::NotFound => {
            anyhow::anyhow!("the Notion page is not shared with the connection")
        }
        other => other.into(),
    })?;
    Ok(PageFacts::from_page(page))
}

/// The user's imported Notion pages, for turning links into mentions.
async fn imported_documents(
    repo: &impl ImportRepo,
    user: &MacroUserIdStr<'static>,
) -> HashMap<NotionId, LinkedDocument> {
    match repo
        .list(
            user,
            Some(ImportSource::Notion),
            Some(ImportStatus::Imported),
        )
        .await
    {
        Ok(rows) => rows
            .into_iter()
            .filter_map(|row| {
                let id = NotionId::parse(&row.foreign_id)?;
                let entity_id = row.entity_id?;
                let meta: NotionDocMeta = serde_json::from_value(row.metadata).ok()?;
                Some((
                    id,
                    LinkedDocument {
                        id: entity_id,
                        name: document_name(&meta.title, meta.icon_emoji.as_deref()),
                    },
                ))
            })
            .collect(),
        Err(error) => {
            tracing::warn!(error = ?error, "could not list imported Notion pages; links stay external");
            HashMap::new()
        }
    }
}

/// Copy a page's Notion-hosted images into Macro storage. External images
/// stay where they are; failures leave the image out of the map (it then
/// renders as a link).
async fn rehost_images(
    rehoster: &impl ImageRehoster,
    blocks: &[NotionBlock],
) -> HashMap<String, HostedImage> {
    let hosted: Vec<String> = convert::image_files(blocks)
        .into_iter()
        .filter(|file| file.hosted)
        .map(|file| file.url)
        .collect();
    futures::stream::iter(hosted)
        .map(|url| async move {
            match rehoster.rehost(&url, IMAGE_LIMIT_BYTES).await {
                Ok(image) => Some((
                    url,
                    HostedImage {
                        id: image.id,
                        url: image.url,
                        width: image.width,
                        height: image.height,
                    },
                )),
                Err(error) => {
                    tracing::info!(error = %error, "Notion image not re-hosted; linking it instead");
                    None
                }
            }
        })
        .buffered(IMAGE_CONCURRENCY)
        .filter_map(std::future::ready)
        .collect()
        .await
}

/// What importing one page produced.
pub(crate) enum PageImport {
    /// The document exists.
    Created(String),
    /// The page converted to nothing and is not imported.
    Empty,
}

/// Where a batch's pages go, and the titles links to them can use.
#[derive(Debug, Default)]
pub(crate) struct BatchPlan {
    folders: HashMap<NotionId, Vec<FolderSpec>>,
    titles: HashMap<NotionId, String>,
}

/// Read every row's page facts and plan the batch's folders. A row whose
/// facts cannot be read keeps its error for the import to report.
pub(crate) async fn plan_batch(
    session: &impl NotionSession,
    rows: &[ImportEntity],
) -> (Vec<anyhow::Result<PageFacts>>, BatchPlan) {
    let mut facts = Vec::with_capacity(rows.len());
    for row in rows {
        facts.push(page_facts(session, row).await);
    }
    let placed: Vec<PlacedPage> = facts
        .iter()
        .flatten()
        .map(|facts| PlacedPage {
            id: facts.id.clone(),
            name: facts.name(),
            parent: facts.parent.clone(),
        })
        .collect();
    let ancestry = folders::resolve_ancestry(session, &placed).await;
    let pages: Vec<NotionId> = placed.iter().map(|page| page.id.clone()).collect();
    let plan = BatchPlan {
        folders: folders::plan_folders(&pages, &ancestry),
        titles: ancestry
            .nodes
            .iter()
            .map(|(id, node)| (id.clone(), node.name.clone()))
            .collect(),
    };
    (facts, plan)
}

/// Convert one page and create its document in its planned folder. Does
/// not touch the page's ledger row.
pub(crate) async fn import_page<R, S, C, W, A>(
    service: &ImportServiceImpl<R, S, C, W, A>,
    session: &impl NotionSession,
    user: &MacroUserIdStr<'static>,
    facts: &PageFacts,
    plan: &BatchPlan,
) -> anyhow::Result<PageImport>
where
    R: ImportRepo + CanonicalImportRepo + Clone,
    S: ConnectorSelect,
    C: EntityCreator,
    W: SlackWorkspaceSource,
    A: ImportApis,
{
    let tree = fetch::fetch_tree(session, &facts.id)
        .await
        .map_err(|error| match error {
            ApiSourceError::NotFound => {
                anyhow::anyhow!("the Notion page is not shared with the connection")
            }
            other => other.into(),
        })?;
    let images = rehost_images(service.apis.images(), &tree.blocks).await;
    let context = ConvertContext {
        page_url: &facts.url,
        images,
        documents: imported_documents(&service.repo, user).await,
        titles: plan.titles.clone(),
    };
    let converted = convert::convert(&tree.blocks, tree.truncated, &context);
    if !converted.omitted.is_empty() {
        tracing::debug!(page = %facts.id, omitted = ?converted.omitted, "omitted Notion blocks");
    }
    if converted.is_empty() {
        return Ok(PageImport::Empty);
    }

    // Folders are created only now, for a document that will exist.
    let path = plan.folders.get(&facts.id).cloned().unwrap_or_default();
    let folder = match folders::ensure_folder_path(
        &service.repo,
        service.creator.as_ref(),
        &service.folder_locks,
        user,
        &path,
    )
    .await
    {
        Ok(folder) => Some(folder),
        Err(error) => {
            tracing::warn!(page = %facts.id, error = ?error, "could not prepare the Notion folder; filing at the top level");
            None
        }
    };
    let name = facts.name();
    let properties = with_source_link(facts.properties.clone(), &facts.url);
    let id = service
        .creator
        .create_markdown_doc(user, &name, &converted.markdown, &properties, folder)
        .await?;
    Ok(PageImport::Created(id))
}

/// Import one `importing` Notion row and settle it on the ledger: imported,
/// removed (an empty page is excluded, not failed), or failed with a reason.
pub(crate) async fn import_notion_row<R, S, C, W, A>(
    service: &ImportServiceImpl<R, S, C, W, A>,
    session: &impl NotionSession,
    user: &MacroUserIdStr<'static>,
    row: &ImportEntity,
    facts: &anyhow::Result<PageFacts>,
    plan: &BatchPlan,
) -> RowOutcome
where
    R: ImportRepo + CanonicalImportRepo + Clone,
    S: ConnectorSelect,
    C: EntityCreator,
    W: SlackWorkspaceSource,
    A: ImportApis,
{
    let imported = match facts {
        Ok(facts) => tokio::time::timeout(
            PAGE_IMPORT_TIMEOUT,
            import_page(service, session, user, facts, plan),
        )
        .await
        .unwrap_or_else(|_| Err(anyhow::anyhow!("the Notion page took too long to import"))),
        Err(error) => Err(anyhow::anyhow!("{error}")),
    };
    match imported {
        Ok(PageImport::Created(entity_id)) => {
            service.settle_row(user, row, Ok((entity_id, None))).await
        }
        Ok(PageImport::Empty) => {
            if let Err(error) = service.repo.remove_importing(user, row.id).await {
                tracing::error!(id = %row.id, error = ?error, "failed to remove an empty Notion page");
            }
            service.notify(user).await;
            RowOutcome::Skipped
        }
        Err(error) => service.settle_row(user, row, Err(error)).await,
    }
}

/// One row's import, boxed so the borrowed per-row futures stay `Send`
/// inside the spawned batch task.
type RowImport<'a> = std::pin::Pin<Box<dyn Future<Output = (uuid::Uuid, RowOutcome)> + Send + 'a>>;

/// Import a claimed batch of Notion rows: plan their folders together, then
/// import a few pages at a time, freshest first.
pub(crate) async fn import_notion_rows<R, S, C, W, A>(
    service: &ImportServiceImpl<R, S, C, W, A>,
    user: &MacroUserIdStr<'static>,
    rows: Vec<ImportEntity>,
    concurrency: usize,
) -> Vec<(uuid::Uuid, RowOutcome)>
where
    R: ImportRepo + CanonicalImportRepo + Clone,
    S: ConnectorSelect,
    C: EntityCreator,
    W: SlackWorkspaceSource,
    A: ImportApis,
{
    let session = service.notion_session(user);
    let (facts, plan) = plan_batch(&session, &rows).await;
    let imports: Vec<RowImport<'_>> = rows
        .iter()
        .zip(facts.iter())
        .map(|(row, facts)| {
            let import = import_notion_row(service, &session, user, row, facts, &plan);
            let id = row.id;
            Box::pin(async move { (id, import.await) }) as _
        })
        .collect();
    futures::stream::iter(imports)
        .buffered(concurrency)
        .collect()
        .await
}
