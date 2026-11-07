use super::*;
use crate::domain::{
    connection::{ConnectionMetadata, SurfaceLifecycle},
    migration::{SourceState, TargetState},
    ports::UnixMillis,
    socket::WebSocketId,
    types::PendingOperation,
};
use std::{
    cell::{Cell, RefCell},
    collections::BTreeMap,
    io,
    rc::Rc,
    time::Duration,
};

type Events = Rc<RefCell<Vec<&'static str>>>;
#[derive(Default)]
struct Store {
    events: Events,
    pending: RefCell<BTreeMap<String, Vec<u8>>>,
    saved: RefCell<Option<Vec<u8>>>,
    unreadable: Cell<bool>,
    fail_archive: Cell<bool>,
    delete_count: Cell<Option<usize>>,
}
impl RoomStorage for Store {
    type Error = io::Error;
    async fn session_key(&self) -> io::Result<Option<SessionKey>> {
        Ok(None)
    }
    async fn put_session_key(&self, _: &SessionKey) -> io::Result<()> {
        Ok(())
    }
    async fn connection(&self, _: &WebSocketId) -> io::Result<Option<ConnectionMetadata>> {
        Ok(None)
    }
    async fn put_connection(&self, _: &WebSocketId, _: &ConnectionMetadata) -> io::Result<()> {
        Ok(())
    }
    async fn delete_connection(&self, _: &WebSocketId) -> io::Result<()> {
        Ok(())
    }
    async fn surface_lifecycle(&self) -> io::Result<Option<SurfaceLifecycle>> {
        Ok(None)
    }
    async fn put_surface_lifecycle(&self, _: SurfaceLifecycle) -> io::Result<()> {
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
    async fn pending_operations(&self) -> io::Result<Vec<io::Result<PendingOperation>>> {
        self.events.borrow_mut().push("pending-read");
        let mut entries: Vec<_> = self
            .pending
            .borrow()
            .iter()
            .map(|(id, update)| {
                Ok(PendingOperation {
                    id: OperationId::new(id.clone()),
                    update: update.clone(),
                })
            })
            .collect();
        if self.unreadable.get() {
            entries.push(Err(io::Error::other("unreadable entry")));
        }
        Ok(entries)
    }
    async fn put_pending_operation(&self, id: &OperationId, update: &[u8]) -> io::Result<()> {
        self.events.borrow_mut().push("pending");
        self.pending
            .borrow_mut()
            .insert(id.as_str().to_owned(), update.to_vec());
        Ok(())
    }
    async fn put_archived_operation(&self, _: &OperationId, _: &[u8]) -> io::Result<()> {
        self.events.borrow_mut().push("archive");
        if self.fail_archive.get() {
            return Err(io::Error::other("archive write failed"));
        }
        Ok(())
    }
    async fn put_operation_attribution(
        &self,
        _: &OperationId,
        _: &DocumentAttribution,
    ) -> io::Result<()> {
        self.events.borrow_mut().push("attribution");
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
            .filter(|id| pending.remove(id.as_str()).is_some())
            .count())
    }
    async fn delete_all(&self) -> io::Result<()> {
        self.pending.borrow_mut().clear();
        Ok(())
    }
}
struct TestClock(Events);
impl Clock for TestClock {
    fn monotonic(&self) -> Duration {
        self.0.borrow_mut().push("monotonic");
        Duration::from_millis(3)
    }
    fn unix_time(&self) -> UnixMillis {
        UnixMillis(0)
    }
    fn unix_nanos(&self) -> u128 {
        self.0.borrow_mut().push("nanos");
        10
    }
}
struct Snapshots {
    events: Events,
    bytes: RefCell<Option<Vec<u8>>>,
}
impl SnapshotStore for Snapshots {
    type Error = io::Error;
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
fn key() -> SessionKey {
    SessionKey::new("document".into())
}
fn log() -> OperationLog {
    OperationLog::new(key(), SessionKind::Document)
}
fn writer() -> loro::LoroDoc {
    let writer = loro::LoroDoc::new();
    writer.set_peer_id(1).unwrap();
    writer.get_text("content").push_str("base").unwrap();
    writer
}

#[test]
fn ids_keep_the_legacy_wall_time_counter_format_and_wrapping() {
    let mut ids = OrderedIds::default();
    assert_eq!(ids.next(10).as_str(), "000000000000000a.00000000");
    assert_eq!(ids.next(10).as_str(), "000000000000000a.00000001");
    ids.counter = usize::MAX;
    ids.next(10);
    assert_eq!(ids.next(10).as_str(), "000000000000000a.00000000");
}

#[test]
fn apply_imports_before_persisting_pending_archive_and_signed_attribution() {
    futures::executor::block_on(async {
        let store = Store::default();
        let clock = TestClock(store.events.clone());
        let mut log = log();
        let mut state = DocumentState::new();
        let update = writer().export(loro::ExportMode::all_updates()).unwrap();
        let attribution =
            DocumentAttribution::from_signed_claims("actor".into(), None, None).unwrap();
        let pending = log.apply(&store, &mut state, &update, Some(&attribution), &clock);
        assert_eq!(state.get_json(), "{\"content\":\"base\"}");
        assert_eq!(*store.events.borrow(), ["nanos", "monotonic"]);
        assert!(pending.await.unwrap().changed);
        assert_eq!(
            *store.events.borrow(),
            ["nanos", "monotonic", "pending", "archive", "attribution"]
        );
        assert_eq!(log.applied.len(), 1);
    });
}

#[test]
fn archive_failure_retains_the_already_persisted_applied_operation() {
    futures::executor::block_on(async {
        let store = Store::default();
        store.fail_archive.set(true);
        let clock = TestClock(store.events.clone());
        let mut log = log();
        let mut state = DocumentState::new();
        let update = writer().export(loro::ExportMode::all_updates()).unwrap();
        assert!(
            log.apply(&store, &mut state, &update, None, &clock)
                .await
                .is_err()
        );
        assert_eq!(store.pending.borrow().len(), 1);
        assert_eq!(log.applied.len(), 1);
        store.delete_count.set(Some(0));
        log.clear_applied(&store).await.unwrap();
        assert!(log.applied.is_empty());
        assert_eq!(store.pending.borrow().len(), 1);
        let events = store.events.borrow().len();
        log.clear_applied(&store).await.unwrap();
        assert_eq!(store.events.borrow().len(), events);
    });
}

#[test]
fn loading_skips_unreadable_entries_and_replays_without_marking_an_update() {
    futures::executor::block_on(async {
        let store = Store::default();
        let writer = writer();
        let snapshot = writer.export(loro::ExportMode::Snapshot).unwrap();
        let before = writer.oplog_vv();
        writer.get_text("content").push_str(" tail").unwrap();
        store.pending.borrow_mut().insert(
            "stored".into(),
            writer.export(loro::ExportMode::updates(&before)).unwrap(),
        );
        store.unreadable.set(true);
        let snapshots = Snapshots {
            events: store.events.clone(),
            bytes: RefCell::new(Some(snapshot)),
        };
        let mut log = log();
        let state = log
            .load_document_state(&store, &snapshots, false)
            .await
            .unwrap();
        assert_eq!(state.get_json(), "{\"content\":\"base tail\"}");
        assert_eq!(state.last_update, None);
        assert_eq!(
            log.applied,
            BTreeSet::from([OperationId::new("stored".into())])
        );
        assert_eq!(
            *store.events.borrow(),
            ["snapshot-read", "version-read", "pending-read"]
        );
    });
}

#[test]
fn snapshot_is_saved_before_its_version_vector() {
    futures::executor::block_on(async {
        let store = Store::default();
        let snapshots = Snapshots {
            events: store.events.clone(),
            bytes: RefCell::new(None),
        };
        let state =
            DocumentState::try_from_snapshot(&writer().export(loro::ExportMode::Snapshot).unwrap())
                .unwrap();
        let log = log();
        log.store_snapshot(&store, &snapshots, &state)
            .await
            .unwrap();
        assert_eq!(*store.events.borrow(), ["snapshot", "version"]);
        assert_eq!(
            store.saved.borrow().as_ref().unwrap(),
            &state.loro_doc.oplog_vv().encode()
        );
        assert!(snapshots.bytes.borrow().is_some());
    });
}
