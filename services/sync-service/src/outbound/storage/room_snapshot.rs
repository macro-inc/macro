use crate::{
    storage::{backends, get_snapshot_storage, snapshot::SnapshotStorage},
    timeit,
};
use std::{cell::RefCell, rc::Rc};
use sync_server_core::domain::{
    ports::{SnapshotReadError, SnapshotStore},
    types::SessionKey,
};
use tracing::trace;
use worker::{Env, State};

/// Snapshot transport preserving the existing backend selection and value types.
pub struct WorkerSnapshots {
    scope: Scope,
    state: Rc<State>,
    cached: RefCell<Option<(SessionKey, Rc<backends::Storage>)>>,
}
enum Scope {
    Fixed(Rc<backends::Storage>),
    Dynamic { env: Env, state: Rc<State> },
}
impl WorkerSnapshots {
    pub fn fixed(backend: backends::Storage, state: Rc<State>) -> Self {
        Self {
            scope: Scope::Fixed(Rc::new(backend)),
            state,
            cached: RefCell::new(None),
        }
    }
    pub fn new(env: Env, state: Rc<State>) -> Self {
        Self {
            state: state.clone(),
            scope: Scope::Dynamic { env, state },
            cached: RefCell::new(None),
        }
    }
    fn backend(&self, key: &SessionKey) -> worker::Result<Rc<backends::Storage>> {
        match &self.scope {
            Scope::Fixed(backend) => Ok(backend.clone()),
            Scope::Dynamic { env, state } => {
                if let Some((cached_key, backend)) = self.cached.borrow().as_ref()
                    && cached_key == key
                {
                    return Ok(backend.clone());
                }
                let backend = Rc::new(get_snapshot_storage(env, state, key.as_str().to_owned())?);
                *self.cached.borrow_mut() = Some((key.clone(), backend.clone()));
                Ok(backend)
            }
        }
    }
    fn export_backend(
        &self,
        operation: uuid::Uuid,
    ) -> worker::Result<backends::durable_sql::DurableSQLStorage> {
        backends::durable_sql::DurableSQLStorage::new(
            self.state.storage(),
            format!("migration-export:{operation}"),
        )
    }
}
impl SnapshotStore for WorkerSnapshots {
    type Error = worker::Error;
    async fn has(&self, key: &SessionKey) -> worker::Result<bool> {
        self.backend(key)?.has_snapshot().await
    }
    async fn get(&self, key: &SessionKey) -> Result<Vec<u8>, SnapshotReadError<worker::Error>> {
        let backend = self.backend(key).map_err(SnapshotReadError::Storage)?;
        let (bytes, elapsed) = timeit!(
            backend
                .get_snapshot()
                .await
                .map_err(SnapshotReadError::Storage)?
        );
        trace!(
            num_bytes = bytes.len(),
            duration_ms = elapsed.as_millis(),
            "get_snapshot"
        );
        Ok(bytes)
    }
    async fn put(&self, key: &SessionKey, snapshot: &[u8]) -> worker::Result<()> {
        let backend = self.backend(key)?;
        let (result, elapsed) = timeit!(backend.store_snapshot(snapshot).await?);
        trace!(
            num_bytes = snapshot.len(),
            duration_ms = elapsed.as_millis(),
            "store_snapshot"
        );
        Ok(result)
    }
    async fn delete(&self, key: &SessionKey) -> worker::Result<()> {
        self.backend(key)?.delete_snapshot().await
    }
    async fn export(
        &self,
        operation: uuid::Uuid,
    ) -> Result<Vec<u8>, SnapshotReadError<worker::Error>> {
        self.export_backend(operation)
            .map_err(SnapshotReadError::Storage)?
            .get_snapshot()
            .await
            .map_err(SnapshotReadError::Storage)
    }
    async fn put_export(&self, operation: uuid::Uuid, snapshot: &[u8]) -> worker::Result<()> {
        self.export_backend(operation)?
            .store_snapshot(snapshot)
            .await
    }
}
