use std::sync::Arc;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use entity_access::domain::ports::NoOpEntityAccessService;
use macro_authorization::{
    MacroAuthorizationError, MacroAuthorizationServiceImpl,
    testing::{FakeMacroAuthorizationService, bearer},
};
use tower::ServiceExt;

use crate::{
    domain::service::NoOpCrmService,
    inbound::axum_router::{CrmRouterState, crm_router},
};

fn test_router(authorization: FakeMacroAuthorizationService) -> Router {
    crm_router(CrmRouterState {
        service: Arc::new(NoOpCrmService),
        entity_access_service: Arc::new(NoOpEntityAccessService),
        authorization: MacroAuthorizationServiceImpl::new(authorization),
    })
}

#[tokio::test]
async fn expired_credentials_preserve_authorization_rejection() {
    let authorization =
        FakeMacroAuthorizationService::never(MacroAuthorizationError::CredentialsExpired);
    let request = bearer(
        Request::get("/companies/00000000-0000-0000-0000-000000000001"),
        "expired",
    )
    .body(Body::empty())
    .unwrap();

    let response = test_router(authorization.clone())
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response.headers().get(header::WWW_AUTHENTICATE).unwrap(),
        "Bearer error=\"invalid_token\", error_description=\"jwt expired\""
    );
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(body.as_ref(), br#"{"message":"jwt expired"}"#);
    assert_eq!(authorization.calls(), ["expired"]);
}
