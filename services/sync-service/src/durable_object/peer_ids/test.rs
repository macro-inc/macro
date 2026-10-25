use super::*;
use crate::auth::AccessLevel;
use macro_sync_service_jwt::session::SessionKind;
use std::collections::BTreeSet;

#[test]
fn signed_actor_filters_random_agent_ids_and_preserves_legacy_ai_filter() {
    let mut metadata = WebSocketMetadata {
        user_id: Some("user".into()),
        access_level: AccessLevel::Edit,
        actor: Some("bot|agent".into()),
        peer_ids: BTreeSet::from([42, crate::ai_peer::AI_PEER_BASE]),
        session_kind: SessionKind::Document,
        expires_at: None,
    };
    assert!(metadata.active_peer_ids(false).is_empty());
    assert_eq!(
        metadata.active_peer_ids(true),
        vec![42, crate::ai_peer::AI_PEER_BASE]
    );
    metadata.actor = None;
    assert_eq!(metadata.active_peer_ids(false), vec![42]);
}
