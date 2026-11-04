//! Projection composition for the streamed sync's writes in both cache hosts
//! (`cache-wasm` and the native `graphql_cache_plugin`): what a synced page
//! and a membership lane's deletions add to the predicate index. They compose
//! the same projections as the hosts' own hydration and server deletions.

use crate::mail::ProjectionError;
use crate::{
    SoupFilterCacheAdapterError, WritePassError, WriteResponse,
    authoritative_projection_mutations_for, notification_deletion_updates, write_passes,
};
use cache_core::engine::{Engine, EngineError, PassReads};
use cache_core::predicate::{PredicateIndexStorage, ProjectionMutation};
use cache_core::store::DurableRead;
use predicate_index::RecordKey;

/// Why projection composition failed; storage errors keep their reset marker.
#[derive(Debug, thiserror::Error)]
pub enum ProjectionFailure<E: std::error::Error + 'static> {
    /// Reading the bound identity failed.
    #[error(transparent)]
    Engine(EngineError<E>),
    /// Invalid GraphQL input or notification evidence.
    #[error(transparent)]
    Adapter(SoupFilterCacheAdapterError),
    /// The notification, Mail or property pass failed.
    #[error(transparent)]
    Passes(WritePassError<E>),
    /// A deletion's Mail or property projection failed, possibly in storage.
    #[error(transparent)]
    Projection(ProjectionError<E>),
}

/// Whether a write tagged `identity` composes with stored projections: a new
/// viewer's partial writes never compose with the old viewer's data. The
/// engine still owns the atomic identity reset itself.
pub async fn reuses_stored_identity<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
    identity: Option<&str>,
) -> Result<bool, EngineError<S::Error>> {
    let Some(observed) = identity else {
        return Ok(true);
    };
    let bound = engine.current_identity().await?;
    Ok(bound.as_deref().is_none_or(|bound| bound == observed))
}

/// Projection mutations written atomically with an authoritative response,
/// for an operation the caller already parsed (a streamed sync lane parses
/// its query once per run). Build `response` with
/// [`WriteResponse::with_updates`] when the records are already normalized.
pub async fn write_projections<S>(
    engine: &mut Engine<S>,
    operation: &cache_core::document::Operation,
    response: &WriteResponse<'_>,
    reuse_stored_identity: bool,
) -> Result<Vec<ProjectionMutation>, ProjectionFailure<S::Error>>
where
    S: PredicateIndexStorage,
    for<'a> PassReads<'a, S>: DurableRead<Error = S::Error>,
{
    let projections = authoritative_projection_mutations_for(
        response.schema(),
        operation,
        response.operation(),
        response.data(),
    )
    .map_err(ProjectionFailure::Adapter)?;
    write_passes(engine, response, reuse_stored_identity, projections)
        .await
        .map_err(ProjectionFailure::Passes)
}

/// Projection mutations for records deleted by an explicit server deletion.
pub async fn deletion_projections<S: PredicateIndexStorage>(
    engine: &Engine<S>,
    keys: &[String],
) -> Result<Vec<ProjectionMutation>, ProjectionFailure<S::Error>> {
    let storage = engine.storage();
    let mut projections = notification_deletion_updates(storage, keys, false)
        .await
        .map_err(ProjectionFailure::Adapter)?;
    projections.extend(
        keys.iter()
            .filter_map(|key| RecordKey::new(key.clone()).ok())
            .map(ProjectionMutation::Delete),
    );
    projections.extend(
        crate::properties::deletion_updates(storage, keys)
            .await
            .map_err(ProjectionFailure::Projection)?,
    );
    Ok(crate::properties::current_mutations(projections))
}
