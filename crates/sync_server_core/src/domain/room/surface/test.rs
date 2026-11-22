use super::*;
use crate::domain::ports::SnapshotStore as SnapshotPort;
use macro_sync_service_jwt::session::{SessionIdentity, SessionKind};
use std::io;
fn key() -> SessionKey {
    SessionKey::new("surface:test".into())
}
use std::cell::{Cell, RefCell};

#[derive(Default)]
struct SnapshotStore {
    snapshot: RefCell<Option<Vec<u8>>>,
    writes: Cell<usize>,
    fail_delete: Cell<bool>,
}

impl SnapshotPort for SnapshotStore {
    type Error = io::Error;
    fn prepare(&self, _: &SessionKey) -> io::Result<()> {
        Ok(())
    }
    async fn export(&self, _: uuid_types::Uuid) -> Result<Vec<u8>, SnapshotReadError<io::Error>> {
        panic!("unexpected migration export")
    }
    async fn put_export(&self, _: uuid_types::Uuid, _: &[u8]) -> io::Result<()> {
        panic!("unexpected migration export write")
    }
    async fn put(&self, _: &SessionKey, snapshot: &[u8]) -> io::Result<()> {
        self.writes.set(self.writes.get() + 1);
        *self.snapshot.borrow_mut() = Some(snapshot.to_vec());
        Ok(())
    }

    async fn get(&self, _: &SessionKey) -> Result<Vec<u8>, SnapshotReadError<io::Error>> {
        Ok(self.snapshot.borrow().clone().unwrap())
    }

    async fn has(&self, _: &SessionKey) -> io::Result<bool> {
        Ok(self.snapshot.borrow().is_some())
    }

    async fn delete(&self, _: &SessionKey) -> io::Result<()> {
        if self.fail_delete.get() {
            return Err(io::Error::other("injected deletion failure"));
        }
        *self.snapshot.borrow_mut() = None;
        Ok(())
    }
}

#[test]
fn pending_initialization_resumes_an_identical_seed_without_rewriting() {
    futures::executor::block_on(async {
        let storage = SnapshotStore::default();
        assert!(
            prepare_surface_snapshot(&storage, &key(), b"seed")
                .await
                .unwrap()
        );
        // Snapshot committed, but the lifecycle write failed or the DO evicted.
        assert!(
            prepare_surface_snapshot(&storage, &key(), b"seed")
                .await
                .unwrap()
        );
        assert_eq!(storage.writes.get(), 1);
        assert_eq!(storage.get(&key()).await.unwrap(), b"seed");
    });
}

#[test]
fn unknown_pending_seed_is_removed_before_allowing_a_new_initialization() {
    futures::executor::block_on(async {
        let storage = SnapshotStore::default();
        storage.put(&key(), b"orphan").await.unwrap();
        assert!(
            !prepare_surface_snapshot(&storage, &key(), b"seed")
                .await
                .unwrap()
        );
        assert!(!storage.has(&key()).await.unwrap());
        assert_eq!(storage.writes.get(), 1);
        assert!(
            prepare_surface_snapshot(&storage, &key(), b"seed")
                .await
                .unwrap()
        );
        assert_eq!(storage.get(&key()).await.unwrap(), b"seed");
    });
}

#[test]
fn failed_rollback_never_overwrites_the_unidentified_snapshot() {
    futures::executor::block_on(async {
        let storage = SnapshotStore::default();
        storage.put(&key(), b"orphan").await.unwrap();
        storage.fail_delete.set(true);
        for _ in 0..2 {
            assert!(
                prepare_surface_snapshot(&storage, &key(), b"seed")
                    .await
                    .is_err()
            );
            assert_eq!(storage.get(&key()).await.unwrap(), b"orphan");
            assert_eq!(storage.writes.get(), 1);
        }
        storage.fail_delete.set(false);
        assert!(
            !prepare_surface_snapshot(&storage, &key(), b"seed")
                .await
                .unwrap()
        );
        assert!(
            prepare_surface_snapshot(&storage, &key(), b"seed")
                .await
                .unwrap()
        );
    });
}

#[test]
fn persisted_storage_key_discriminates_effect_dispatch_after_eviction() {
    let id = "01952cbd-76ad-7a65-9c21-020304050607";
    for kind in [SessionKind::Surface, SessionKind::Document] {
        let identity = SessionIdentity::new(kind, id).unwrap();
        assert_eq!(
            crate::domain::types::SessionKey::new(identity.storage_key()).kind(),
            kind
        );
    }
    let revoked = serde_json::to_vec(&SurfaceLifecycle::Revoked).unwrap();
    assert_eq!(
        serde_json::from_slice::<SurfaceLifecycle>(&revoked).unwrap(),
        SurfaceLifecycle::Revoked
    );
}
