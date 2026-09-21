//! Durable activity ingestion followed by best-effort realtime announcement.

#[cfg(test)]
mod test;

use super::{
    models::Ingest,
    ports::{ActivityRealtimePublisher, ActivityRepo},
};

/// Orchestrates storage and realtime side effects for decoded domain activity.
pub struct ActivityMaterializer<R, P> {
    repo: R,
    realtime: P,
}

impl<R: ActivityRepo, P: ActivityRealtimePublisher> ActivityMaterializer<R, P> {
    /// Creates the materializer from persistence and announcement ports.
    pub fn new(repo: R, realtime: P) -> Self {
        Self { repo, realtime }
    }

    /// Announces only after a successful durable write. Replayed inserts retain
    /// deterministic ids; missed best-effort delivery is repaired by a fetch.
    pub async fn apply(&self, ingest: Ingest) -> Result<(), R::Err> {
        match ingest {
            Ingest::Insert(rows) => {
                self.repo.insert_activities(&rows).await?;
                self.realtime.publish_recorded(&rows).await;
            }
            Ingest::Purge(entities) => {
                if !entities.is_empty() {
                    self.repo.purge_entities(&entities).await?;
                    self.realtime.publish_invalidated().await;
                }
            }
            Ingest::Ignore => {}
        }
        Ok(())
    }
}
