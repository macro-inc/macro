//! Recent mail per sender domain across the caller's own inboxes.

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use email::domain::sender_domain_counts::{SenderDomainCount, SenderDomainCountError};
use email_api_client::domain::models::{InvalidSenderDomain, SenderDomain};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::api::context::{ApiContext, AuthorizationService};

#[cfg(test)]
mod test;

pub fn router() -> Router<ApiContext> {
    Router::new().route("/domain-counts", post(domain_counts_handler))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SenderDomainCountsRequest {
    /// 1 to 40 lowercase host names, such as `linear.app`.
    pub domains: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SenderDomainCountsResponse {
    /// One entry per requested domain, in request order.
    pub counts: Vec<SenderDomainCount>,
}

#[derive(Debug, thiserror::Error)]
pub enum SenderDomainCountsApiError {
    #[error(transparent)]
    InvalidDomain(#[from] InvalidSenderDomain),
    #[error(transparent)]
    Count(#[from] SenderDomainCountError),
}

impl IntoResponse for SenderDomainCountsApiError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::InvalidDomain(_) | Self::Count(SenderDomainCountError::DomainCount) => {
                StatusCode::BAD_REQUEST
            }
            Self::Count(SenderDomainCountError::Inboxes(_)) => StatusCode::INTERNAL_SERVER_ERROR,
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

fn parse_domains(domains: Vec<String>) -> Result<Vec<SenderDomain>, InvalidSenderDomain> {
    domains.into_iter().map(SenderDomain::new).collect()
}

/// Count mail received in the last 180 days from each sender domain, summed
/// across the caller's own inboxes and read live from Gmail or Outlook.
///
/// Counts rank senders: Gmail's are estimates and Outlook's stop at 50 per
/// inbox. A domain a provider failed on, or did not answer within about five
/// seconds, counts as 0, as does every domain when the caller has no inbox.
#[utoipa::path(
    post,
    tag = "Senders",
    path = "/email/senders/domain-counts",
    operation_id = "count_sender_domains",
    request_body = SenderDomainCountsRequest,
    responses(
            (status = 200, body = SenderDomainCountsResponse),
            (status = 400, body = ErrorResponse),
            (status = 401, body = ErrorResponse),
            (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, err)]
pub(crate) async fn domain_counts_handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Json(request): Json<SenderDomainCountsRequest>,
) -> Result<Json<SenderDomainCountsResponse>, SenderDomainCountsApiError> {
    let domains = parse_domains(request.domains)?;
    let counts = ctx
        .sender_domain_counts
        .count(&authorization.authorization.user.macro_user_id, domains)
        .await?;

    Ok(Json(SenderDomainCountsResponse { counts }))
}
