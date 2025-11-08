use crate::api::context::ApiContext;
use axum::Extension;
use axum::Json;
use axum::extract::Query;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use frecency::domain::models::AggregateId;
use frecency::domain::models::FrecencyPageRequest;
use frecency::domain::models::JoinFrecency;
use frecency::domain::ports::FrecencyQueryService;
use frecency::domain::services::FrecencyQueryServiceImpl;
use frecency::outbound::postgres::FrecencyPgStorage;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model::response::ErrorResponse;
use model::response::GenericErrorResponse;
use model::user::UserContext;
use model_entity::as_owned::ShallowClone;
use models_pagination::CursorExtractor;
use models_pagination::CursorVal;
use models_pagination::CursorWithVal;
use models_pagination::Frecency;
use models_pagination::Identify;
use models_pagination::PaginateOn;
use models_pagination::PaginatedOpaqueCursor;
use models_pagination::SimpleSortMethod;
use models_pagination::SortMethod;
use models_pagination::SortOn;
use models_soup::item::SoupItem;
use serde::Serialize;
use soup::domain::models::{AdvancedSortParams, FrecencySoupItem, SimpleSortRequest, SoupType};
use sqlx::PgPool;
use thiserror::Error;
use utoipa::IntoParams;
use utoipa::ToSchema;

#[cfg(test)]
mod tests;

#[derive(Debug, Default, serde::Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct Params {
    /// Whether to expand projects. Defaults to false.
    expand: Option<bool>,
    /// Limit the number of items returned. Defaults to 20. Max 500.
    limit: Option<u16>,
    /// Sort method. Options are viewed_at, created_at, updated_at, viewed_updated. Defaults to viewed_at.
    sort_method: Option<SortMethod>,
}

/// Gets the items the user has access to
#[utoipa::path(
    get,
    operation_id = "get_items_soup",
    path = "/items/soup",
    params(
        Params,
        ("cursor" = Option<String>, Query, description = "Cursor value. Base64 encoded timestamp and item id, separated by |."),
    ),
    responses(
            (status = 200, body=PaginatedOpaqueCursor<FrecencySoupItem>),
            (status = 401, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(pg, user_context, frecency_interface), fields(user_id=?user_context.user_id))]
#[axum::debug_handler(state = ApiContext)]
pub async fn soup_handler(
    State(pg): State<PgPool>,
    State(frecency_interface): State<FrecencyQueryServiceImpl<FrecencyPgStorage>>,
    Extension(user_context): Extension<UserContext>,
    Query(params): Query<Params>,
    cursor: CursorExtractor<String, SimpleSortMethod>,
) -> Result<Json<PaginatedOpaqueCursor<FrecencySoupItem>>, SoupHandlerErr> {
    SoupImpl {
        soup_storage: pg,
        frecency_interface,
    }
    .handle_soup_request(user_context, params, cursor.into_option())
    .await
    .map(Json)
}

#[derive(Debug, Error)]
pub enum SoupHandlerErr {
    #[error("An unknown error has occurred")]
    DbErr(#[from] anyhow::Error),
    #[error("An unknown error has occurred")]
    FailedToQueryFrecency,
    #[error("You are not authorized to access this")]
    Unauthorized,
}

impl IntoResponse for SoupHandlerErr {
    fn into_response(self) -> Response {
        let status = match &self {
            SoupHandlerErr::DbErr(_) | SoupHandlerErr::FailedToQueryFrecency => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
            SoupHandlerErr::Unauthorized => StatusCode::UNAUTHORIZED,
        };
        (
            status,
            Json(ErrorResponse {
                message: &self.to_string(),
            }),
        )
            .into_response()
    }
}

impl Identify for FrecencySoupItem {
    type Id = String;

    fn id(&self) -> String {
        self.item.id()
    }
}

impl SortOn<SimpleSortMethod> for FrecencySoupItem {
    fn sort_on(sort: SimpleSortMethod) -> impl FnOnce(&Self) -> CursorVal<SimpleSortMethod> {
        let cb = SoupItem::sort_on(sort);
        move |v| cb(&v.item)
    }
}

/// struct which handles the actual implementation of soup with abstracted interfaces for mocking
struct SoupImpl<T, U> {
    /// the interface for interacting with the db
    soup_storage: T,
    /// the interface for interacting with frecency
    frecency_interface: U,
}

impl<T, U> SoupImpl<T, U>
where
    T: SoupStorage + Send,
    U: FrecencyQueryService,
{
    async fn handle_soup_request(
        self,
        user_context: UserContext,
        Params {
            expand,
            limit,
            sort_method,
        }: Params,
        cursor: Option<CursorWithVal<String, SimpleSortMethod>>,
    ) -> Result<PaginatedOpaqueCursor<FrecencySoupItem>, SoupHandlerErr> {
        if matches!(user_context.user_id.as_str(), "" | "INTERNAL") {
            return Err(SoupHandlerErr::Unauthorized);
        }

        let limit = limit.unwrap_or(20).min(500);
        let expanded = match expand {
            Some(true) | None => SoupType::Expanded,
            Some(false) => SoupType::UnExpanded,
        };

        Ok(
            match sort_method.unwrap_or(SortMethod::Simple(SimpleSortMethod::ViewedUpdated)) {
                SortMethod::Simple(sort) => self
                    .soup_storage
                    .get_user_items_soup(SimpleSortRequest {
                        limit,
                        user_id: &user_context.user_id,
                        cursor: models_pagination::Query::new(cursor, sort),
                        expanded,
                    })
                    .await?
                    .into_iter()
                    .map(|item| FrecencySoupItem {
                        item,
                        frecency_score: Default::default(),
                    })
                    .paginate_on(limit as usize, sort)
                    .into_page()
                    .type_erase(),
                SortMethod::Advanced(sort) => {
                    self.handle_advanced_sort(sort, user_context, expanded, limit)
                        .await?
                        .into_iter()
                        // TODO: fix this for correct frecency sorting/pagination
                        .paginate_on(limit.into(), SimpleSortMethod::CreatedAt)
                        .into_page()
                        .type_erase()
                }
            },
        )
    }

    async fn handle_advanced_sort(
        self,
        sort: Frecency,
        user: UserContext,
        expanded: SoupType,
        limit: u16,
    ) -> Result<Vec<FrecencySoupItem>, SoupHandlerErr> {
        let user_id = MacroUserIdStr::parse_from_str(&user.user_id)
            .map_err(|_| SoupHandlerErr::Unauthorized)?;
        let res = self
            .frecency_interface
            .get_frecency_page(FrecencyPageRequest {
                user_id: user_id.copied(),
                from_score: None,
                limit: limit as u32,
            })
            .await?;

        let entities: Vec<_> = res.ids().map(|f| f.entity.shallow_clone()).collect();

        let res: Vec<_> = self
            .soup_storage
            .get_user_soup_by_ids(
                sort,
                AdvancedSortParams {
                    entities: &entities,
                    user_id: &user.user_id,
                    expanded,
                },
            )
            .await?
            .into_iter()
            .join_frecency(res, |id| AggregateId {
                entity: id.entity(),
                user_id: user_id.copied().into_owned(),
            })
            .into_iter()
            .map(|(soup_item, frecency)| FrecencySoupItem {
                item: soup_item,
                frecency_score: frecency.map(|f| f.data.frecency_score).unwrap_or_default(),
            })
            .collect();

        Ok(res)
    }
}
