use axum::{
    Json,
    extract::{Path, Query, State},
};
use entity_access::domain::{models::ViewAccessLevel, ports::EntityAccessService};
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;
use models_pagination::Base64Str;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    domain::{
        model::{CrmCompanyContactsCursor, CrmCompanyContactsQuery, CrmError},
        service::CrmService,
    },
    inbound::axum_extractors::CrmCompanyAccessLevelExtractor,
};

use super::{CrmRouterState, list_company_contacts::CrmContactResponse};

/// Contacts per page when the request names no limit.
const DEFAULT_COMPANY_CONTACTS_PAGE: i64 = 50;

/// Query parameters of `GET /crm/companies/{company_id}/contacts/page`.
#[derive(Debug, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct CompanyContactsPageParams {
    /// `true` for the archived contacts (admins only: plain members get an
    /// empty list), `false` (default) for the active ones. Every contact of
    /// an archived company counts as archived.
    pub archived: Option<bool>,
    /// Keep contacts whose name or primary email contains this text,
    /// ignoring case. Blank matches every contact.
    pub query: Option<String>,
    /// Opaque cursor from the previous page's `nextCursor`.
    pub cursor: Option<String>,
    /// Contacts per page, from 1 through 200 (default 50). Values outside
    /// the range are clamped.
    #[param(minimum = 1, maximum = 200)]
    pub limit: Option<i64>,
}

/// One page of a company's contacts.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompanyContactsPageResponse {
    /// The page's contacts, alphabetically by name (the email when
    /// unnamed), in the same order as `GET /crm/companies/{company_id}/contacts`.
    pub contacts: Vec<CrmContactResponse>,
    /// Cursor for the next page; absent on the last page.
    pub next_cursor: Option<String>,
}

/// List a CRM company's contacts a page at a time, filtered by archive
/// state and an optional name or email search. Access is enforced by
/// [`CrmCompanyAccessLevelExtractor`] as for
/// `GET /crm/companies/{company_id}/contacts`; hidden contacts are
/// invisible to plain members.
#[utoipa::path(
    get,
    path = "/crm/companies/{company_id}/contacts/page",
    operation_id = "list_company_contacts_page",
    params(
        ("company_id" = Uuid, Path, description = "The CRM company whose contacts to list"),
        CompanyContactsPageParams,
    ),
    responses(
        (status = 200, body = CompanyContactsPageResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(company_id = %company_id))]
pub async fn handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: CrmCompanyAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Path(company_id): Path<Uuid>,
    Query(params): Query<CompanyContactsPageParams>,
) -> Result<Json<CompanyContactsPageResponse>, CrmError> {
    let cursor = params
        .cursor
        .map(|cursor| {
            Base64Str::<CrmCompanyContactsCursor>::new_from_string(cursor)
                .decode_json()
                .map_err(|_| CrmError::InvalidRequest("contacts cursor is invalid".into()))
        })
        .transpose()?;
    let query = CrmCompanyContactsQuery {
        archived: params.archived.unwrap_or(false),
        search: params.query.unwrap_or_default(),
        cursor,
        // The service clamps it into range.
        limit: params.limit.unwrap_or(DEFAULT_COMPANY_CONTACTS_PAGE),
    };

    let page = state
        .service
        .list_company_contacts_page(&access.receipt, query)
        .await?;

    Ok(Json(CompanyContactsPageResponse {
        contacts: page.contacts.into_iter().map(Into::into).collect(),
        next_cursor: page
            .next_cursor
            .map(|cursor| Base64Str::encode_json(cursor).to_string()),
    }))
}
