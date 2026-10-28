//! Transport for a form's sharing dialog, the database one verbatim.

use axum::Json;
use axum::extract::State;
use entity_access::domain::models::OwnerAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::MacroAuthorizationService;
use models_forms::FormErrorResponse;
use models_permissions::share_permission::{SharePermissionV2, UpdateSharePermissionRequestV2};

use super::access::FormReceipt;
use super::{FormsApiError, FormsRouterState};
use crate::domain::sharing::FormSharingService;

/// A form's recipients, for its owner. Link and team sharing are always
/// `null`: a form's public audience is its own setting.
#[utoipa::path(get, tag = "forms", operation_id = "get_form_permissions", path = "/forms/{id}/permissions",
    params(("id" = Uuid, Path, description = "Form id")),
    responses((status = 200, body = SharePermissionV2), (status = 401, body = FormErrorResponse), (status = 403, body = FormErrorResponse),
        (status = 404, body = FormErrorResponse), (status = 500, body = FormErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn get_form_permissions_handler<Service, EntityAccess, Authorization>(
    access: FormReceipt<OwnerAccessLevel, EntityAccess, Authorization>,
    State(state): State<FormsRouterState<Service, EntityAccess, Authorization>>,
) -> Result<Json<SharePermissionV2>, FormsApiError>
where
    Service: FormSharingService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    Ok(Json(state.service.share_permissions(access.receipt).await?))
}

/// Change a form's channel recipients, for its owner. Turning on link or
/// team sharing is refused.
#[utoipa::path(patch, tag = "forms", operation_id = "update_form_permissions", path = "/forms/{id}/permissions",
    params(("id" = Uuid, Path, description = "Form id")), request_body = UpdateSharePermissionRequestV2,
    responses((status = 200, body = SharePermissionV2), (status = 400, body = FormErrorResponse),
        (status = 401, body = FormErrorResponse), (status = 403, body = FormErrorResponse), (status = 404, body = FormErrorResponse),
        (status = 500, body = FormErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn update_form_permissions_handler<Service, EntityAccess, Authorization>(
    access: FormReceipt<OwnerAccessLevel, EntityAccess, Authorization>,
    State(state): State<FormsRouterState<Service, EntityAccess, Authorization>>,
    Json(request): Json<UpdateSharePermissionRequestV2>,
) -> Result<Json<SharePermissionV2>, FormsApiError>
where
    Service: FormSharingService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .update_share_permissions(access.receipt, request)
            .await?,
    ))
}
