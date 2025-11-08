use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::{EmptyResponse, ErrorResponse};
use model_notifications::DeviceType;
use notification_db_client::device;
use std::collections::HashMap;

use crate::api::context::ApiContext;
use crate::model::device::DeviceRequest;
use model::user::UserContext;

/// Register a user device for push notifications.
#[utoipa::path(
        post,
        operation_id = "register_device",
        path = "/device/register",
        request_body = DeviceRequest,
        responses(
            (status = 200, body=EmptyResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
            (status = 501, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Json(req): extract::Json<DeviceRequest>,
) -> Result<Response, Response> {
    let platform_arn = match req.device_type {
        DeviceType::Ios => &ctx.config.sns_apns_platform_arn,
        DeviceType::Android => &ctx.config.sns_fcm_platform_arn,
    };

    // get endpoint if exists, otherwise create new one
    let endpoint = match device::get_device_endpoint(&ctx.db, &req.token).await {
        Ok(Some(endpoint)) => endpoint,
        _ => ctx
            .sns_client
            .create_platform_endpoint(platform_arn, &req.token)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to create endpoint for device");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to create endpoint for device",
                    }),
                )
                    .into_response()
            })?,
    };

    // verify endpoint validity, update or create new endpoint if needed
    let endpoint = match ctx.sns_client.get_endpoint_attributes(&endpoint).await {
        Err(e) => {
            tracing::error!(error=?e, "unable to get endpoint attributes");
            ctx.sns_client
                .create_platform_endpoint(platform_arn, &req.token)
                .await
                .map_err(|e| {
                    tracing::error!(error=?e, "unable to create endpoint for device");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ErrorResponse {
                            message: "unable to get endpoint attributes",
                        }),
                    )
                        .into_response()
                })?
        }
        Ok(attributes) => match (attributes.get("Enabled"), attributes.get("Token")) {
            (Some(endpoint_enabled), Some(endpoint_token))
                if endpoint_enabled == "false" || endpoint_token != &req.token =>
            {
                ctx.sns_client
                    .set_endpoint_attributes(
                        &endpoint,
                        HashMap::from([
                            ("Enabled".to_string(), "true".to_string()),
                            ("Token".to_string(), req.token.clone()),
                        ]),
                    )
                    .await
                    .map_err(|e| {
                        tracing::error!(error=?e, "unable to update endpoint attributes");
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(ErrorResponse {
                                message: "unable to update endpoint attributes",
                            }),
                        )
                            .into_response()
                    })?;

                endpoint
            }
            _ => endpoint,
        },
    };

    device::upsert_user_device(
        &ctx.db,
        &user_context.user_id,
        &req.token,
        &endpoint,
        &req.device_type,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to register device");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to register device",
            }),
        )
            .into_response()
    })?;

    Ok((StatusCode::OK, Json(EmptyResponse {})).into_response())
}
