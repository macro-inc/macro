//! Persist activity facts before announcing their availability to readers.
use super::{
    models::Ingest,
    ports::{ActivityObserver, ActivityRepo},
};
use std::sync::Arc;

#[cfg(test)]
mod test;

/// Activity ingestion policy, independent of Kafka and realtime transports.
pub struct ActivityMaterializer<R> {
    repo: R,
    observer: Option<Arc<dyn ActivityObserver>>,
}

impl<R: ActivityRepo> ActivityMaterializer<R> {
    /// Compose the durable store.
    pub fn new(repo: R) -> Self {
        Self {
            repo,
            observer: None,
        }
    }

    /// Attach best-effort notifications for committed facts.
    pub fn with_observer(mut self, observer: impl ActivityObserver + 'static) -> Self {
        self.observer = Some(Arc::new(observer));
        self
    }

    /// Apply domain-derived facts. Observers never see an uncommitted insert.
    pub async fn apply(&self, ingest: Ingest) -> Result<(), R::Err> {
        match ingest {
            Ingest::Insert(activities) => {
                self.repo.insert_activities(&activities).await?;
                if let Some(observer) = &self.observer {
                    observer.persisted(&activities).await;
                }
                Ok(())
            }
            Ingest::Purge(entities) => self.repo.purge_entities(&entities).await,
            Ingest::Ignore => Ok(()),
        }
    }
}
