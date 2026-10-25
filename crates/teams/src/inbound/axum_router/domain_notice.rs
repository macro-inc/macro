use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use entity_access::{
    domain::{models::AdminTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use model_error_response::ErrorResponse;
use rootcause::Report;

use crate::domain::domain_notice::{DomainNoticeError, DomainNoticeService};

/// Router state for the domain notice endpoint.
pub struct DomainNoticeRouterState<D, Eas, Auth> {
    /// The domain notice service.
    pub service: Arc<D>,
    /// The entity access service.
    pub entity_access_service: Arc<Eas>,
    /// State for request authorization.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<D, Eas, Auth> Clone for DomainNoticeRouterState<D, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<D, Eas, Auth> FromRef<DomainNoticeRouterState<D, Eas, Auth>> for Arc<Eas> {
    fn from_ref(state: &DomainNoticeRouterState<D, Eas, Auth>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<D, Eas, Auth> FromRef<DomainNoticeRouterState<D, Eas, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &DomainNoticeRouterState<D, Eas, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Response for the domain notice endpoint.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct SendDomainNoticeResponse {
    /// How many colleagues were emailed by this call.
    pub sent: u32,
}

/// Routes for the domain notice, to merge at the service root.
pub fn domain_notice_router<D, Eas, Auth, S>(state: DomainNoticeRouterState<D, Eas, Auth>) -> Router<S>
where
    D: DomainNoticeService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route("/team/domain-notice", post(handler::<D, Eas, Auth>))
        .with_state(state)
}

/// Emails the caller's contacts on the team's auto-join domain that the team
/// exists, so they can sign up and join. Contacts already on Macro, on the
/// team, invited, or emailed before are skipped, and a team emails at most 25
/// people in total. Call it after sending the team's invites. Requires the
/// caller to be an Admin or Owner of the team.
#[utoipa::path(
    post,
    path = "/team/domain-notice",
    operation_id = "send_team_domain_notice",
    responses(
        (status = 200, body = SendDomainNoticeResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<D: DomainNoticeService, Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<DomainNoticeRouterState<D, Eas, Auth>>,
) -> Result<Json<SendDomainNoticeResponse>, DomainNoticeHttpError> {
    let report = state
        .service
        .send_domain_notice(access.entity_access_receipt)
        .await
        .map_err(DomainNoticeHttpError)?;
    Ok(Json(SendDomainNoticeResponse { sent: report.sent }))
}

/// An HTTP view of [`DomainNoticeError`].
#[derive(Debug)]
pub struct DomainNoticeHttpError(Report<DomainNoticeError>);

impl std::fmt::Display for DomainNoticeHttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0.current_context())
    }
}

impl IntoResponse for DomainNoticeHttpError {
    fn into_response(self) -> Response {
        let status = match self.0.current_context() {
            DomainNoticeError::InvalidReceipt => StatusCode::BAD_REQUEST,
            DomainNoticeError::Storage => {
                tracing::error!(error = ?self.0, "domain notice failed");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        (
            status,
            Json(ErrorResponse {
                message: self.0.current_context().to_string().into(),
            }),
        )
            .into_response()
    }
}
