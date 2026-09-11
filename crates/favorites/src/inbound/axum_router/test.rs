use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use axum::http::header;
use chrono::{TimeZone, Utc};
use entity_access::domain::ports::NoOpEntityAccessService;
use http_body_util::BodyExt;
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use model_user::UserContext;
use rootcause::Report;
use tower::ServiceExt;

use super::*;

const USER_ID: &str = "macro|favorites-router@macro.com";
const VALID_JWT: &str = "valid";

#[derive(Clone)]
struct FakeAuthorizationService;

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt != VALID_JWT {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(UserContext {
            user_id: USER_ID.to_string(),
            fusion_user_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string(),
            permissions: None,
            organization_id: None,
        })
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

#[derive(Clone, Default)]
struct FakeFavoritesService {
    filters: Arc<Mutex<Vec<FavoriteFilter>>>,
}

impl FakeFavoritesService {
    fn filters(&self) -> Vec<FavoriteFilter> {
        self.filters.lock().expect("filter log poisoned").clone()
    }
}

fn collection() -> Vec<Favorite> {
    [
        (EntityType::Document, "doc-1"),
        (EntityType::Document, "shared-id"),
        (EntityType::Channel, "shared-id"),
    ]
    .into_iter()
    .enumerate()
    .map(|(index, (entity_type, entity_id))| Favorite {
        entity_type,
        entity_id: entity_id.to_string(),
        sort_order: index as f64,
        created_at: Utc.with_ymd_and_hms(2026, 7, 1, 12, 0, 0).unwrap(),
        file_type: None,
        document_sub_type: None,
        channel_type: None,
        channel_id: None,
    })
    .collect()
}

impl FavoritesService for FakeFavoritesService {
    async fn add_favorite(
        &self,
        _receipt: &entity_access::domain::models::EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Favorite, FavoritesError> {
        unimplemented!("the list boundary does not add favorites")
    }

    async fn add_favorite_with_established_access(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _entity: &Entity<'_>,
    ) -> Result<Favorite, FavoritesError> {
        unimplemented!("the list boundary does not add favorites")
    }

    async fn list_favorites(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        filter: &FavoriteFilter,
    ) -> Result<Vec<Favorite>, FavoritesError> {
        self.filters
            .lock()
            .expect("filter log poisoned")
            .push(filter.clone());
        Ok(collection()
            .into_iter()
            .filter(|favorite| {
                (filter.entity_types.is_empty()
                    || filter.entity_types.contains(&favorite.entity_type))
                    && (filter.entity_ids.is_empty()
                        || filter.entity_ids.contains(&favorite.entity_id))
            })
            .collect())
    }

    async fn remove_favorite_by_entity(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _entity: &Entity<'_>,
    ) -> Result<(), FavoritesError> {
        unimplemented!("the list boundary does not remove favorites")
    }

    async fn reorder_favorites(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _ordered: &[Entity<'_>],
    ) -> Result<(), FavoritesError> {
        unimplemented!("the list boundary does not reorder favorites")
    }

    async fn favorited_entities(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _entities: &[Entity<'_>],
    ) -> Result<HashSet<Entity<'static>>, FavoritesError> {
        unimplemented!("the list boundary does not read favorite edges")
    }
}

fn build_router(service: FakeFavoritesService) -> axum::Router {
    favorites_router(FavoritesRouterState::new(
        Arc::new(service),
        Arc::new(NoOpEntityAccessService),
        macro_authorization::MacroAuthorizationState::new(Arc::new(FakeAuthorizationService)),
    ))
}

async fn listed_entity_ids(service: &FakeFavoritesService, uri: &str) -> Vec<String> {
    let response = build_router(service.clone())
        .oneshot(
            axum::http::Request::get(uri)
                .header(header::AUTHORIZATION, format!("Bearer {VALID_JWT}"))
                .body(axum::body::Body::empty())
                .expect("request should build"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK, "for {uri}");
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body should collect")
        .to_bytes();
    let body: serde_json::Value = serde_json::from_slice(&bytes).expect("body should be json");
    body["favorites"]
        .as_array()
        .expect("favorites array")
        .iter()
        .map(|favorite| {
            favorite["entityId"]
                .as_str()
                .expect("entityId string")
                .to_string()
        })
        .collect()
}

#[tokio::test]
async fn an_unfiltered_list_returns_the_whole_collection() {
    let service = FakeFavoritesService::default();

    assert_eq!(
        listed_entity_ids(&service, "/").await,
        vec![
            "doc-1".to_string(),
            "shared-id".to_string(),
            "shared-id".to_string()
        ]
    );
    assert_eq!(service.filters(), vec![FavoriteFilter::default()]);
}

#[tokio::test]
async fn repeated_entity_keys_become_both_filter_dimensions() {
    let service = FakeFavoritesService::default();

    assert_eq!(
        listed_entity_ids(
            &service,
            "/?entityType=document&entityType=channel&entityId=shared-id"
        )
        .await,
        vec!["shared-id".to_string(), "shared-id".to_string()]
    );
    assert_eq!(
        service.filters(),
        vec![FavoriteFilter {
            entity_types: vec![EntityType::Document, EntityType::Channel],
            entity_ids: vec!["shared-id".to_string()],
        }],
        "every repeat of a key must survive, not just the last"
    );
}

#[tokio::test]
async fn each_dimension_stands_alone_and_the_two_combine() {
    let service = FakeFavoritesService::default();

    assert_eq!(
        listed_entity_ids(&service, "/?entityType=channel").await,
        vec!["shared-id".to_string()]
    );
    assert_eq!(
        listed_entity_ids(&service, "/?entityId=doc-1").await,
        vec!["doc-1".to_string()]
    );
    assert!(
        listed_entity_ids(&service, "/?entityType=channel&entityId=doc-1")
            .await
            .is_empty(),
        "the dimensions are combined, so a pair nothing satisfies matches nothing"
    );
}

#[tokio::test]
async fn an_unknown_entity_type_is_rejected_before_the_service() {
    let service = FakeFavoritesService::default();
    let response = build_router(service.clone())
        .oneshot(
            axum::http::Request::get("/?entityType=chupacabra")
                .header(header::AUTHORIZATION, format!("Bearer {VALID_JWT}"))
                .body(axum::body::Body::empty())
                .expect("request should build"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(service.filters().is_empty());
}
