use super::*;
use macro_sync_service_jwt::session::{SurfaceClaims, SurfaceSessionKind};

const ID: &str = "01952cbd-76ad-7a65-9c21-020304050607";

fn surface_token() -> String {
    macro_sync_service_jwt::session::encode_surface(
        &SurfaceClaims {
            session_kind: SurfaceSessionKind::Surface,
            surface_id: ID.parse().unwrap(),
            user_id: Some("user".into()),
            access_level: SurfaceAccessLevel::Edit,
            actor: None,
            exp: usize::MAX / 2,
            iss: macro_sync_service_jwt::ISSUER.into(),
        },
        "secret",
    )
    .unwrap()
    .into_inner()
}

#[test]
fn same_uuid_does_not_authorize_another_session_kind() {
    let document = macro_sync_service_jwt::encode(
        &serde_json::json!({"document_id": ID, "access_level": "edit", "exp": usize::MAX / 2}),
        "secret",
    )
    .unwrap();
    let surface = SessionIdentity::new(SessionKind::Surface, ID).unwrap();
    assert!(decode_document_token(&surface_token(), "secret").is_err());
    assert!(decode_surface_token(document.as_str(), "secret", &surface).is_err());
    assert!(
        decode_document_token(document.as_str(), "secret")
            .unwrap()
            .has_document_id_access(ID)
    );
    let claims = decode_surface_token(&surface_token(), "secret", &surface).unwrap();
    assert_eq!(claims.session_kind, SessionKind::Surface);
    assert!(claims.expires_at.is_some());
    assert!(!claims.has_document_id_access(ID));
    let other =
        SessionIdentity::new(SessionKind::Surface, "01952cbd-76ad-7a65-9c21-020304050608").unwrap();
    assert!(decode_surface_token(&surface_token(), "secret", &other).is_err());
}

#[test]
fn dual_kind_document_claims_are_rejected() {
    for extra in [
        serde_json::json!({"session_kind": "surface"}),
        serde_json::json!({"surface_id": ID}),
    ] {
        let mut claims =
            serde_json::json!({"document_id": ID, "access_level": "owner", "exp": usize::MAX / 2});
        claims
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let token = macro_sync_service_jwt::encode(&claims, "secret").unwrap();
        assert!(decode_document_token(token.as_str(), "secret").is_err());
    }
}

#[test]
fn surface_writes_require_edit_without_changing_document_comment_behavior() {
    assert!(AccessLevel::Comment.can_edit_for(SessionKind::Document));
    assert!(!AccessLevel::View.can_edit_for(SessionKind::Document));
    for level in [AccessLevel::View, AccessLevel::Comment] {
        assert!(!level.can_edit_for(SessionKind::Surface));
    }
    for level in [AccessLevel::Edit, AccessLevel::Owner, AccessLevel::Admin] {
        assert!(level.can_edit_for(SessionKind::Surface));
    }
}
