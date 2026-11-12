//! Authenticated adapters for a member's CRM email contribution settings.

use super::CrmRouterState;
use crate::domain::{
    auth::CrmTeamReceipt,
    email_privacy::{EmailPrivacyChange, EmailPrivacySettings},
    model::CrmError,
    service::CrmService,
};
use axum::{Json, extract::State};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::MacroAuthorizationService;

/// Read the caller's mailbox consent and both exclusion lists.
#[utoipa::path(get, path = "/crm/email-privacy", operation_id = "get_crm_email_privacy", responses((status = 200, body = EmailPrivacySettings)))]
pub async fn get_handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
) -> Result<Json<EmailPrivacySettings>, CrmError> {
    let access = CrmTeamReceipt::from_team_receipt(access.entity_access_receipt)?;
    Ok(Json(state.service.email_privacy(&access).await?))
}

/// Apply one consent or domain-exclusion change as the authenticated member.
#[utoipa::path(put, path = "/crm/email-privacy", operation_id = "update_crm_email_privacy", request_body = EmailPrivacyChange, responses((status = 200, body = EmailPrivacySettings)))]
pub async fn update_handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Json(change): Json<EmailPrivacyChange>,
) -> Result<Json<EmailPrivacySettings>, CrmError> {
    let access = CrmTeamReceipt::from_team_receipt(access.entity_access_receipt)?;
    Ok(Json(
        state.service.change_email_privacy(&access, change).await?,
    ))
}
