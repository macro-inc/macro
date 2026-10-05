use crate::AuthServiceClient;
use crate::error::{AuthServiceClientError, GenericErrorResponse};
use chrono::{DateTime, Utc};
use std::time::Duration;
use uuid::Uuid;

/// The user's AI request waits on this read, and the caller falls back to a
/// default period when the read fails, so the read gets less time than the
/// client-wide timeout.
const SUBSCRIPTION_PERIOD_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, serde::Serialize)]
struct SettleAiBillingRequest<'a> {
    user_id: &'a str,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SubscriptionPeriodQuery<'a> {
    customer_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    team_id: Option<Uuid>,
}

/// A Stripe subscription's current billing period, `[start, end)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
pub struct AiSubscriptionPeriod {
    /// First instant of the period.
    pub start: DateTime<Utc>,
    /// First instant after the period.
    pub end: DateTime<Utc>,
}

impl AuthServiceClient {
    /// Ask the authentication service to settle AI billing for `user_id`'s
    /// payer: apply prepaid credits to usage past the allowance and collect
    /// any chargeable overage. Idempotent; safe to call often.
    ///
    /// `user_id` is the payer's `macro|email` identity, so it stays out of
    /// the span.
    #[tracing::instrument(skip(self, user_id))]
    pub async fn settle_ai_billing(&self, user_id: &str) -> Result<(), AuthServiceClientError> {
        let res = self
            .client
            .post(format!("{}/internal/ai-billing/settle", self.url))
            .json(&SettleAiBillingRequest { user_id })
            .send()
            .await
            .map_err(|e| AuthServiceClientError::RequestBuildError {
                details: e.to_string(),
            })?;

        match res.status() {
            reqwest::StatusCode::OK | reqwest::StatusCode::NO_CONTENT => Ok(()),
            _ => Err(error_for_status(res).await),
        }
    }

    /// The current Stripe subscription period for `customer_id` in the personal
    /// scope (`team_id` is `None`) or the team scope. `Ok(None)` when no active
    /// or trialing subscription matches.
    #[tracing::instrument(skip(self), err)]
    pub async fn ai_subscription_period(
        &self,
        customer_id: &str,
        team_id: Option<Uuid>,
    ) -> Result<Option<AiSubscriptionPeriod>, AuthServiceClientError> {
        let res = self
            .client
            .get(format!(
                "{}/internal/ai-billing/subscription-period",
                self.url
            ))
            .query(&SubscriptionPeriodQuery {
                customer_id,
                team_id,
            })
            .timeout(SUBSCRIPTION_PERIOD_TIMEOUT)
            .send()
            .await
            .map_err(|e| AuthServiceClientError::RequestBuildError {
                details: e.to_string(),
            })?;

        match res.status() {
            reqwest::StatusCode::OK => res.json().await.map(Some).map_err(|e| {
                AuthServiceClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            }),
            reqwest::StatusCode::NO_CONTENT => Ok(None),
            _ => Err(error_for_status(res).await),
        }
    }
}

/// The error for a response outside the endpoint's success statuses.
async fn error_for_status(res: reqwest::Response) -> AuthServiceClientError {
    match res.status() {
        reqwest::StatusCode::UNAUTHORIZED => AuthServiceClientError::Unauthorized,
        reqwest::StatusCode::FORBIDDEN => AuthServiceClientError::Forbidden,
        reqwest::StatusCode::NOT_FOUND => AuthServiceClientError::NotFound,
        status => match res.text().await {
            Err(e) => AuthServiceClientError::Generic(GenericErrorResponse {
                message: e.to_string(),
            }),
            Ok(body) if status == reqwest::StatusCode::INTERNAL_SERVER_ERROR => {
                AuthServiceClientError::InternalServerError { details: body }
            }
            Ok(body) => AuthServiceClientError::Generic(GenericErrorResponse { message: body }),
        },
    }
}
