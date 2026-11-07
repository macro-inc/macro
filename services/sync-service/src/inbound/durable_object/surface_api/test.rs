use super::*;
use std::cell::{Cell, RefCell};

#[derive(Default)]
struct SnapshotStore {
    snapshot: RefCell<Option<Vec<u8>>>,
    writes: Cell<usize>,
    fail_delete: Cell<bool>,
}

impl SnapshotStorage for SnapshotStore {
    async fn store_snapshot(&self, snapshot: &[u8]) -> Result<()> {
        self.writes.set(self.writes.get() + 1);
        *self.snapshot.borrow_mut() = Some(snapshot.to_vec());
        Ok(())
    }

    async fn get_snapshot(&self) -> Result<Vec<u8>> {
        Ok(self.snapshot.borrow().clone().unwrap())
    }

    async fn has_snapshot(&self) -> Result<bool> {
        Ok(self.snapshot.borrow().is_some())
    }

    async fn delete_snapshot(&self) -> Result<()> {
        if self.fail_delete.get() {
            return Err(worker::Error::from("injected deletion failure"));
        }
        *self.snapshot.borrow_mut() = None;
        Ok(())
    }
}

#[test]
fn pending_initialization_resumes_an_identical_seed_without_rewriting() {
    futures::executor::block_on(async {
        let storage = SnapshotStore::default();
        assert!(prepare_surface_snapshot(&storage, b"seed").await.unwrap());
        // Snapshot committed, but the lifecycle write failed or the DO evicted.
        assert!(prepare_surface_snapshot(&storage, b"seed").await.unwrap());
        assert_eq!(storage.writes.get(), 1);
        assert_eq!(storage.get_snapshot().await.unwrap(), b"seed");
    });
}

#[test]
fn unknown_pending_seed_is_removed_before_allowing_a_new_initialization() {
    futures::executor::block_on(async {
        let storage = SnapshotStore::default();
        storage.store_snapshot(b"orphan").await.unwrap();
        assert!(!prepare_surface_snapshot(&storage, b"seed").await.unwrap());
        assert!(!storage.has_snapshot().await.unwrap());
        assert_eq!(storage.writes.get(), 1);
        assert!(prepare_surface_snapshot(&storage, b"seed").await.unwrap());
        assert_eq!(storage.get_snapshot().await.unwrap(), b"seed");
    });
}

#[test]
fn failed_rollback_never_overwrites_the_unidentified_snapshot() {
    futures::executor::block_on(async {
        let storage = SnapshotStore::default();
        storage.store_snapshot(b"orphan").await.unwrap();
        storage.fail_delete.set(true);
        for _ in 0..2 {
            assert!(prepare_surface_snapshot(&storage, b"seed").await.is_err());
            assert_eq!(storage.get_snapshot().await.unwrap(), b"orphan");
            assert_eq!(storage.writes.get(), 1);
        }
        storage.fail_delete.set(false);
        assert!(!prepare_surface_snapshot(&storage, b"seed").await.unwrap());
        assert!(prepare_surface_snapshot(&storage, b"seed").await.unwrap());
    });
}

#[test]
fn persisted_storage_key_discriminates_effect_dispatch_after_eviction() {
    let id = "01952cbd-76ad-7a65-9c21-020304050607";
    for kind in [SessionKind::Surface, SessionKind::Document] {
        let identity = SessionIdentity::new(kind, id).unwrap();
        assert_eq!(
            sync_server_core::domain::types::SessionKey::new(identity.storage_key()).kind(),
            kind
        );
    }
    let revoked = serde_json::to_vec(&SurfaceLifecycle::Revoked).unwrap();
    assert_eq!(
        serde_json::from_slice::<SurfaceLifecycle>(&revoked).unwrap(),
        SurfaceLifecycle::Revoked
    );
}
