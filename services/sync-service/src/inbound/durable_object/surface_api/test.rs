use super::*;
use crate::auth::AccessLevel;
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
fn hibernated_surface_metadata_retains_kind_and_strict_expiry() {
    let meta = WebSocketMetadata {
        user_id: Some("user".into()),
        access_level: AccessLevel::Edit,
        actor: Some("actor".into()),
        peer_ids: [u64::MAX].into(),
        session_kind: SessionKind::Surface,
        expires_at: Some(100),
    };
    let stored = serde_json::to_vec(&meta).unwrap();
    let restored: WebSocketMetadata = serde_json::from_slice(&stored).unwrap();
    assert!(restored.grant_active(SessionKind::Surface, 99));
    assert!(!restored.grant_active(SessionKind::Surface, 100));
    assert!(!restored.grant_active(SessionKind::Surface, 101));
    assert!(!restored.grant_active(SessionKind::Document, 99));
    assert_eq!(restored.actor, meta.actor);
    assert_eq!(restored.peer_ids, meta.peer_ids);
}

#[test]
fn legacy_metadata_is_only_valid_for_documents() {
    let legacy: WebSocketMetadata = serde_json::from_value(serde_json::json!({
        "user_id": "user", "access_level": "comment", "peer_ids": []
    }))
    .unwrap();
    assert!(legacy.grant_active(SessionKind::Document, usize::MAX));
    assert!(!legacy.grant_active(SessionKind::Surface, 0));
    let missing_expiry = WebSocketMetadata {
        session_kind: SessionKind::Surface,
        ..legacy
    };
    assert!(!missing_expiry.grant_active(SessionKind::Surface, 0));
}

#[test]
fn persisted_storage_key_discriminates_effect_dispatch_after_eviction() {
    let id = "01952cbd-76ad-7a65-9c21-020304050607";
    for kind in [SessionKind::Surface, SessionKind::Document] {
        let identity = SessionIdentity::new(kind, id).unwrap();
        assert_eq!(session_kind_from_storage_key(&identity.storage_key()), kind);
    }
    let revoked = serde_json::to_vec(&SurfaceLifecycle::Revoked).unwrap();
    assert_eq!(
        serde_json::from_slice::<SurfaceLifecycle>(&revoked).unwrap(),
        SurfaceLifecycle::Revoked
    );
}
