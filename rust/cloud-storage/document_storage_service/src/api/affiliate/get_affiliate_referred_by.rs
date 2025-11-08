use crate::api::context::ApiContext;
use axum::{
    extract::{Extension, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::{
    affiliate::AffiliateUser,
    response::{ErrorResponse, GenericErrorResponse},
    user::UserContext,
};
use utoipa::ToSchema;

#[derive(serde::Deserialize, serde::Serialize, ToSchema)]
pub struct GetUsersAffiliateResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affiliate: Option<AffiliateUser>,
}

/// Gets who the affiliate code the user was referred by
#[utoipa::path(
        get,
        path = "/affiliate/referred_by",
        operation_id = "get_affiliate_referred_by",
        responses(
            (status = 200, body=GetUsersAffiliateResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=%user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> Result<Response, Response> {
    tracing::trace!("get_affiliate_referred_by");

    let mut transaction = ctx.db.begin().await.map_err(|e| {
        tracing::error!(error=?e, "failed to begin transaction");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to begin transaction",
            }),
        )
            .into_response()
    })?;
    let user_email = macro_db_client::user::get_user_email::get_user_email(
        &mut transaction,
        &user_context.user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "failed to get user email");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to get user email",
            }),
        )
            .into_response()
    })?;

    transaction.commit().await.map_err(|e| {
        tracing::error!(error=?e, "failed to commit transaction");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to commit transaction",
            }),
        )
            .into_response()
    })?;

    let affiliate = ctx
        .dynamodb_client
        .affiliate_users
        .get_user_referred(&user_email)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get user referred");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to get user referred",
                }),
            )
                .into_response()
        })?;

    Ok((
        StatusCode::OK,
        Json(GetUsersAffiliateResponse { affiliate }),
    )
        .into_response())
}
