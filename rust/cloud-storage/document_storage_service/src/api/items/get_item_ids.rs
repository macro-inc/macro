use crate::api::context::ApiContext;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::{Extension, Json};
use model::document_storage_service_internal::GetItemIDsResponse;
use model::user::UserContext;

#[derive(serde::Deserialize)]
pub struct Params {
    pub item_type: Option<String>,
    pub exclude_owned: Option<bool>,
}

/// Gets the ids of the items the user has access to
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn get_item_ids_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Query(Params {
        item_type,
        exclude_owned,
    }): Query<Params>,
) -> Result<(StatusCode, Json<GetItemIDsResponse>), (StatusCode, String)> {
    tracing::info!("get_item_ids");

    let user_id = user_context.user_id.clone();

    if matches!(user_id.as_str(), "" | "INTERNAL") {
        return Err((
            StatusCode::UNAUTHORIZED,
            "No user id found in context".to_string(),
        ));
    }

    let items = match macro_db_client::item_access::get_accessible_items::get_user_accessible_items(
        &ctx.db,
        &user_id,
        item_type,
        exclude_owned.unwrap_or_default(),
    )
    .await
    {
        Ok(items) => items,
        Err(e) => {
            tracing::error!(error=?e, "unable to get item ids");
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to get item ids".to_string(),
            ));
        }
    };

    Ok((StatusCode::OK, Json(GetItemIDsResponse { items })))
}
