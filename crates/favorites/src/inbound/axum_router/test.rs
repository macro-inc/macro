use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use entity_access::domain::ports::NoOpEntityAccessService;
use http_body_util::BodyExt;
use macro_authorization::{
    MacroAuthorizationError, MacroAuthorizationServiceImpl,
    testing::{FakeMacroAuthorizationService, bearer, test_user_context},
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use tower::ServiceExt;

use super::{FavoritesRouterState, favorites_router};
use crate::domain::{
    models::{Favorite, FavoritesError},
    ports::FavoritesService,
};

const TEST_TOKEN: &str = "test-token";
const TEST_USER_ID: &str = "macro|favorites@example.com";

#[derive(Clone, Default)]
struct RecordingFavoritesService {
    listed_user_ids: Arc<Mutex<Vec<String>>>,
}

impl FavoritesService for RecordingFavoritesService {
    async fn add_favorite(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _entity: &Entity<'_>,
    ) -> Result<Favorite, FavoritesError> {
        unreachable!("add_favorite is not used by these route tests")
    }

    async fn list_favorites(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<Favorite>, FavoritesError> {
        self.listed_user_ids
            .lock()
            .expect("listed user IDs lock poisoned")
            .push(user_id.to_string());
        Ok(Vec::new())
    }

    async fn remove_favorite_by_entity(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _entity: &Entity<'_>,
    ) -> Result<(), FavoritesError> {
        unreachable!("remove_favorite_by_entity is not used by these route tests")
    }

    async fn reorder_favorites(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _ordered: &[Entity<'_>],
    ) -> Result<(), FavoritesError> {
        unreachable!("reorder_favorites is not used by these route tests")
    }

    async fn favorited_entities(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _entities: &[Entity<'_>],
    ) -> Result<HashSet<Entity<'static>>, FavoritesError> {
        unreachable!("favorited_entities is not used by these route tests")
    }
}

fn build_router(
    authorization: FakeMacroAuthorizationService,
) -> (axum::Router, RecordingFavoritesService) {
    let service = RecordingFavoritesService::default();
    let state = FavoritesRouterState::new(
        Arc::new(service.clone()),
        Arc::new(NoOpEntityAccessService),
        MacroAuthorizationServiceImpl::new(authorization),
    );
    (favorites_router(state), service)
}

fn list_request(token: &str) -> Request<Body> {
    bearer(Request::builder(), token)
        .uri("/")
        .body(Body::empty())
        .expect("list favorites request should be valid")
}

#[tokio::test]
async fn list_favorites_authenticates_the_request() {
    let authorization = FakeMacroAuthorizationService::always(test_user_context(TEST_USER_ID));
    let authorization_calls = authorization.clone();
    let (router, service) = build_router(authorization);

    let response = router.oneshot(list_request(TEST_TOKEN)).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(body.as_ref(), br#"{"favorites":[]}"#);
    assert_eq!(authorization_calls.calls(), [TEST_TOKEN]);
    assert_eq!(
        *service
            .listed_user_ids
            .lock()
            .expect("listed user IDs lock poisoned"),
        [TEST_USER_ID]
    );
}

#[tokio::test]
async fn list_favorites_preserves_expired_credential_rejection() {
    let authorization =
        FakeMacroAuthorizationService::never(MacroAuthorizationError::CredentialsExpired);
    let authorization_calls = authorization.clone();
    let (router, service) = build_router(authorization);

    let response = router.oneshot(list_request("expired")).await.unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response.headers().get(header::WWW_AUTHENTICATE).unwrap(),
        "Bearer error=\"invalid_token\", error_description=\"jwt expired\""
    );
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(body.as_ref(), br#"{"message":"jwt expired"}"#);
    assert_eq!(authorization_calls.calls(), ["expired"]);
    assert!(
        service
            .listed_user_ids
            .lock()
            .expect("listed user IDs lock poisoned")
            .is_empty()
    );
}
