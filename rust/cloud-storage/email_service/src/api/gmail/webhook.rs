use crate::api::context::ApiContext;
use crate::util;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::{
    extract,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::response::ErrorResponse;
use models_email::gmail::webhook::{
    GmailMessagePayload, GmailWebhookPayload, JwtVerificationError, WebhookOperation,
    WebhookPubsubMessage,
};
use models_email::service::link::UserProvider;

/// webhook that GCP hits when there are changes to a user's inbox. we authenticate the message then
/// queue it onto our own sqs queue and handle it in pubsub/gmail/process.rs.
pub async fn webhook_handler(
    State(ctx): State<ApiContext>,
    headers: HeaderMap,
    extract::Json(req): extract::Json<GmailWebhookPayload>,
) -> Result<Response, Response> {
    // Validate the token in the headers sent from Google
    validate_google_token(&ctx, &headers).await?;
    let email_address = &req.message.data.email_address;

    let link = email_db_client::links::get::fetch_link_by_email(
        &ctx.db,
        email_address,
        UserProvider::Gmail,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to enqueue gmail notification");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to enqueue gmail notification",
            }),
        )
            .into_response()
    })?;

    if let Some(link) = link {
        let message = WebhookPubsubMessage {
            link_id: link.id,
            operation: WebhookOperation::GmailMessage(GmailMessagePayload {
                history_id: req.message.data.history_id,
            }),
        };

        ctx.sqs_client
            .enqueue_gmail_webhook_notification(message)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to enqueue gmail notification");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to enqueue gmail notification",
                    }),
                )
                    .into_response()
            })?;
    }

    Ok(Json(StatusCode::ACCEPTED).into_response())
}

/// Validates the bearer token from the request headers sent by google. see
/// https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions
async fn validate_google_token(ctx: &ApiContext, headers: &HeaderMap) -> Result<(), Response> {
    // Get public keys to validate with
    let public_keys = util::gmail::auth::get_google_public_keys(
        ctx.redis_client.clone(),
        ctx.gmail_client.clone(),
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to get google public keys");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to get google public keys",
            }),
        )
            .into_response()
    })?;

    // Extract bearer token
    let bearer_token = extract_bearer_token(headers).ok_or_else(|| {
        tracing::warn!("No bearer token provided in request headers");
        (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                message: "Missing Authorization bearer token",
            }),
        )
            .into_response()
    })?;

    // First attempt to verify the token with existing public keys
    match ctx
        .gmail_client
        .verify_google_token(bearer_token, public_keys)
    {
        Ok(_) => Ok(()),
        Err(first_error) => {
            // Only retry if it's a KeyNotFound or InvalidSignature error
            match first_error {
                // These two error types likely indicate a key rotation issue
                JwtVerificationError::KeyNotFound(_) | JwtVerificationError::InvalidSignature => {
                    tracing::warn!(
                        "Token verification failed due to possible key rotation, refreshing keys and retrying. Error: {:?}",
                        first_error
                    );

                    // Fetch fresh public keys
                    let fresh_public_keys =
                        match util::gmail::auth::fetch_and_cache_google_public_keys(
                            ctx.redis_client.clone(),
                            ctx.gmail_client.clone(),
                        )
                        .await
                        {
                            Ok(keys) => keys,
                            Err(e) => {
                                tracing::error!(error=?e, "Failed to refresh Google public keys");
                                return Err((
                                StatusCode::UNAUTHORIZED,
                                Json(ErrorResponse {
                                    message: "Authentication failed and couldn't refresh verification keys",
                                }),
                            ).into_response());
                            }
                        };

                    // Retry verification with fresh keys
                    ctx.gmail_client
                        .verify_google_token(bearer_token, fresh_public_keys)
                        .map_err(|second_error| {
                            tracing::error!(
                                first_error=?first_error,
                                second_error=?second_error,
                                "Token verification failed even with refreshed keys"
                            );
                            (
                                StatusCode::UNAUTHORIZED,
                                Json(ErrorResponse {
                                    message: "Invalid authentication token",
                                }),
                            )
                                .into_response()
                        })?;

                    Ok(())
                }
                // For other error types, return error immediately without refreshing keys
                _ => {
                    tracing::error!(error=?first_error, "Token verification failed with non-key related error");
                    Err((
                        StatusCode::UNAUTHORIZED,
                        Json(ErrorResponse {
                            message: "Invalid authentication token",
                        }),
                    )
                        .into_response())
                }
            }
        }
    }
}

/// Extract the bearer token from the Authorization header
fn extract_bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|auth_value| auth_value.strip_prefix("Bearer "))
}
