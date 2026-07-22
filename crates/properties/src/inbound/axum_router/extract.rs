//! Axum extractors that mint entity access receipts for properties routes.
//!
//! Routes with `{entity_type}/{entity_id}` path parameters use these to
//! perform the access check before the handler body runs; the handler then
//! passes the minted receipt into the domain service, whose entity-scoped
//! methods only accept receipts.

use std::borrow::Cow;

use axum::{
    RequestPartsExt,
    extract::{FromRequestParts, Path},
    http::StatusCode,
    http::request::Parts,
    response::{IntoResponse, Response},
};
use entity_access::domain::models::{
    AccessLevel, EditAccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission,
    EntityType as AccessEntityType, RequiredPermission, ViewAccessLevel,
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationRejection, MacroAuthorizationService,
    OptionalMacroAuthorizationExtractor,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::api::PropertyTargetEntityType;

use super::{PropertiesRouterState, properties_err_status};
use crate::domain::error::PropertiesErr;
use crate::domain::model::{EditReceipt, ViewReceipt};
use crate::domain::service::PropertiesService;

/// Path parameters for entity-scoped properties routes.
#[derive(serde::Deserialize)]
struct EntityPathParams {
    entity_type: PropertyTargetEntityType,
    entity_id: String,
}

/// Rejection for the receipt extractors.
#[derive(Debug, thiserror::Error)]
pub enum ReceiptRejection {
    /// Request authorization failed.
    #[error("{message}")]
    Authorization {
        /// HTTP status returned by the authorization extractor.
        status: StatusCode,
        /// Error message returned by the authorization extractor.
        message: Cow<'static, str>,
    },
    /// The path is missing or has invalid entity parameters.
    #[error("{0}")]
    BadRequest(&'static str),
    /// Minting failed (no access, or the permission backend failed).
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
}

impl From<MacroAuthorizationRejection> for ReceiptRejection {
    fn from(MacroAuthorizationRejection { status, message }: MacroAuthorizationRejection) -> Self {
        Self::Authorization { status, message }
    }
}

impl IntoResponse for ReceiptRejection {
    fn into_response(self) -> Response {
        let status_code = match &self {
            ReceiptRejection::Authorization { status, .. } => *status,
            ReceiptRejection::BadRequest(_) => StatusCode::BAD_REQUEST,
            ReceiptRejection::Properties(e) => properties_err_status(e),
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "ReceiptRejection",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Convert the target-only transport enum to a canonical access entity type.
pub(crate) fn target_entity_type(entity_type: PropertyTargetEntityType) -> AccessEntityType {
    match entity_type {
        PropertyTargetEntityType::CallRecord => AccessEntityType::Call,
        PropertyTargetEntityType::Channel => AccessEntityType::Channel,
        PropertyTargetEntityType::Chat => AccessEntityType::Chat,
        PropertyTargetEntityType::Company => AccessEntityType::CrmCompany,
        PropertyTargetEntityType::Document => AccessEntityType::Document,
        PropertyTargetEntityType::Project => AccessEntityType::Project,
        PropertyTargetEntityType::Thread => AccessEntityType::EmailThread,
        PropertyTargetEntityType::User => AccessEntityType::User,
    }
}

pub(crate) async fn mint_authenticated_receipt<T, A>(
    entity_access_service: &A,
    user_id: &MacroUserIdStr<'_>,
    entity_id: &str,
    entity_type: AccessEntityType,
) -> Result<EntityAccessReceipt<T>, PropertiesErr>
where
    T: RequiredPermission,
    A: EntityAccessService,
{
    let receipt = entity_access_service
        .generate_entity_access_receipt::<T>(user_id, None, entity_id, entity_type)
        .await
        .map_err(|_| PropertiesErr::PermissionDenied)?;

    Ok(receipt)
}

pub(crate) async fn mint_view_receipt<A>(
    entity_access_service: &A,
    user_id: Option<&MacroUserIdStr<'_>>,
    entity_id: &str,
    entity_type: AccessEntityType,
) -> Result<ViewReceipt, PropertiesErr>
where
    A: EntityAccessService,
{
    if let Some(user_id) = user_id {
        return mint_authenticated_receipt::<ViewAccessLevel, A>(
            entity_access_service,
            user_id,
            entity_id,
            entity_type,
        )
        .await;
    }

    let access_level = entity_access_service
        .check_public_access(entity_id, entity_type, AccessLevel::View)
        .await
        .map_err(|_| PropertiesErr::PermissionDenied)?;
    let receipt = EntityAccessReceipt::try_new(
        EntityAccessAuth::Unauthenticated,
        Entity {
            entity_id: entity_id.to_string(),
            entity_type,
        },
        EntityPermission::AccessLevel { access_level },
    )
    .map_err(|_| PropertiesErr::PermissionDenied)?;

    Ok(receipt)
}

async fn entity_path_params(parts: &mut Parts) -> Result<EntityPathParams, ReceiptRejection> {
    let Path(params): Path<EntityPathParams> = parts.extract().await.map_err(|_| {
        ReceiptRejection::BadRequest("Missing or invalid entity_type / entity_id in path")
    })?;
    Ok(params)
}

/// Mints a [`ViewReceipt`] for the `{entity_type}/{entity_id}` in the route.
/// Allows anonymous callers, for publicly shared entities.
pub struct ViewReceiptExtractor(pub ViewReceipt);

impl<S, A, Auth> FromRequestParts<PropertiesRouterState<S, A, Auth>> for ViewReceiptExtractor
where
    S: PropertiesService,
    A: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    type Rejection = ReceiptRejection;

    #[tracing::instrument(err, skip(parts, state))]
    async fn from_request_parts(
        parts: &mut Parts,
        state: &PropertiesRouterState<S, A, Auth>,
    ) -> Result<Self, Self::Rejection> {
        let params = entity_path_params(parts).await?;

        let OptionalMacroAuthorizationExtractor {
            macro_user_id: user,
            ..
        } = parts
            .extract_with_state::<OptionalMacroAuthorizationExtractor<Auth>, _>(state)
            .await
            .map_err(ReceiptRejection::from)?;

        let receipt = mint_view_receipt(
            state.entity_access_service.as_ref(),
            user.as_ref(),
            &params.entity_id,
            target_entity_type(params.entity_type),
        )
        .await?;

        Ok(Self(receipt))
    }
}

/// Mints an [`EditReceipt`] for the `{entity_type}/{entity_id}` in the route.
/// Requires an authenticated user.
pub struct EditReceiptExtractor(pub EditReceipt);

impl<S, A, Auth> FromRequestParts<PropertiesRouterState<S, A, Auth>> for EditReceiptExtractor
where
    S: PropertiesService,
    A: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    type Rejection = ReceiptRejection;

    #[tracing::instrument(err, skip(parts, state))]
    async fn from_request_parts(
        parts: &mut Parts,
        state: &PropertiesRouterState<S, A, Auth>,
    ) -> Result<Self, Self::Rejection> {
        let params = entity_path_params(parts).await?;

        let MacroAuthorizationExtractor {
            macro_user_id: user,
            ..
        } = parts
            .extract_with_state::<MacroAuthorizationExtractor<Auth>, _>(state)
            .await
            .map_err(ReceiptRejection::from)?;

        let receipt = mint_authenticated_receipt::<EditAccessLevel, A>(
            state.entity_access_service.as_ref(),
            &user,
            &params.entity_id,
            target_entity_type(params.entity_type),
        )
        .await?;

        Ok(Self(receipt))
    }
}
