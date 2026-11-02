use super::*;
use axum::{Router, body::Body, http::Request, routing::get};
use tower_service::Service;

#[test]
fn extractors_enforce_scope_permission_and_credential_source() {
    let secrets = Secrets {
        internal_api_secret: "internal".into(),
        document_permissions_secret: "secret".into(),
    };
    let mut router = Router::new()
        .route(
            "/document/{document_id}/view",
            get(|_: ViewAccess| async {}),
        )
        .route(
            "/document/{document_id}/edit",
            get(|_: EditAccess| async {}),
        )
        .route(
            "/document/{document_id}/admin",
            get(|_: AdminAccess| async {}),
        )
        .route(
            "/document/{document_id}/signed",
            get(|_: SignedDocumentAccess| async {}),
        )
        .route(
            "/document/{document_id}/connect",
            get(|_: SocketAccess| async {}),
        )
        .route(
            "/document/{document_id}/internal",
            get(|_: InternalAccess| async {}),
        )
        .with_state(secrets);
    let view = macro_sync_service_jwt::encode(
        &serde_json::json!({"document_id": "document-a", "access_level": "view", "exp": usize::MAX / 2}),
        "secret",
    ).unwrap();
    let edit = macro_sync_service_jwt::encode(
        &serde_json::json!({"document_id": "document-a", "access_level": "edit", "exp": usize::MAX / 2}),
        "secret",
    ).unwrap();
    let expired = macro_sync_service_jwt::encode(
        &serde_json::json!({"document_id": "document-a", "access_level": "edit", "exp": 1}),
        "secret",
    )
    .unwrap();
    for (path, header, value, status) in [
        (
            "/document/document-a/view".into(),
            "authorization",
            format!("Bearer {view}"),
            StatusCode::OK,
        ),
        (
            "/document/document-b/view".into(),
            "authorization",
            format!("Bearer {view}"),
            StatusCode::UNAUTHORIZED,
        ),
        (
            "/document/document-a/edit".into(),
            "authorization",
            format!("Bearer {view}"),
            StatusCode::UNAUTHORIZED,
        ),
        (
            "/document/document-a/edit".into(),
            "authorization",
            format!("Bearer {edit}"),
            StatusCode::OK,
        ),
        (
            "/document/document-a/admin".into(),
            "authorization",
            format!("Bearer {edit}"),
            StatusCode::UNAUTHORIZED,
        ),
        (
            "/document/document-a/view".into(),
            "authorization",
            format!("Bearer {expired}"),
            StatusCode::UNAUTHORIZED,
        ),
        (
            "/document/document-a/view".into(),
            "authorization",
            "Bearer invalid".into(),
            StatusCode::UNAUTHORIZED,
        ),
        (
            "/document/document-a/view".into(),
            "authorization",
            edit.to_string(),
            StatusCode::UNAUTHORIZED,
        ),
        (
            "/document/document-a/admin".into(),
            "x-internal-auth-key",
            "internal".into(),
            StatusCode::OK,
        ),
        (
            "/document/document-a/signed".into(),
            "x-internal-auth-key",
            "internal".into(),
            StatusCode::UNAUTHORIZED,
        ),
        (
            "/document/document-a/signed".into(),
            "authorization",
            format!("Bearer {view}"),
            StatusCode::OK,
        ),
        (
            "/document/document-b/signed".into(),
            "authorization",
            format!("Bearer {edit}"),
            StatusCode::UNAUTHORIZED,
        ),
        (
            "/document/document-a/internal".into(),
            "authorization",
            format!("Bearer {edit}"),
            StatusCode::UNAUTHORIZED,
        ),
        (
            "/document/document-a/internal".into(),
            "x-internal-auth-key",
            "wrong".into(),
            StatusCode::UNAUTHORIZED,
        ),
        (
            "/document/document-a/internal".into(),
            "x-internal-auth-key",
            "internal".into(),
            StatusCode::OK,
        ),
        (
            format!("/document/document-a/connect?token={edit}"),
            "authorization",
            "".into(),
            StatusCode::OK,
        ),
        (
            format!("/document/document-b/connect?token={edit}"),
            "authorization",
            "".into(),
            StatusCode::UNAUTHORIZED,
        ),
        (
            "/document/document-a/connect".into(),
            "x-internal-auth-key",
            "internal".into(),
            StatusCode::UNAUTHORIZED,
        ),
    ] {
        let request = Request::builder()
            .uri(&path)
            .header(header, value)
            .body(Body::empty())
            .unwrap();
        let response = futures::executor::block_on(router.call(request)).unwrap();
        assert_eq!(response.status(), status, "{path}");
    }
}

#[test]
fn surface_extractors_reject_document_and_cross_surface_grants() {
    use macro_sync_service_jwt::session::{SurfaceAccessLevel, SurfaceClaims, SurfaceSessionKind};
    let id = "01952cbd-76ad-7a65-9c21-020304050607";
    let token = macro_sync_service_jwt::session::encode_surface(
        &SurfaceClaims {
            session_kind: SurfaceSessionKind::Surface,
            surface_id: id.parse().unwrap(),
            user_id: None,
            access_level: SurfaceAccessLevel::View,
            actor: None,
            exp: usize::MAX / 2,
            iss: macro_sync_service_jwt::ISSUER.into(),
        },
        "secret",
    )
    .unwrap();
    let document = macro_sync_service_jwt::encode(
        &serde_json::json!({"document_id": id, "access_level": "admin", "exp": usize::MAX / 2}),
        "secret",
    )
    .unwrap();
    let mut router = Router::new()
        .route(
            "/surface/{surface_id}/read",
            get(|_: SurfaceAccess<false>| async {}),
        )
        .route(
            "/surface/{surface_id}/connect",
            get(|_: SurfaceAccess<true>| async {}),
        )
        .route(
            "/document/{document_id}/read",
            get(|_: ViewAccess| async {}),
        )
        .with_state(Secrets {
            internal_api_secret: "internal".into(),
            document_permissions_secret: "secret".into(),
        });
    for (uri, header, value, expected) in [
        (
            format!("/surface/{id}/read"),
            "authorization",
            format!("Bearer {token}"),
            StatusCode::OK,
        ),
        (
            "/surface/01952cbd-76ad-7a65-9c21-020304050608/read".into(),
            "authorization",
            format!("Bearer {token}"),
            StatusCode::UNAUTHORIZED,
        ),
        (
            format!("/surface/{id}/read"),
            "authorization",
            format!("Bearer {document}"),
            StatusCode::UNAUTHORIZED,
        ),
        (
            format!("/document/{id}/read"),
            "authorization",
            format!("Bearer {token}"),
            StatusCode::UNAUTHORIZED,
        ),
        (
            format!("/surface/{id}/read"),
            "x-internal-auth-key",
            "internal".into(),
            StatusCode::UNAUTHORIZED,
        ),
        (
            format!("/surface/{id}/connect?token={token}"),
            "authorization",
            "".into(),
            StatusCode::OK,
        ),
        (
            format!("/surface/{id}/connect?token={document}"),
            "authorization",
            "".into(),
            StatusCode::UNAUTHORIZED,
        ),
    ] {
        let request = Request::builder()
            .uri(&uri)
            .header(header, value)
            .body(Body::empty())
            .unwrap();
        let response = futures::executor::block_on(router.call(request)).unwrap();
        assert_eq!(response.status(), expected, "{uri}");
    }
}
