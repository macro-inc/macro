use crate::AuthServiceClient;
use crate::error::{AuthServiceClientError, GenericErrorResponse};

#[derive(Debug, serde::Serialize)]
struct SettleAiBillingRequest<'a> {
    user_id: &'a str,
}

impl AuthServiceClient {
    /// Ask the authentication service to settle AI billing for `user_id`'s
    /// payer: apply prepaid credits to usage past the allowance and collect
    /// any chargeable overage. Idempotent; safe to call often.
    #[tracing::instrument(skip(self))]
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
            reqwest::StatusCode::UNAUTHORIZED => Err(AuthServiceClientError::Unauthorized),
            reqwest::StatusCode::FORBIDDEN => Err(AuthServiceClientError::Forbidden),
            reqwest::StatusCode::NOT_FOUND => Err(AuthServiceClientError::NotFound),
            status => {
                let body = res.text().await.map_err(|e| {
                    AuthServiceClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;
                if status == reqwest::StatusCode::INTERNAL_SERVER_ERROR {
                    Err(AuthServiceClientError::InternalServerError { details: body })
                } else {
                    Err(AuthServiceClientError::Generic(GenericErrorResponse {
                        message: body,
                    }))
                }
            }
        }
    }
}
