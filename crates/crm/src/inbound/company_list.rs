//! `GET /crm/companies`: the caller's team's companies, filtered the way the
//! `ListCompanies` tool filters them, for SDK programs.

use std::sync::Arc;

use ai_toolset::RequestContext;
use axum::{
    Json, Router,
    extract::{FromRef, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use model_error_response::ErrorResponse;
use properties::PropertiesService;
use serde::Deserialize;
use utoipa::IntoParams;

use crate::domain::service::CrmService;
use crate::inbound::toolset::{
    CrmToolContext,
    list_companies::{
        ListCompanies, ListCompaniesError, ListCompaniesResponse, list_team_companies,
    },
};

#[cfg(all(test, feature = "outbound"))]
mod test;

/// Router state: the services the `ListCompanies` tool reads, and caller
/// authorization.
pub struct CompanyListState<C, Eas, P, Auth>
where
    C: CrmService,
    Eas: EntityAccessService,
    P: PropertiesService,
{
    /// The services the listing reads.
    pub tools: CrmToolContext<C, Eas, P>,
    /// State used to authorize the caller.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<C, Eas, P, Auth> Clone for CompanyListState<C, Eas, P, Auth>
where
    C: CrmService,
    Eas: EntityAccessService,
    P: PropertiesService,
{
    fn clone(&self) -> Self {
        Self {
            tools: self.tools.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<C, Eas, P, Auth> FromRef<CompanyListState<C, Eas, P, Auth>> for Arc<Eas>
where
    C: CrmService,
    Eas: EntityAccessService,
    P: PropertiesService,
{
    fn from_ref(state: &CompanyListState<C, Eas, P, Auth>) -> Self {
        Arc::clone(&state.tools.entity_access_service)
    }
}

impl<C, Eas, P, Auth> FromRef<CompanyListState<C, Eas, P, Auth>> for MacroAuthorizationState<Auth>
where
    C: CrmService,
    Eas: EntityAccessService,
    P: PropertiesService,
{
    fn from_ref(state: &CompanyListState<C, Eas, P, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// `GET /companies`, to nest under `/crm`.
pub fn router<C, Eas, P, Auth, S>(state: CompanyListState<C, Eas, P, Auth>) -> Router<S>
where
    C: CrmService,
    Eas: EntityAccessService,
    P: PropertiesService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route("/companies", get(handler::<C, Eas, P, Auth>))
        .with_state(state)
}

/// Filters for listing the caller's team's CRM companies.
#[derive(Debug, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query, rename_all = "camelCase")]
pub struct ListCompaniesParams {
    /// Case-insensitive substring of a company name or domain.
    pub search: Option<String>,
    /// The company's own Stage property: a stage label (case-insensitive) or
    /// stage option id.
    pub stage: Option<String>,
    /// Only companies whose Owner property is this Macro user id.
    pub owner_user_id: Option<String>,
    /// Also include hidden companies (team admin or owner only).
    pub include_hidden: Option<bool>,
    /// Maximum companies to return (1-200, default 50).
    pub limit: Option<u16>,
}

/// List the caller's team's CRM companies, most recent interaction first,
/// with each company's own Stage, Owner and Revenue.
#[utoipa::path(
    get,
    path = "/crm/companies",
    operation_id = "list_companies",
    params(ListCompaniesParams),
    responses(
        (status = 200, body = ListCompaniesResponse),
        (status = 400, body = ErrorResponse, description = "Unknown stage"),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse, description = "Hidden companies need team admin or owner"),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<C, Eas, P, Auth>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<CompanyListState<C, Eas, P, Auth>>,
    Query(params): Query<ListCompaniesParams>,
) -> Result<Json<ListCompaniesResponse>, CompanyListError>
where
    C: CrmService,
    Eas: EntityAccessService,
    P: PropertiesService,
    Auth: MacroAuthorizationService,
{
    let Some(user) = access.entity_access_receipt.acting_user_id() else {
        return Err(CompanyListError::NoUser);
    };
    let filters = ListCompanies {
        search: params.search,
        stage: params.stage,
        owner_user_id: params.owner_user_id,
        include_hidden: params.include_hidden,
        limit: params.limit,
    };
    list_team_companies(&state.tools, &RequestContext::new(user.clone()), &filters)
        .await
        .map(Json)
        .map_err(CompanyListError::Listing)
}

/// A failed listing, as an HTTP response.
#[derive(Debug, thiserror::Error)]
pub enum CompanyListError {
    /// The caller acts for no user, so has no team CRM.
    #[error("listing CRM companies needs a signed-in user")]
    NoUser,
    /// The listing itself failed.
    #[error(transparent)]
    Listing(ListCompaniesError),
}

impl IntoResponse for CompanyListError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::NoUser => StatusCode::UNAUTHORIZED,
            Self::Listing(ListCompaniesError::AdminRequired) => StatusCode::FORBIDDEN,
            Self::Listing(ListCompaniesError::UnknownStage(_)) => StatusCode::BAD_REQUEST,
            Self::Listing(ListCompaniesError::Failed(error)) => {
                tracing::error!(error = ?error.internal_error, "could not list CRM companies");
                StatusCode::INTERNAL_SERVER_ERROR
            }
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
