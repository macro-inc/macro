//! The projection passes of one network write, reading storage once.

use crate::mail::ProjectionError;
use crate::{SoupFilterCacheAdapterError, WriteResponse, mail, notifications, properties};
use cache_core::engine::{Engine, PassReads};
use cache_core::predicate::{PredicateIndexStorage, ProjectionMutation};
use cache_core::store::DurableRead;

/// Why the projection passes of a write failed.
#[derive(Debug, thiserror::Error)]
pub enum WritePassError<E: std::error::Error + 'static> {
    /// The notification pass.
    #[error(transparent)]
    Notification(SoupFilterCacheAdapterError),
    /// The Mail or property pass.
    #[error(transparent)]
    Projection(ProjectionError<E>),
}

/// Runs the notification pass (when `reuse_stored_identity`), then the Mail
/// and property passes over `response`, after `projections`. The passes read
/// through the engine's hot tier, and the engine keeps what they read from
/// storage for the write that follows, so that write does not read it again.
pub async fn write_passes<S>(
    engine: &mut Engine<S>,
    response: &WriteResponse<'_>,
    reuse_stored_identity: bool,
    mut projections: Vec<ProjectionMutation>,
) -> Result<Vec<ProjectionMutation>, WritePassError<S::Error>>
where
    S: PredicateIndexStorage,
    for<'a> PassReads<'a, S>: DurableRead<Error = S::Error>,
{
    let reads = engine.pass_reads();
    if reuse_stored_identity {
        projections.extend(
            notifications::notification_projection_updates_for(&reads, response)
                .await
                .map_err(WritePassError::Notification)?,
        );
    }
    projections.extend(
        mail::projection_updates_for_response(&reads, response, reuse_stored_identity)
            .await
            .map_err(WritePassError::Projection)?,
    );
    let projections = properties::augment_authoritative_response(
        &reads,
        response,
        reuse_stored_identity,
        projections,
    )
    .await
    .map_err(WritePassError::Projection)?;
    let reads = reads.finish();
    engine.keep_pass_reads(reads);
    Ok(projections)
}
