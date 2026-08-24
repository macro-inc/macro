use std::{collections::HashMap, num::NonZeroU32, sync::Arc};

use activity::{
    ActivityFeedPage, ActivityOverview, ActivityReads, ActivityRecord, ActivityWindow, EntityType,
};
use async_graphql::dataloader::{DataLoader, Loader};
use chrono::{DateTime, Utc};
use futures::StreamExt;
use uuid::Uuid;

use crate::objects::GraphqlActivityEvent;

/// Keys per SQL round trip. Bounds the size of one UNNEST+LATERAL query, not
/// what a client may request: per-entity work is already bounded by
/// [`MAX_ACTIVITY_EDGE_LIMIT`], so total cost scales with what the operation
/// legitimately selected — the same posture as the other Soup edges.
const ACTIVITY_EDGE_BATCH_KEYS: usize = 500;
/// Concurrent per-limit queries per batch. Distinct limits come from client
/// field aliases; the bound keeps an aliased query from holding one pool
/// connection per alias.
const MAX_CONCURRENT_LIMIT_GROUPS: usize = 4;
/// Rows returned by the `activity` edge when no limit is given.
pub const DEFAULT_ACTIVITY_EDGE_LIMIT: i32 = 10;
/// Most rows the `activity` edge may return per entity. Deeper history
/// belongs to the viewer feed, not an entity preview.
pub const MAX_ACTIVITY_EDGE_LIMIT: i32 = 100;

/// Validate an `activity` edge limit argument and apply the default.
pub fn parse_activity_edge_limit(limit: Option<i32>) -> async_graphql::Result<u32> {
    graphql_common::parse_limit(limit, DEFAULT_ACTIVITY_EDGE_LIMIT, MAX_ACTIVITY_EDGE_LIMIT)
}

/// A request for the newest activity on one entity.
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct ActivityEdgeKey {
    /// The entity whose activity is requested.
    pub entity: model_entity::Entity<'static>,
    /// How many rows to return, newest first.
    pub limit: u32,
}

/// Result of loading activity for one entity.
#[derive(Debug, Clone)]
pub enum ActivityEdgeLoad {
    /// The entity's newest activity, possibly empty.
    Found(Vec<ActivityRecord>),
    /// An internal failure occurred. Details are logged, never exposed.
    Failed,
}

/// Opaque read failure: details are logged by the reader, never exposed.
#[derive(Debug)]
pub struct ActivityReadFailed;

/// Reader used by the lazy Soup `activity` edge.
///
/// Takes plain entity keys, no access receipts: the edge is only reachable
/// through Soup entity objects, which exist in a response only after the
/// Soup service (or the user-scoped item loader) has access-checked them.
pub trait SoupActivityEdgeReader: Send + Sync + 'static {
    /// Load the newest activity for each requested entity.
    fn entity_activity(
        &self,
        keys: Vec<ActivityEdgeKey>,
    ) -> impl Future<Output = HashMap<ActivityEdgeKey, ActivityEdgeLoad>> + Send;
}

/// Reader used by the authenticated user's activity feed.
pub trait ActivityFeedReader: Send + Sync + 'static {
    /// One page of the subject's activity, newest first, keyset-paginated
    /// on `(occurred_at, id)`. The page's `next` position is the pagination
    /// authority — the storage side derives it from raw rows so skipped
    /// corrupt rows never end the feed.
    fn subject_feed<'a>(
        &'a self,
        subject_id: &'a str,
        cursor: Option<(DateTime<Utc>, Uuid)>,
        limit: NonZeroU32,
    ) -> impl Future<Output = Result<ActivityFeedPage, ActivityReadFailed>> + Send + 'a;

    /// Aggregate the subject's activity inside one local-date window.
    fn subject_overview<'a>(
        &'a self,
        subject_id: &'a str,
        window: ActivityWindow,
    ) -> impl Future<Output = Result<ActivityOverview, ActivityReadFailed>> + Send + 'a;
}

/// Combined reader capability required by the complete activity surface —
/// one schema type parameter covers both the edge and the feed.
pub trait ActivityReader: SoupActivityEdgeReader + ActivityFeedReader {}

impl<T> ActivityReader for T where T: SoupActivityEdgeReader + ActivityFeedReader {}

/// Schema-only reader that returns no activity.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoOpActivityReader;

impl SoupActivityEdgeReader for NoOpActivityReader {
    async fn entity_activity(
        &self,
        keys: Vec<ActivityEdgeKey>,
    ) -> HashMap<ActivityEdgeKey, ActivityEdgeLoad> {
        keys.into_iter()
            .map(|key| (key, ActivityEdgeLoad::Found(Vec::new())))
            .collect()
    }
}

impl ActivityFeedReader for NoOpActivityReader {
    async fn subject_feed(
        &self,
        _subject_id: &str,
        _cursor: Option<(DateTime<Utc>, Uuid)>,
        _limit: NonZeroU32,
    ) -> Result<ActivityFeedPage, ActivityReadFailed> {
        Ok(ActivityFeedPage {
            records: Vec::new(),
            next: None,
        })
    }

    async fn subject_overview(
        &self,
        _subject_id: &str,
        window: ActivityWindow,
    ) -> Result<ActivityOverview, ActivityReadFailed> {
        Ok(ActivityOverview::empty(window))
    }
}

/// Reader backed by the activity storage port, supplied by the application
/// composition root.
pub struct ActivityPortReader<R> {
    /// The activity read port.
    reads: Arc<R>,
}

impl<R> Clone for ActivityPortReader<R> {
    fn clone(&self) -> Self {
        Self {
            reads: Arc::clone(&self.reads),
        }
    }
}

impl<R> ActivityPortReader<R> {
    /// Create a reader over the activity read port.
    pub fn new(reads: Arc<R>) -> Self {
        Self { reads }
    }
}

impl<R> SoupActivityEdgeReader for ActivityPortReader<R>
where
    R: ActivityReads + Send + Sync + 'static,
{
    async fn entity_activity(
        &self,
        keys: Vec<ActivityEdgeKey>,
    ) -> HashMap<ActivityEdgeKey, ActivityEdgeLoad> {
        // The port takes one per-entity limit per call; group keys by their
        // requested limit so differing limits still batch (one query each,
        // boundedly concurrent — in practice one field selection means one
        // distinct limit anyway).
        let mut by_limit: HashMap<u32, Vec<ActivityEdgeKey>> = HashMap::new();
        for key in keys {
            by_limit.entry(key.limit).or_default().push(key);
        }

        let groups: Vec<_> = futures::stream::iter(by_limit)
            .map(|(limit, keys)| async move {
                let entities: Vec<(EntityType, String)> = keys
                    .iter()
                    .map(|key| (key.entity.entity_type, key.entity.entity_id.to_string()))
                    .collect();
                let result = self.reads.entity_activity(&entities, limit).await;
                (limit, keys, entities, result)
            })
            .buffer_unordered(MAX_CONCURRENT_LIMIT_GROUPS)
            .collect()
            .await;

        let mut loads = HashMap::new();
        for (limit, keys, entities, result) in groups {
            match result {
                Ok(mut by_entity) => {
                    for (key, entity) in keys.into_iter().zip(entities) {
                        let records = by_entity.remove(&entity).unwrap_or_default();
                        loads.insert(key, ActivityEdgeLoad::Found(records));
                    }
                }
                Err(error) => {
                    tracing::error!(?error, limit, "bulk entity activity load failed");
                    loads.extend(keys.into_iter().map(|key| (key, ActivityEdgeLoad::Failed)));
                }
            }
        }
        loads
    }
}

impl<R> ActivityFeedReader for ActivityPortReader<R>
where
    R: ActivityReads + Send + Sync + 'static,
{
    async fn subject_feed(
        &self,
        subject_id: &str,
        cursor: Option<(DateTime<Utc>, Uuid)>,
        limit: NonZeroU32,
    ) -> Result<ActivityFeedPage, ActivityReadFailed> {
        self.reads
            .subject_feed(subject_id, cursor, limit)
            .await
            .map_err(|error| {
                tracing::error!(?error, "activity feed load failed");
                ActivityReadFailed
            })
    }

    async fn subject_overview(
        &self,
        subject_id: &str,
        window: ActivityWindow,
    ) -> Result<ActivityOverview, ActivityReadFailed> {
        self.reads
            .subject_overview(subject_id, window)
            .await
            .inspect_err(|error| {
                tracing::error!(error = ?error, "activity overview load failed");
            })
            .map_err(|_| ActivityReadFailed)
    }
}

/// DataLoader for activity attached to Soup entities.
pub struct EntityActivityLoader<R> {
    /// The batched edge reader.
    reader: R,
}

impl<R> EntityActivityLoader<R> {
    /// Create an entity-activity DataLoader.
    pub fn new(reader: R) -> Self {
        Self { reader }
    }
}

impl<R> Loader<ActivityEdgeKey> for EntityActivityLoader<R>
where
    R: SoupActivityEdgeReader,
{
    type Value = ActivityEdgeLoad;
    type Error = std::convert::Infallible;

    async fn load(
        &self,
        keys: &[ActivityEdgeKey],
    ) -> Result<HashMap<ActivityEdgeKey, Self::Value>, Self::Error> {
        Ok(self.reader.entity_activity(keys.to_vec()).await)
    }
}

/// Build an entity-activity DataLoader for one request.
pub fn entity_activity_loader<R>(reader: R) -> DataLoader<EntityActivityLoader<R>>
where
    R: SoupActivityEdgeReader,
{
    // There is deliberately no client-facing cost cap here: every
    // schema-valid selection is served, with per-entity work bounded by the
    // limit argument's validation. max_batch_size only sizes each SQL round
    // trip.
    let loader = DataLoader::new(EntityActivityLoader::new(reader), tokio::spawn)
        .max_batch_size(ACTIVITY_EDGE_BATCH_KEYS);
    // Subscription connection data outlives one payload: coalesce concurrent
    // fields, but never serve stale activity across update events.
    loader.enable_all_cache(false);
    loader
}

/// Resolve the `activity` edge for one entity through the request's
/// DataLoader. An internal read failure degrades to an empty timeline
/// (logged server-side) so an activity outage never breaks Soup queries.
pub async fn load_entity_activity<R>(
    ctx: &async_graphql::Context<'_>,
    key: ActivityEdgeKey,
) -> async_graphql::Result<Vec<GraphqlActivityEvent>>
where
    R: SoupActivityEdgeReader,
{
    let loader = ctx.data::<DataLoader<EntityActivityLoader<R>>>()?;
    match loader.load_one(key).await? {
        Some(ActivityEdgeLoad::Found(records)) => Ok(records.into_iter().map(Into::into).collect()),
        Some(ActivityEdgeLoad::Failed) | None => Ok(Vec::new()),
    }
}
