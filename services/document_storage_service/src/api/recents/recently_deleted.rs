use crate::api::context::AuthorizationService;
use axum::extract::{Query, State};
use axum::{http::StatusCode, response::IntoResponse};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_db_client::recents::deleted::{MAX_TRASH_PAGE_SIZE, TrashPosition};
use model::item::Item;
use model::response::{GenericErrorResponse, GenericResponse, TypedSuccessResponse};
use models_pagination::{Base64Str, Cursor, CursorVal, CursorWithValAndFilter, DeletedAt};
use sqlx::PgPool;
use utoipa::ToSchema;

const DEFAULT_PAGE_SIZE: u16 = 100;

#[derive(serde::Deserialize)]
pub struct RecentlyDeletedParams {
    /// Page size. Clamped to [1, 500], defaults to 100.
    #[serde(default)]
    limit: Option<u16>,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
pub struct RecentlyDeletedResponseData {
    /// The items returned from the call, most recently trashed first
    pub items: Vec<Item>,
    /// Pass as `cursor` to get the next page; absent on the last page
    pub next_cursor: Option<String>,
}

pub type RecentlyDeletedResponse = TypedSuccessResponse<RecentlyDeletedResponseData>;

/// Gets one page of the user's trashed documents, chats and folders, most
/// recently trashed first.
#[utoipa::path(
    tag="recents",
    operation_id="recently_deleted",
    get,
    path = "/recents/deleted",
    params(
        ("limit" = Option<u16>, Query, description = "Page size (1-500, default 100)"),
        ("cursor" = Option<String>, Query, description = "The previous page's next_cursor"),
    ),
    responses(
        (status = 200, body=RecentlyDeletedResponse),
        (status = 400, body=GenericErrorResponse),
        (status = 401, body=GenericErrorResponse),
        (status = 500, body=GenericErrorResponse),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn handler(
    State(db): State<PgPool>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Query(params): Query<RecentlyDeletedParams>,
    cursor: Option<CursorWithValAndFilter<String, DeletedAt, ()>>,
) -> impl IntoResponse {
    let limit = params
        .limit
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_TRASH_PAGE_SIZE);
    let after = cursor.map(|cursor| TrashPosition {
        deleted_at: cursor.val.last_val,
        id: cursor.id,
    });

    let page = match macro_db_client::recents::deleted::get_recently_deleted(
        &db,
        user.authorization.user.macro_user_id.as_ref(),
        after.as_ref(),
        limit,
    )
    .await
    {
        Ok(result) => result,
        Err(e) => {
            tracing::error!(error=?e, "error getting recently deleted items");
            return GenericResponse::builder()
                .message("error getting recently deleted items")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let next_cursor = page.next.map(|next| {
        Base64Str::encode_json(Cursor {
            id: next.id,
            limit: usize::from(limit),
            val: CursorVal {
                sort_type: DeletedAt,
                last_val: next.deleted_at,
            },
            filter: (),
        })
        .type_erase()
    });

    let data = RecentlyDeletedResponseData {
        items: page.items,
        next_cursor,
    };

    GenericResponse::builder().data(&data).send(StatusCode::OK)
}
