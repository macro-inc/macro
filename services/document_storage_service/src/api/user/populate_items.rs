use crate::api::context::AuthorizationService;
use axum::{http::StatusCode, response::IntoResponse};
use macro_authorization::MacroAuthorizationExtractor;
use model::response::{GenericErrorResponse, GenericResponse, GenericSuccessResponse};

/// Populates the users items
#[utoipa::path(
        post,
        path = "/users/{user_id}/items",
        operation_id = "populate_items",
        params(
            ("user_id" = String, Path, description = "ID of the user")
        ),
        responses(
            (status = 200, body=GenericSuccessResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(user), fields(user_id=?user.macro_user_id))]
pub async fn populate_items_handler(
    user: MacroAuthorizationExtractor<AuthorizationService>,
) -> impl IntoResponse {
    let response_data = GenericSuccessResponse { success: true };

    GenericResponse::builder()
        .data(&response_data)
        .send(StatusCode::OK)
}
