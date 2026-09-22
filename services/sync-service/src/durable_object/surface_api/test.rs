use super::*;
use crate::auth::AccessLevel;

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
