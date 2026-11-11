use crate::domain::{
    connection::{ConnectionMetadata, SurfaceLifecycle},
    migration::{SourceState, TargetState},
    ports::UnixMillis,
    socket::WebSocketId,
    types::{OperationArchive, PendingOperation},
};
use crate::domain::{
    document::DocumentAttribution,
    ports::*,
    types::{OperationId, SessionKey},
};
use crate::domain::{fanout::FanoutDebt, types::PendingOperations};
use std::{
    cell::{Cell, RefCell},
    collections::BTreeMap,
    io,
    rc::Rc,
    time::Duration,
};

pub(crate) type Events = Rc<RefCell<Vec<&'static str>>>;
#[derive(Default)]
pub(crate) struct Store {
    pub(crate) identity: RefCell<Option<SessionKey>>,
    pub(crate) metadata: RefCell<BTreeMap<WebSocketId, ConnectionMetadata>>,
    pub(crate) lifecycle: Cell<Option<SurfaceLifecycle>>,
    pub(crate) events: Events,
    pub(crate) pending: RefCell<BTreeMap<String, Vec<u8>>>,
    pub(crate) archive_writes: Cell<bool>,
    pub(crate) attributions: RefCell<BTreeMap<String, DocumentAttribution>>,
    pub(crate) archives: RefCell<BTreeMap<String, Vec<u8>>>,
    pub(crate) archive_status: RefCell<BTreeMap<String, OperationArchive>>,
    pub(crate) saved: RefCell<Option<Vec<u8>>>,
    pub(crate) fanout: RefCell<Option<FanoutDebt>>,
    pub(crate) unreadable: Cell<bool>,
    pub(crate) fail_pending: Cell<bool>,
    pub(crate) fail_fanout_delete: Cell<bool>,
    pub(crate) fail_archive: Cell<bool>,
    pub(crate) delete_count: Cell<Option<usize>>,
}
impl RoomStorage for Store {
    type Error = io::Error;
    async fn session_key(&self) -> io::Result<Option<SessionKey>> {
        Ok(self.identity.borrow().clone())
    }
    async fn put_session_key(&self, key: &SessionKey) -> io::Result<()> {
        *self.identity.borrow_mut() = Some(key.clone());
        Ok(())
    }
    async fn connection(&self, id: &WebSocketId) -> io::Result<Option<ConnectionMetadata>> {
        Ok(self.metadata.borrow().get(id).cloned())
    }
    async fn put_connection(
        &self,
        id: &WebSocketId,
        metadata: &ConnectionMetadata,
    ) -> io::Result<()> {
        self.metadata
            .borrow_mut()
            .insert(id.clone(), metadata.clone());
        Ok(())
    }
    async fn delete_connection(&self, _: &WebSocketId) -> io::Result<()> {
        Ok(())
    }
    async fn surface_lifecycle(&self) -> io::Result<Option<SurfaceLifecycle>> {
        Ok(self.lifecycle.get())
    }
    async fn put_surface_lifecycle(&self, lifecycle: SurfaceLifecycle) -> io::Result<()> {
        self.events.borrow_mut().push("lifecycle");
        self.lifecycle.set(Some(lifecycle));
        Ok(())
    }
    async fn source_migration(&self) -> io::Result<Option<SourceState>> {
        Ok(None)
    }
    async fn put_source_migration(&self, _: &SourceState) -> io::Result<()> {
        Ok(())
    }
    async fn target_migration(&self) -> io::Result<Option<TargetState>> {
        Ok(None)
    }
    async fn put_target_migration(&self, _: &TargetState) -> io::Result<()> {
        Ok(())
    }
    async fn saved_version_vector(&self) -> io::Result<Option<Vec<u8>>> {
        self.events.borrow_mut().push("version-read");
        Ok(self.saved.borrow().clone())
    }
    async fn put_saved_version_vector(&self, encoded: &[u8]) -> io::Result<()> {
        self.events.borrow_mut().push("version");
        *self.saved.borrow_mut() = Some(encoded.to_vec());
        Ok(())
    }
    async fn pending_operations(&self) -> io::Result<PendingOperations<io::Error>> {
        self.events.borrow_mut().push("pending-read");
        let mut entries: Vec<_> = self
            .pending
            .borrow()
            .iter()
            .map(|(id, update)| {
                Ok(PendingOperation {
                    id: OperationId::new(id.clone()),
                    update: update.clone(),
                    archive: self
                        .archive_status
                        .borrow()
                        .get(id)
                        .cloned()
                        .unwrap_or_default(),
                })
            })
            .collect();
        if self.unreadable.get() {
            entries.push(Err(io::Error::other("unreadable entry")));
        }
        Ok(PendingOperations {
            entries,
            fanout: self.fanout.borrow().clone(),
        })
    }
    async fn put_fanout_debt(&self, debt: &FanoutDebt) -> io::Result<()> {
        self.events.borrow_mut().push("fanout-put");
        *self.fanout.borrow_mut() = Some(debt.clone());
        Ok(())
    }
    async fn delete_fanout_debt(&self) -> io::Result<()> {
        self.events.borrow_mut().push("fanout-delete");
        if self.fail_fanout_delete.get() {
            return Err(io::Error::other("fanout delete failed"));
        }
        self.fanout.borrow_mut().take();
        Ok(())
    }
    fn operation_archive_writes(&self) -> bool {
        self.archive_writes.get()
    }
    async fn complete_operation_archive(&self, id: &OperationId) -> io::Result<()> {
        if self.archive_writes.get() {
            self.events.borrow_mut().push("archive-complete");
            self.archive_status
                .borrow_mut()
                .insert(id.as_str().to_owned(), OperationArchive::Complete);
        }
        Ok(())
    }
    async fn put_complete_operation(
        &self,
        id: &OperationId,
        update: &[u8],
        attribution: Option<&DocumentAttribution>,
    ) -> Result<(), OperationAppendError<io::Error>> {
        self.events.borrow_mut().push("append");
        if self.fail_pending.get() {
            return Err(OperationAppendError::Pending(io::Error::other(
                "pending write failed",
            )));
        }
        if self.fail_archive.get() {
            return Err(OperationAppendError::Archive(io::Error::other(
                "archive write failed",
            )));
        }
        self.pending
            .borrow_mut()
            .insert(id.as_str().to_owned(), update.to_vec());
        self.archives
            .borrow_mut()
            .insert(id.as_str().to_owned(), update.to_vec());
        if let Some(attribution) = attribution {
            self.attributions
                .borrow_mut()
                .insert(id.as_str().to_owned(), attribution.clone());
        }
        self.archive_status
            .borrow_mut()
            .insert(id.as_str().to_owned(), OperationArchive::Complete);
        Ok(())
    }
    async fn put_pending_operation(
        &self,
        id: &OperationId,
        update: &[u8],
        attribution: Option<&DocumentAttribution>,
    ) -> io::Result<()> {
        self.events.borrow_mut().push("pending");
        self.pending
            .borrow_mut()
            .insert(id.as_str().to_owned(), update.to_vec());
        if self.archive_writes.get() {
            self.archive_status.borrow_mut().insert(
                id.as_str().to_owned(),
                OperationArchive::Incomplete {
                    attribution: attribution.cloned(),
                },
            );
        }
        Ok(())
    }
    async fn put_archived_operation(&self, id: &OperationId, update: &[u8]) -> io::Result<()> {
        self.events.borrow_mut().push("archive");
        if self.fail_archive.get() {
            return Err(io::Error::other("archive write failed"));
        }
        self.archives
            .borrow_mut()
            .insert(id.as_str().to_owned(), update.to_vec());
        Ok(())
    }
    async fn put_operation_attribution(
        &self,
        id: &OperationId,
        attribution: &DocumentAttribution,
    ) -> io::Result<()> {
        self.events.borrow_mut().push("attribution");
        self.attributions
            .borrow_mut()
            .insert(id.as_str().to_owned(), attribution.clone());
        Ok(())
    }
    async fn delete_pending_operations(&self, ids: &[OperationId]) -> io::Result<usize> {
        self.events.borrow_mut().push("delete");
        if let Some(count) = self.delete_count.get() {
            return Ok(count);
        }
        let mut pending = self.pending.borrow_mut();
        Ok(ids
            .iter()
            .filter(|id| {
                self.archive_status.borrow_mut().remove(id.as_str());
                pending.remove(id.as_str()).is_some()
            })
            .count())
    }
    async fn delete_all(&self) -> io::Result<()> {
        self.events.borrow_mut().push("delete-all");
        self.identity.borrow_mut().take();
        self.metadata.borrow_mut().clear();
        self.lifecycle.set(None);
        self.saved.borrow_mut().take();
        self.pending.borrow_mut().clear();
        self.archives.borrow_mut().clear();
        self.attributions.borrow_mut().clear();
        self.archive_status.borrow_mut().clear();
        Ok(())
    }
}
pub(crate) struct TestClock(pub(crate) Events);
impl Clock for TestClock {
    fn monotonic(&self) -> Duration {
        self.0.borrow_mut().push("monotonic");
        Duration::from_millis(3)
    }
    fn unix_time(&self) -> UnixMillis {
        UnixMillis(0)
    }
    fn unix_time_for(&self, _: crate::domain::ports::WallClock) -> UnixMillis {
        self.unix_time()
    }
    fn unix_nanos(&self) -> u128 {
        self.0.borrow_mut().push("nanos");
        10
    }
}
pub(crate) struct Snapshots {
    pub(crate) events: Events,
    pub(crate) bytes: RefCell<Option<Vec<u8>>>,
}
impl SnapshotStore for Snapshots {
    type Error = io::Error;
    fn prepare(&self, _: &SessionKey) -> io::Result<()> {
        self.events.borrow_mut().push("prepare");
        Ok(())
    }
    async fn has(&self, _: &SessionKey) -> io::Result<bool> {
        Ok(self.bytes.borrow().is_some())
    }
    async fn get(&self, _: &SessionKey) -> Result<Vec<u8>, SnapshotReadError<io::Error>> {
        self.events.borrow_mut().push("snapshot-read");
        self.bytes
            .borrow()
            .clone()
            .ok_or(SnapshotReadError::Missing)
    }
    async fn put(&self, _: &SessionKey, snapshot: &[u8]) -> io::Result<()> {
        self.events.borrow_mut().push("snapshot");
        *self.bytes.borrow_mut() = Some(snapshot.to_vec());
        Ok(())
    }
    async fn delete(&self, _: &SessionKey) -> io::Result<()> {
        self.events.borrow_mut().push("delete-snapshot");
        *self.bytes.borrow_mut() = None;
        Ok(())
    }
    async fn export(&self, _: uuid_types::Uuid) -> Result<Vec<u8>, SnapshotReadError<io::Error>> {
        self.bytes
            .borrow()
            .clone()
            .ok_or(SnapshotReadError::Missing)
    }
    async fn put_export(&self, _: uuid_types::Uuid, snapshot: &[u8]) -> io::Result<()> {
        *self.bytes.borrow_mut() = Some(snapshot.to_vec());
        Ok(())
    }
}
