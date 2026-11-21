//! Internal link-bound account settings. The email service enforces authenticated ownership.
use super::{ApiError, ApiState, ErrorBody, binding};
use crate::domain::account_settings::{AccountMailSettings, UpdateFolderSettings};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use uuid::Uuid;

#[utoipa::path(
    get,
    path = "/internal/v1/accounts/{link}/settings",
    params(
        ("link" = Uuid, Path),
        ("x-mailbox-binding" = String, Header)
    ),
    operation_id = "account_mail_settings",
    responses(
        (status = 200, body = AccountMailSettings),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
pub(super) async fn account_mail_settings(
    State(state): State<ApiState>,
    Path(link): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<AccountMailSettings>, ApiError> {
    Ok(Json(
        state
            .engine
            .account_mail_settings(binding(link, &headers)?)
            .await?,
    ))
}

#[utoipa::path(
    patch,
    path = "/internal/v1/accounts/{link}/settings",
    params(
        ("link" = Uuid, Path),
        ("x-mailbox-binding" = String, Header)
    ),
    operation_id = "update_mail_settings",
    request_body = UpdateFolderSettings,
    responses(
        (status = 200, body = AccountMailSettings),
        (status = 422, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
pub(super) async fn update_mail_settings(
    State(state): State<ApiState>,
    Path(link): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<UpdateFolderSettings>,
) -> Result<Json<AccountMailSettings>, ApiError> {
    Ok(Json(
        state
            .engine
            .update_mail_settings(binding(link, &headers)?, input)
            .await?,
    ))
}
