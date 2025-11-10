use crate::domain::{
    models::{FrecencySoupItem, SoupErr, SoupQuery, SoupRequest, SoupType},
    ports::SoupService,
};
use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use item_filters::{
    EntityFilters,
    ast::{EntityFilterAst, ExpandErr},
};
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;
use models_pagination::{
    CursorExtractor, Either, Frecency, PaginatedOpaqueCursor, SimpleSortMethod, SortMethod,
};
use models_soup::item::SoupItem;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use thiserror::Error;
use utoipa::{IntoParams, ToSchema};

#[derive(Debug, Default, serde::Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct Params {
    /// Whether to expand projects. Defaults to true.
    #[serde(default)]
    expand: Option<bool>,
    /// Limit the number of items returned. Defaults to 20. Max 500.
    #[serde(default)]
    limit: Option<u16>,
    /// Sort method. Options are viewed_at, created_at, updated_at, viewed_updated. Defaults to viewed_at.
    #[serde(default)]
    sort_method: Option<SoupApiSort>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SoupApiSort {
    ViewedAt,
    CreatedAt,
    UpdatedAt,
    ViewedUpdated,
    Frecency,
}

impl SoupApiSort {
    fn into_sort_method(self) -> SortMethod {
        match self {
            SoupApiSort::ViewedAt => SortMethod::Simple(SimpleSortMethod::ViewedAt),
            SoupApiSort::CreatedAt => SortMethod::Simple(SimpleSortMethod::CreatedAt),
            SoupApiSort::UpdatedAt => SortMethod::Simple(SimpleSortMethod::UpdatedAt),
            SoupApiSort::ViewedUpdated => SortMethod::Simple(SimpleSortMethod::ViewedUpdated),
            SoupApiSort::Frecency => SortMethod::Advanced(Frecency),
        }
    }
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct SoupPage {
    items: Vec<SoupApiItem>,
    next_cursor: Option<String>,
}

pub struct SoupRouterState<T> {
    service: Arc<T>,
}

impl<T> Clone for SoupRouterState<T> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

impl<T> SoupRouterState<T>
where
    T: SoupService,
{
    pub fn new(service: T) -> Self {
        SoupRouterState {
            service: Arc::new(service),
        }
    }

    async fn handle(
        &self,
        macro_user_id: MacroUserIdStr<'static>,
        PostSoupRequest { filters, params }: PostSoupRequest,
        cursor: SoupCursor,
    ) -> Result<Json<PaginatedOpaqueCursor<SoupApiItem>>, SoupHandlerErr> {
        let create_fallback = move || {
            let params_sort = params
                .sort_method
                .map(|s| s.into_sort_method())
                .unwrap_or(SortMethod::Simple(SimpleSortMethod::ViewedAt));
            match params_sort {
                SortMethod::Simple(simple_sort_method) => {
                    SoupQuery::Simple(models_pagination::Query::Sort(simple_sort_method))
                }
                SortMethod::Advanced(frecency) => {
                    SoupQuery::Frecency(models_pagination::Query::Sort(frecency))
                }
            }
        };

        let cursor = match cursor {
            Either::Left(l) => l
                .into_option()
                .map(models_pagination::Query::Cursor)
                .map(SoupQuery::Simple)
                .unwrap_or_else(create_fallback),
            Either::Right(r) => r
                .into_option()
                .map(models_pagination::Query::Cursor)
                .map(SoupQuery::Frecency)
                .unwrap_or_else(create_fallback),
        };

        let res = self
            .service
            .get_user_soup(SoupRequest {
                soup_type: match params.expand {
                    Some(true) | None => SoupType::Expanded,
                    Some(false) => SoupType::UnExpanded,
                },
                limit: params.limit.unwrap_or(20),
                cursor,
                user: macro_user_id,
                filters: EntityFilterAst::new_from_filters(filters)?,
            })
            .await?;

        Ok(Json(res.map(SoupApiItem::from_frecency_soup_item)))
    }
}

pub fn soup_router<T, S>(state: SoupRouterState<T>) -> Router<S>
where
    T: SoupService,
    S: Send + Sync,
{
    Router::new()
        .route("/soup", get(get_soup_handler))
        .route("/soup", post(post_soup_handler))
        .with_state(state)
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct SoupApiItem {
    #[serde(flatten)]
    item: SoupItem,
    frecency_score: f64,
}

impl SoupApiItem {
    fn from_frecency_soup_item(item: FrecencySoupItem) -> Self {
        let FrecencySoupItem {
            item,
            frecency_score,
        } = item;
        SoupApiItem {
            item,
            frecency_score: frecency_score
                .map(|f| f.data.frecency_score)
                .unwrap_or_default(),
        }
    }
}

#[derive(Debug, Error)]
pub enum SoupHandlerErr {
    #[error("An internal server error has occurred")]
    Internal(#[from] SoupErr),
    #[error("Invalid filter arguments provided")]
    ExpandErr(#[from] ExpandErr),
}

impl IntoResponse for SoupHandlerErr {
    fn into_response(self) -> axum::response::Response {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: &self.to_string(),
            }),
        )
            .into_response()
    }
}

/// Gets the items the user has access to
#[utoipa::path(
    get,
    operation_id = "get_items_soup",
    path = "/items/soup",
    params(
        Params,
        ("cursor" = Option<String>, Query, description = "Base64 encoded cursor value."),
    ),
    responses(
            (status = 200, body=SoupPage),
            (status = 500, body=ErrorResponse),
    )
)]
pub async fn get_soup_handler<T>(
    State(service): State<SoupRouterState<T>>,
    MacroUserExtractor { macro_user_id, .. }: MacroUserExtractor,
    Query(params): Query<Params>,
    cursor: SoupCursor,
) -> Result<Json<PaginatedOpaqueCursor<SoupApiItem>>, SoupHandlerErr>
where
    T: SoupService,
{
    service
        .handle(
            macro_user_id,
            PostSoupRequest {
                params,
                filters: Default::default(),
            },
            cursor,
        )
        .await
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PostSoupRequest {
    #[serde(default, flatten)]
    filters: EntityFilters,
    #[serde(default, flatten)]
    params: Params,
}

type SoupCursor =
    Either<CursorExtractor<String, SimpleSortMethod, ()>, CursorExtractor<String, Frecency, ()>>;

/// Gets the items the user has access to
#[utoipa::path(
    post,
    operation_id = "post_items_soup",
    path = "/items/soup",
    params(
        ("cursor" = Option<String>, Query, description = "Base64 encoded cursor value."),
    ),
    responses(
            (status = 200, body=SoupPage),
            (status = 500, body=ErrorResponse),
    )
)]
pub async fn post_soup_handler<T>(
    State(service): State<SoupRouterState<T>>,
    MacroUserExtractor { macro_user_id, .. }: MacroUserExtractor,
    cursor: SoupCursor,
    Json(post_soup_request): Json<PostSoupRequest>,
) -> Result<Json<PaginatedOpaqueCursor<SoupApiItem>>, SoupHandlerErr>
where
    T: SoupService,
{
    service
        .handle(macro_user_id, post_soup_request, cursor)
        .await
}
