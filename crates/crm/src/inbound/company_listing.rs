//! `GET /crm/companies/list`: the team's companies by most recent
//! interaction, the listing the `ListCompanies` tool returns. Mount at
//! `/crm`, beside the CRM routes.

use std::sync::Arc;

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

use crate::domain::{
    auth::CrmTeamReceipt,
    company_listing::{CompanyListQuery, CompanyListing, CompanyListingError, list_companies},
    service::CrmService,
};

/// Services the listing route runs through.
pub struct CompanyListingRouterState<Crm, Properties, Access, Authorization> {
    /// The team's companies.
    pub crm: Arc<Crm>,
    /// The companies' Stage, Owner and Revenue.
    pub properties: Arc<Properties>,
    /// Team membership for the extractor.
    pub access: Arc<Access>,
    /// Authentication state.
    pub authorization: MacroAuthorizationState<Authorization>,
}

impl<Crm, Properties, Access, Authorization> Clone
    for CompanyListingRouterState<Crm, Properties, Access, Authorization>
{
    fn clone(&self) -> Self {
        Self {
            crm: self.crm.clone(),
            properties: self.properties.clone(),
            access: self.access.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<Crm, Properties, Access, Authorization>
    FromRef<CompanyListingRouterState<Crm, Properties, Access, Authorization>> for Arc<Access>
{
    fn from_ref(state: &CompanyListingRouterState<Crm, Properties, Access, Authorization>) -> Self {
        state.access.clone()
    }
}

impl<Crm, Properties, Access, Authorization>
    FromRef<CompanyListingRouterState<Crm, Properties, Access, Authorization>>
    for MacroAuthorizationState<Authorization>
{
    fn from_ref(state: &CompanyListingRouterState<Crm, Properties, Access, Authorization>) -> Self {
        state.authorization.clone()
    }
}

/// Mount at `/crm`.
pub fn router<Crm, Properties, Access, Authorization, S>(
    state: CompanyListingRouterState<Crm, Properties, Access, Authorization>,
) -> Router<S>
where
    Crm: CrmService,
    Properties: PropertiesService,
    Access: EntityAccessService,
    Authorization: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/companies/list",
            get(list::<Crm, Properties, Access, Authorization>),
        )
        .with_state(state)
}

/// Which companies to list.
#[derive(Debug, Default, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct CompanyListParams {
    /// Text matched, ignoring case, against company names and domains.
    pub search: Option<String>,
    /// The company's own Stage, not a pipeline entry's: a label, ignoring
    /// case, or an option id.
    pub stage: Option<String>,
    /// Macro user id of the company's owner.
    pub owner_user_id: Option<String>,
    /// Also list hidden companies; team admins and owners only.
    #[serde(default)]
    pub include_hidden: bool,
    /// At most this many, 1 to 200; 50 when omitted.
    pub limit: Option<u16>,
}

/// The team's CRM companies, most recent interaction first, with each
/// company's own Stage, Owner and Revenue.
#[utoipa::path(get, path = "/crm/companies/list", operation_id = "list_crm_companies",
    params(CompanyListParams),
    responses(
        (status = 200, body = CompanyListing),
        (status = 400, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
    ))]
#[tracing::instrument(err, skip_all)]
pub async fn list<
    Crm: CrmService,
    Properties: PropertiesService,
    Access: EntityAccessService,
    Authorization: MacroAuthorizationService,
>(
    team: MacroUserTeamExtractorV2<MemberTeamRole, Access, Authorization>,
    State(state): State<CompanyListingRouterState<Crm, Properties, Access, Authorization>>,
    Query(params): Query<CompanyListParams>,
) -> Result<Json<CompanyListing>, ListingRouteError> {
    let team = CrmTeamReceipt::from_team_receipt(team.entity_access_receipt)
        .map_err(CompanyListingError::Crm)?;
    let listing = list_companies(
        &*state.crm,
        &*state.properties,
        &team,
        &CompanyListQuery {
            search: params.search,
            stage: params.stage,
            owner_user_id: params.owner_user_id,
            include_hidden: params.include_hidden,
            limit: params.limit,
        },
    )
    .await?;
    Ok(Json(listing))
}

/// A listing failure as an HTTP response.
#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub struct ListingRouteError(#[from] CompanyListingError);

impl IntoResponse for ListingRouteError {
    fn into_response(self) -> Response {
        match self.0 {
            CompanyListingError::Crm(error) => error.into_response(),
            error @ CompanyListingError::HiddenRequiresAdmin => (
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    message: error.to_string().into(),
                }),
            )
                .into_response(),
            error @ CompanyListingError::UnknownStage { .. } => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: error.to_string().into(),
                }),
            )
                .into_response(),
            error @ CompanyListingError::Properties(_) => {
                tracing::error!(error = ?error, "company listing failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "failed to load company properties".into(),
                    }),
                )
                    .into_response()
            }
        }
    }
}
