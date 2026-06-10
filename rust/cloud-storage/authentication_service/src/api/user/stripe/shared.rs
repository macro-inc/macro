use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::ErrorResponse;
use roles_and_permissions::domain::model::UserRolesAndPermissionsError;
use serde::Serialize;
use stripe::{ParseIdError, StripeError};
use thiserror::Error;
use utoipa::ToSchema;

/// Shared error type for Stripe operations
#[derive(Debug, Error)]
pub enum StripeOperationError {
    #[error("Failed to parse user id")]
    ParseId(#[from] macro_user_id::error::ParseErr),
    #[error("Internal server error")]
    DbErr(#[from] sqlx::Error),
    #[error("User does not have a stripe id")]
    MissingStripeId,
    #[error("Invalid stripe id")]
    StripeIdParse(#[from] ParseIdError),
    #[error("Internal stripe error")]
    StripeErr(#[from] StripeError),
    #[error("Invalid promo code")]
    PromoCodeNotFound,
    #[error("Internal server error")]
    UnexpectedStripeResponse,
    #[error("User already has an active subscription")]
    AlreadySubscribed,
    #[error("Teams service error")]
    TeamsErr(#[from] teams::domain::model::TeamError),
    #[error("Roles and permissions error")]
    RolesErr(#[from] UserRolesAndPermissionsError),
}

impl IntoResponse for StripeOperationError {
    fn into_response(self) -> Response {
        let status = match &self {
            // ParseId and StripeIdParse come from trusted server-side sources (JWT-populated
            // user id, DB-stored Stripe customer id) — a parse failure is a server/auth
            // misconfiguration, not bad client input. Map to 500 so metrics don't blame callers.
            StripeOperationError::ParseId(_) => StatusCode::INTERNAL_SERVER_ERROR,
            StripeOperationError::DbErr(_) => StatusCode::INTERNAL_SERVER_ERROR,
            StripeOperationError::MissingStripeId => StatusCode::BAD_REQUEST,
            StripeOperationError::StripeIdParse(_) => StatusCode::INTERNAL_SERVER_ERROR,
            StripeOperationError::StripeErr(_) => StatusCode::INTERNAL_SERVER_ERROR,
            StripeOperationError::PromoCodeNotFound => StatusCode::NOT_FOUND,
            StripeOperationError::UnexpectedStripeResponse => StatusCode::INTERNAL_SERVER_ERROR,
            StripeOperationError::AlreadySubscribed => StatusCode::CONFLICT,
            StripeOperationError::TeamsErr(_) => StatusCode::INTERNAL_SERVER_ERROR,
            StripeOperationError::RolesErr(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

/// Response containing the Stripe session URL
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StripeSessionResponse {
    /// The URL to redirect the user to
    pub url: String,
}
