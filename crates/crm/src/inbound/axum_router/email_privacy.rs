//! Authenticated adapters for a member's CRM email contribution settings.

use super::CrmRouterState;
use crate::domain::{
    auth::CrmTeamReceipt,
    email_privacy::{EmailPrivacyChange, EmailPrivacySettings, ExcludedEmailThreads},
    model::CrmError,
    service::CrmService,
};
use axum::{
    Json,
    extract::{Query, State},
};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::MacroAuthorizationService;

/// Keyset cursor for the member's excluded threads.
#[derive(serde::Deserialize, utoipa::IntoParams)]
pub struct ExcludedThreadsQuery {
    /// Read entries after this thread ID.
    pub after: Option<uuid::Uuid>,
}

/// List only the authenticated member's thread exclusions.
#[utoipa::path(get, path = "/crm/email-privacy/threads", operation_id = "list_crm_excluded_email_threads", params(ExcludedThreadsQuery), responses((status = 200, body = ExcludedEmailThreads)))]
pub async fn excluded_threads_handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Query(query): Query<ExcludedThreadsQuery>,
) -> Result<Json<ExcludedEmailThreads>, CrmError> {
    let access = CrmTeamReceipt::from_team_receipt(access.entity_access_receipt)?;
    Ok(Json(
        state
            .service
            .excluded_email_threads(&access, query.after)
            .await?,
    ))
}

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

/// Apply one consent, domain, or thread exclusion change as the member.
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
