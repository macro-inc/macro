use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;
use serde::Serialize;
use utoipa::ToSchema;

use crate::domain::{
    auth::CrmTeamReceipt,
    model::{CrmBlockedDomain, CrmError},
    service::CrmService,
};

use super::CrmRouterState;

/// A domain the team keeps out of email sync.
#[derive(Debug, Serialize, ToSchema)]
pub struct CrmBlockedDomainResponse {
    /// The blocked domain, lowercase.
    pub domain: String,
    /// When it was added.
    pub created_at: DateTime<Utc>,
}

impl From<CrmBlockedDomain> for CrmBlockedDomainResponse {
    fn from(blocked: CrmBlockedDomain) -> Self {
        Self {
            domain: blocked.domain,
            created_at: blocked.created_at,
        }
    }
}

/// List the domains the caller's team keeps out of email sync,
/// alphabetically. Any team member may read.
#[utoipa::path(
    get,
    path = "/crm/blocked-domains",
    operation_id = "list_crm_blocked_domains",
    responses(
        (status = 200, body = Vec<CrmBlockedDomainResponse>),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn list_handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
) -> Result<Json<Vec<CrmBlockedDomainResponse>>, CrmError> {
    let receipt = CrmTeamReceipt::from_team_receipt(access.entity_access_receipt)?;
    let blocked = state.service.list_blocked_domains(&receipt).await?;
    Ok(Json(blocked.into_iter().map(Into::into).collect()))
}

/// Block a domain: email sync stops creating or updating CRM records for
/// it, and the company and contacts the CRM holds for it are hidden.
/// Idempotent. Requires an admin/owner team role (403).
#[utoipa::path(
    put,
    path = "/crm/blocked-domains/{domain}",
    operation_id = "block_crm_domain",
    params(("domain" = String, Path, description = "A bare domain like acme.com")),
    responses(
        (status = 204),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn block_handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Path(domain): Path<String>,
) -> Result<StatusCode, CrmError> {
    let receipt = CrmTeamReceipt::from_team_receipt(access.entity_access_receipt)?;
    state
        .service
        .set_domain_blocked(&receipt, &domain, true)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Unblock a domain: email sync resumes for it, and what blocking hid is
/// shown again. Idempotent. Requires an admin/owner team role (403).
#[utoipa::path(
    delete,
    path = "/crm/blocked-domains/{domain}",
    operation_id = "unblock_crm_domain",
    params(("domain" = String, Path, description = "A bare domain like acme.com")),
    responses(
        (status = 204),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn unblock_handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Path(domain): Path<String>,
) -> Result<StatusCode, CrmError> {
    let receipt = CrmTeamReceipt::from_team_receipt(access.entity_access_receipt)?;
    state
        .service
        .set_domain_blocked(&receipt, &domain, false)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
