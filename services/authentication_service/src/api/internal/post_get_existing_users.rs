use crate::api::context::ApiContext;

use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_middleware::auth::internal_access::ValidInternalKey;
use macro_user_id::{cowlike::CowLike, lowercased::Lowercase, user_id::MacroUserId};
use model::response::ErrorResponse;
use utoipa::ToSchema;

#[derive(serde::Deserialize, Debug, ToSchema)]
pub struct GetExistingUsersRequest {
    /// List of user ids to check if they exist
    pub user_ids: Vec<String>,
}

#[derive(serde::Serialize, Debug, ToSchema)]
pub struct GetExistingUsersResponse {
    /// List of user ids that exist in our system
    pub existing_user_ids: Vec<String>,
}

#[derive(thiserror::Error, Debug)]
pub enum GetExistingUsersError {
    /// Some of the user ids provided are invalid macro user ids
    #[error("invalid macro user id provided")]
    InvalidMacroId,
    /// Internal error occurred
    #[error("internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for GetExistingUsersError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            GetExistingUsersError::InvalidMacroId => StatusCode::BAD_REQUEST,
            GetExistingUsersError::InternalError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        (
            status_code,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

/// Given a list of macro user ids, returns a list of user ids that exist in our system
#[utoipa::path(
        post,
        path = "/internal/get_existing_users",
        operation_id = "internal_get_existing_users",
        tag = "internal",
        responses(
            (status = 200, body = GetExistingUsersResponse),
            (status = 401, body = ErrorResponse),
            (status = 500, body = ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, _valid_access))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _valid_access: ValidInternalKey,
    extract::Json(GetExistingUsersRequest { user_ids }): extract::Json<GetExistingUsersRequest>,
) -> Result<Json<GetExistingUsersResponse>, GetExistingUsersError> {
    tracing::info!("internal_get_existing_users");

    let user_ids: Vec<MacroUserId<Lowercase<'_>>> = user_ids
        .into_iter()
        .map(|id| {
            MacroUserId::parse_from_str(&id.to_lowercase()).map(|id| id.into_owned().lowercase())
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| GetExistingUsersError::InvalidMacroId)?;

    let existing_user_ids =
        macro_db_client::user::get_all::get_existing_users(&ctx.db, &user_ids).await?;

    Ok(Json(GetExistingUsersResponse { existing_user_ids }))
}
