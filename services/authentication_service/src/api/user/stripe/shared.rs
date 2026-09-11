use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::ErrorResponse;
use roles_and_permissions::domain::model::UserRolesAndPermissionsError;
use serde::Serialize;
use stripe::{ParseIdError, StripeError};
use teams::domain::model::{CustomerError, SeatPrices, SetTeamMemberPlanError};
use thiserror::Error;
use utoipa::ToSchema;

/// The paid plans a customer can subscribe to. One seat's plan; a team may
/// mix them.
pub use teams::domain::model::SeatPlan as PaidPlan;

/// The Stripe price ids behind each paid plan's per-seat subscription item.
#[derive(Debug, Clone)]
pub struct StripePrices {
    /// Premium seat price.
    pub premium: String,
    /// Max seat price, when configured.
    pub max: Option<String>,
}

impl StripePrices {
    /// The price to sell `plan` at.
    pub fn price_id(&self, plan: PaidPlan) -> Result<&str, StripeOperationError> {
        match plan {
            PaidPlan::Premium => Ok(&self.premium),
            PaidPlan::Max => self
                .max
                .as_deref()
                .ok_or(StripeOperationError::PlanUnavailable),
        }
    }

    /// Which plan a subscription item's price belongs to, if any.
    pub fn plan_for_price(&self, price_id: &str) -> Option<PaidPlan> {
        if price_id == self.premium {
            Some(PaidPlan::Premium)
        } else if self.max.as_deref() == Some(price_id) {
            Some(PaidPlan::Max)
        } else {
            None
        }
    }

    /// Every price that carries a seat item.
    pub fn seat_price_ids(&self) -> Vec<String> {
        self.seat_prices().all()
    }

    /// The same prices, for the teams crate's per-plan seat items.
    pub fn seat_prices(&self) -> SeatPrices {
        SeatPrices {
            premium: self.premium.clone(),
            max: self.max.clone(),
        }
    }
}

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
    #[error("This plan is not available yet")]
    PlanUnavailable,
    #[error("No active subscription")]
    NoSubscription,
    #[error("Already on this plan")]
    AlreadyOnPlan,
    #[error("Only team admins can change plans on a team")]
    NotTeamAdmin,
    #[error("Team plan change failed")]
    TeamPlanErr(#[from] SetTeamMemberPlanError),
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
            StripeOperationError::PlanUnavailable => StatusCode::BAD_REQUEST,
            StripeOperationError::NoSubscription => StatusCode::NOT_FOUND,
            StripeOperationError::AlreadyOnPlan => StatusCode::CONFLICT,
            StripeOperationError::NotTeamAdmin => StatusCode::FORBIDDEN,
            StripeOperationError::TeamPlanErr(e) => match e {
                SetTeamMemberPlanError::TeamNotPaying => StatusCode::PAYMENT_REQUIRED,
                SetTeamMemberPlanError::CustomerError(CustomerError::PlanUnavailable(_)) => {
                    StatusCode::BAD_REQUEST
                }
                SetTeamMemberPlanError::TeamError(_)
                | SetTeamMemberPlanError::CustomerError(_)
                | SetTeamMemberPlanError::RolesError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            },
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
