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
fn document_comment_grants_write_only_comment_marks_and_surfaces_require_edit() {
    assert_eq!(
        AccessLevel::Comment.write_access_for(SessionKind::Document),
        WriteAccess::CommentMarks
    );
    assert_eq!(
        AccessLevel::View.write_access_for(SessionKind::Document),
        WriteAccess::None
    );
    for level in [AccessLevel::View, AccessLevel::Comment] {
        assert_eq!(
            level.write_access_for(SessionKind::Surface),
            WriteAccess::None
        );
    }
    for kind in [SessionKind::Document, SessionKind::Surface] {
        for level in [AccessLevel::Edit, AccessLevel::Owner, AccessLevel::Admin] {
            assert_eq!(level.write_access_for(kind), WriteAccess::Full);
        }
    }
}
