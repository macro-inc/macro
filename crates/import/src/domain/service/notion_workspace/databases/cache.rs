//! Attempt-scoped metadata memoization. Page bodies and rows are never retained.

use std::collections::HashMap;
use std::future::Future;
use std::hash::Hash;
use std::sync::Arc;

use futures::FutureExt;
use import_notion::domain::model::*;
use import_notion::domain::ports::{NotionApi, NotionError};
use import_notion::domain::views::{NotionView, ViewScope};
use tokio::sync::{Mutex, OnceCell};

struct Metadata<Key, Value> {
    cells: Mutex<HashMap<Key, Arc<OnceCell<Value>>>>,
}
impl<Key, Value> Metadata<Key, Value> {
    fn new() -> Self {
        Self {
            cells: Mutex::new(HashMap::new()),
        }
    }
}
impl<Key: Eq + Hash + Send, Value: Clone + Send + Sync> Metadata<Key, Value> {
    #[tracing::instrument(name = "notion.metadata_cache", skip_all, fields(cache_hit = tracing::field::Empty, failed = tracing::field::Empty))]
    async fn get<Fetch, Read>(&self, key: Key, fetch: Fetch) -> Result<Value, NotionError>
    where
        Fetch: FnOnce() -> Read + Send,
        Read: Future<Output = Result<Value, NotionError>> + Send,
    {
        let cell = self
            .cells
            .lock()
            .await
            .entry(key)
            .or_insert_with(|| Arc::new(OnceCell::new()))
            .clone();
        let mut fetched = false;
        // Failed reads never initialize the cell: a transient error must remain retryable.
        let result = cell
            .get_or_try_init(|| {
                fetched = true;
                fetch()
            })
            .boxed()
            .await
            .cloned();
        tracing::Span::current().record("cache_hit", !fetched);
        tracing::Span::current().record("failed", result.is_err());
        result
    }
}

pub(in crate::domain::service::notion_workspace) struct CachedNotion<Api> {
    pub(super) inner: Api,
    sources: Metadata<NotionId, NotionDataSource>,
    containers: Metadata<NotionId, Vec<NotionId>>,
    view_lists: Metadata<(ViewScope, Option<String>), Paged<NotionId>>,
    views: Metadata<NotionId, NotionView>,
}
impl<Api> CachedNotion<Api> {
    pub fn new(inner: Api) -> Self {
        Self {
            inner,
            sources: Metadata::new(),
            containers: Metadata::new(),
            view_lists: Metadata::new(),
            views: Metadata::new(),
        }
    }
    /// Inventory already read these schemas; dependency enrichment only needs their ownership.
    pub async fn seed_sources(&self, sources: &[DataSourceSummary]) {
        let mut cells = self.sources.cells.lock().await;
        for summary in sources {
            cells
                .entry(summary.source.id.clone())
                .or_insert_with(|| Arc::new(OnceCell::new_with(Some(summary.source.clone()))));
        }
    }
    /// Preserve the write-time schema re-read after all reservation snapshots are complete.
    pub async fn refresh_sources(&self) {
        self.sources.cells.lock().await.clear();
    }
}
impl<Api: NotionApi> CachedNotion<Api> {
    /// One uncached read proves health after the reservation pass failed elsewhere.
    #[tracing::instrument(name = "notion.probe_source_health", skip_all, fields(source_id = %id, reads = tracing::field::Empty, healthy = tracing::field::Empty))]
    pub async fn source_responds(&self, id: &NotionId) -> bool {
        tracing::Span::current().record("reads", 1);
        let healthy = self.inner.data_source(id).await.is_ok();
        tracing::Span::current().record("healthy", healthy);
        healthy
    }
}

impl<Api: NotionApi> NotionApi for CachedNotion<Api> {
    async fn search(
        &self,
        object: SearchObject,
        cursor: Option<String>,
    ) -> Result<Paged<SearchHit>, NotionError> {
        self.inner.search(object, cursor).await
    }
    async fn page(&self, id: &NotionId) -> Result<NotionPage, NotionError> {
        self.inner.page(id).await
    }
    async fn page_markdown(&self, id: &NotionId) -> Result<PageMarkdown, NotionError> {
        self.inner.page_markdown(id).await
    }
    async fn data_source(&self, id: &NotionId) -> Result<NotionDataSource, NotionError> {
        self.sources
            .get(id.clone(), || self.inner.data_source(id))
            .await
    }
    async fn database_sources(&self, id: &NotionId) -> Result<Vec<NotionId>, NotionError> {
        self.containers
            .get(id.clone(), || self.inner.database_sources(id))
            .await
    }
    async fn list_views(
        &self,
        scope: &ViewScope,
        cursor: Option<String>,
    ) -> Result<Paged<NotionId>, NotionError> {
        self.view_lists
            .get((scope.clone(), cursor.clone()), || {
                self.inner.list_views(scope, cursor)
            })
            .await
    }
    async fn retrieve_view(&self, id: &NotionId) -> Result<NotionView, NotionError> {
        self.views
            .get(id.clone(), || self.inner.retrieve_view(id))
            .await
    }
    async fn query_data_source(
        &self,
        id: &NotionId,
        cursor: Option<String>,
    ) -> Result<RowsPage, NotionError> {
        self.inner.query_data_source(id, cursor).await
    }
    async fn users(&self, cursor: Option<String>) -> Result<Paged<NotionUser>, NotionError> {
        self.inner.users(cursor).await
    }
}
