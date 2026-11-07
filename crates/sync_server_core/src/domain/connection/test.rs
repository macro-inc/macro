use super::*;

#[test]
fn hibernated_surface_metadata_retains_kind_and_strict_expiry() {
    let meta = ConnectionMetadata {
        agent_correlation_id: None,
        user_id: Some("user".into()),
        access_level: AccessLevel::Edit,
        actor: Some("actor".into()),
        peer_ids: [u64::MAX].into(),
        session_kind: SessionKind::Surface,
        expires_at: Some(100),
    };
    let stored = serde_json::to_vec(&meta).unwrap();
    let restored: ConnectionMetadata = serde_json::from_slice(&stored).unwrap();
    assert!(restored.grant_active(SessionKind::Surface, 99));
    assert!(!restored.grant_active(SessionKind::Surface, 100));
    assert!(!restored.grant_active(SessionKind::Surface, 101));
    assert!(!restored.grant_active(SessionKind::Document, 99));
    assert_eq!(restored.actor, meta.actor);
    assert_eq!(restored.peer_ids, meta.peer_ids);
}

#[test]
fn legacy_metadata_is_only_valid_for_documents() {
    let legacy: ConnectionMetadata = serde_json::from_value(serde_json::json!({
        "user_id": "user", "access_level": "comment", "peer_ids": []
    }))
    .unwrap();
    assert!(legacy.grant_active(SessionKind::Document, u64::MAX));
    assert!(!legacy.grant_active(SessionKind::Surface, 0));
    let missing_expiry = ConnectionMetadata {
        agent_correlation_id: None,
        session_kind: SessionKind::Surface,
        ..legacy
    };
    assert!(!missing_expiry.grant_active(SessionKind::Surface, 0));
}

#[test]
fn signed_actor_filters_random_agent_ids_and_preserves_legacy_ai_filter() {
    let mut metadata = ConnectionMetadata {
        agent_correlation_id: None,
        user_id: Some("user".into()),
        access_level: AccessLevel::Edit,
        actor: Some("bot|agent".into()),
        peer_ids: BTreeSet::from([42, crate::domain::ai_peer::AI_PEER_BASE]),
        session_kind: SessionKind::Document,
        expires_at: None,
    };
    assert!(metadata.active_peer_ids(false).is_empty());
    assert_eq!(
        metadata.active_peer_ids(true),
        vec![42, crate::domain::ai_peer::AI_PEER_BASE]
    );
    metadata.actor = None;
    assert_eq!(metadata.active_peer_ids(false), vec![42]);
}

#[test]
fn write_access_uses_the_supplied_expiry_boundary() {
    let mut metadata = ConnectionMetadata {
        agent_correlation_id: None,
        user_id: None,
        access_level: AccessLevel::Edit,
        actor: None,
        peer_ids: BTreeSet::new(),
        session_kind: SessionKind::Surface,
        expires_at: Some(100),
    };
    assert_eq!(metadata.write_access(99), WriteAccess::Full);
    assert_eq!(metadata.write_access(100), WriteAccess::None);
    metadata.session_kind = SessionKind::Document;
    assert_eq!(metadata.write_access(100), WriteAccess::Full);
}
