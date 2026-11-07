use axum::{Json, extract::State};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use model_error_response::ErrorResponse;
use serde::Deserialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::{model::CrmError, previews::CrmPreviews, service::CrmService};

use super::CrmRouterState;

/// The CRM records whose chips to title.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CrmPreviewsRequest {
    /// Companies to preview, at most 100.
    #[serde(default)]
    pub company_ids: Vec<Uuid>,
    /// Contacts to preview, at most 100.
    #[serde(default)]
    pub contact_ids: Vec<Uuid>,
}

/// Title many CRM company and contact chips at once. Each record answers as
/// its own read (`GET /crm/companies/{company_id}`,
/// `GET /crm/contacts/{contact_id}`) would: a record the caller may not open,
/// or that does not exist, is left out of the response.
#[utoipa::path(
    post,
    path = "/crm/previews",
    operation_id = "preview_crm_records",
    request_body = CrmPreviewsRequest,
    responses(
        (status = 200, body = CrmPreviews),
        (status = 400, description = "More than 100 ids of a kind", body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, description = "A bot or harness credential"),
        (status = 422, description = "An id that is not a UUID"),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Json(request): Json<CrmPreviewsRequest>,
) -> Result<Json<CrmPreviews>, CrmError> {
    let previews = state
        .service
        .preview_records(
            user.authorization.user.macro_user_id.as_ref(),
            &request.company_ids,
            &request.contact_ids,
        )
        .await?;

    Ok(Json(previews))
}
