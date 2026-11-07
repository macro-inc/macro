//! Handler for `GET /gtm-invite/links`.

use axum::{
    Json,
    extract::{Query, State},
};
use chrono::Utc;
use macro_authorization::MacroAuthorizationService;

use super::GtmInviteRouterState;
use super::dto::{GtmInviteLink, GtmInviteLinkList, ListGtmInviteLinksQuery};
use super::gtm_macro_staff::GtmMacroStaffExtractor;
use crate::domain::models::GtmInviteError;
use crate::domain::ports::GtmInviteService;

/// Lists invite links, newest first. Macro staff only.
#[utoipa::path(
    tag = "gtm_invite",
    get,
    path = "/gtm-invite/links",
    operation_id = "list_gtm_invite_links",
    params(ListGtmInviteLinksQuery),
    responses(
        (status = 200, body = GtmInviteLinkList),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 403, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, fields(mine = query.mine), err)]
pub async fn handler<T: GtmInviteService, R, Auth: MacroAuthorizationService>(
    State(state): State<GtmInviteRouterState<T, R, Auth>>,
    staff: GtmMacroStaffExtractor<Auth>,
    Query(query): Query<ListGtmInviteLinksQuery>,
) -> Result<Json<GtmInviteLinkList>, GtmInviteError> {
    let caller = &staff.macro_user_id;
    let links = state.service.list_links(caller, query.mine).await?;
    let free_months = state.service.config().free_months;
    let now = Utc::now();

    Ok(Json(GtmInviteLinkList {
        links: links
            .into_iter()
            .map(|link| GtmInviteLink::from_link(link, free_months, now))
            .collect(),
    }))
}
