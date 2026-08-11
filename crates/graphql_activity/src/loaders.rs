use std::{collections::HashMap, sync::Arc};

use activity::{ActivityReads, ActivityRecord, EntityType};
use async_graphql::dataloader::{DataLoader, Loader};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::objects::GraphqlActivityEvent;

/// Most entity-activity keys one GraphQL operation may load.
const MAX_ACTIVITY_EDGE_KEYS: usize = 100;
/// Most activity rows one GraphQL operation may request across all keys.
const MAX_ACTIVITY_EDGE_ROWS: usize = 1000;
/// Rows returned by the `activity` edge when no limit is given.
pub const DEFAULT_ACTIVITY_EDGE_LIMIT: i32 = 10;
/// Most rows the `activity` edge may return per entity. Deeper history
/// belongs to the viewer feed, not an entity preview.
pub const MAX_ACTIVITY_EDGE_LIMIT: i32 = 100;

/// Validate an `activity` edge limit argument and apply the default.
pub fn parse_activity_edge_limit(limit: Option<i32>) -> async_graphql::Result<u32> {
    let limit = limit.unwrap_or(DEFAULT_ACTIVITY_EDGE_LIMIT);
    if limit <= 0 {
        return Err(async_graphql::Error::new("limit must be positive"));
    }
    if limit > MAX_ACTIVITY_EDGE_LIMIT {
        return Err(async_graphql::Error::new(format!(
            "limit must not exceed {MAX_ACTIVITY_EDGE_LIMIT}"
        )));
    }
    Ok(u32::try_from(limit).expect("positive GraphQL Int fits in u32"))
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
    /// on `(occurred_at, id)`.
    fn subject_feed<'a>(
        &'a self,
        subject_id: &'a str,
        cursor: Option<(DateTime<Utc>, Uuid)>,
        limit: u32,
    ) -> impl Future<Output = Result<Vec<ActivityRecord>, ActivityReadFailed>> + Send + 'a;
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
        _limit: u32,
    ) -> Result<Vec<ActivityRecord>, ActivityReadFailed> {
        Ok(Vec::new())
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
        // and in practice one field selection means one distinct limit).
        let mut by_limit: HashMap<u32, Vec<ActivityEdgeKey>> = HashMap::new();
        for key in keys {
            by_limit.entry(key.limit).or_default().push(key);
        }

        let mut loads = HashMap::new();
        for (limit, keys) in by_limit {
            let entities: Vec<(EntityType, String)> = keys
                .iter()
                .map(|key| (key.entity.entity_type, key.entity.entity_id.to_string()))
                .collect();
            match self.reads.entity_activity(&entities, limit).await {
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
        limit: u32,
    ) -> Result<Vec<ActivityRecord>, ActivityReadFailed> {
        self.reads
            .subject_feed(subject_id, cursor, limit)
            .await
            .map_err(|error| {
                tracing::error!(?error, "activity feed load failed");
                ActivityReadFailed
            })
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

/// Error returned when a GraphQL operation exceeds the activity cost cap.
#[derive(Debug)]
pub struct ActivityEdgeLoaderError {
    /// How many keys the operation requested.
    key_count: usize,
    /// How many rows the operation requested across all keys.
    row_count: usize,
}

impl std::fmt::Display for ActivityEdgeLoaderError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.key_count > MAX_ACTIVITY_EDGE_KEYS {
            return write!(
                formatter,
                "activity edge supports at most {MAX_ACTIVITY_EDGE_KEYS} entities per operation (received {})",
                self.key_count
            );
        }

        write!(
            formatter,
            "activity edge supports at most {MAX_ACTIVITY_EDGE_ROWS} requested rows per operation (received {})",
            self.row_count
        )
    }
}

impl std::error::Error for ActivityEdgeLoaderError {}

impl<R> Loader<ActivityEdgeKey> for EntityActivityLoader<R>
where
    R: SoupActivityEdgeReader,
{
    type Value = ActivityEdgeLoad;
    type Error = Arc<ActivityEdgeLoaderError>;

    async fn load(
        &self,
        keys: &[ActivityEdgeKey],
    ) -> Result<HashMap<ActivityEdgeKey, Self::Value>, Self::Error> {
        let row_count: usize = keys.iter().map(|key| key.limit as usize).sum();
        if keys.len() > MAX_ACTIVITY_EDGE_KEYS || row_count > MAX_ACTIVITY_EDGE_ROWS {
            tracing::warn!(
                key_count = keys.len(),
                row_count,
                max_key_count = MAX_ACTIVITY_EDGE_KEYS,
                max_row_count = MAX_ACTIVITY_EDGE_ROWS,
                "rejecting oversized Soup activity batch"
            );
            return Err(Arc::new(ActivityEdgeLoaderError {
                key_count: keys.len(),
                row_count,
            }));
        }

        Ok(self.reader.entity_activity(keys.to_vec()).await)
    }
}

/// Build an entity-activity DataLoader for one request.
pub fn entity_activity_loader<R>(reader: R) -> DataLoader<EntityActivityLoader<R>>
where
    R: SoupActivityEdgeReader,
{
    let loader = DataLoader::new(EntityActivityLoader::new(reader), tokio::spawn)
        .max_batch_size(MAX_ACTIVITY_EDGE_KEYS);
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
        Some(ActivityEdgeLoad::Found(records)) => {
            Ok(records.into_iter().map(Into::into).collect())
        }
        Some(ActivityEdgeLoad::Failed) | None => Ok(Vec::new()),
    }
}
