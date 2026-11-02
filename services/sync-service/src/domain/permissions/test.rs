use super::*;

#[test]
fn document_grants_enforce_scope_and_minimum_permission() {
    let token = AuthToken {
        user_id: None,
        document_id: "document-a".into(),
        access_level: AccessLevel::View,
        actor: None,
        session_kind: SessionKind::Document,
        expires_at: None,
    };
    assert!(
        token
            .require_document_permission("document-a", &AccessLevel::View)
            .is_ok()
    );
    assert!(
        token
            .require_document_permission("document-a", &AccessLevel::Edit)
            .is_err()
    );
    assert!(
        token
            .require_document_permission("document-b", &AccessLevel::View)
            .is_err()
    );
    let access = token.document_access("document-a").unwrap();
    assert!(access.require_edit().is_err());
    assert!(token.document_access("document-b").is_err());
}

#[test]
fn admin_grants_cannot_cross_document_scope_on_atomic_operations() {
    let token = AuthToken {
        user_id: None,
        document_id: "document-a".into(),
        access_level: AccessLevel::Admin,
        actor: None,
        session_kind: SessionKind::Document,
        expires_at: None,
    };
    assert!(
        token
            .require_document_permission("document-b", &AccessLevel::Admin)
            .is_ok()
    );
    assert!(
        token
            .document_access("document-a")
            .unwrap()
            .require_edit()
            .is_ok()
    );
    assert!(token.document_access("document-b").is_err());
}
