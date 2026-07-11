//! Axum extractors that mint entity access receipts for properties routes.
//!
//! Routes with `{entity_type}/{entity_id}` path parameters use these to
//! perform the access check before the handler body runs; the handler then
//! passes the minted receipt into the domain service, whose entity-scoped
//! methods only accept receipts.

use axum::{
    RequestPartsExt,
    extract::{FromRequestParts, Path},
    http::StatusCode,
    http::request::Parts,
    response::{IntoResponse, Response},
};
use entity_access::domain::ports::EntityAccessService;
use model::user::axum_extractor::{MacroUserExtractor, OptionalMacroUserExtractor};
use models_properties::EntityType;

use super::{PropertiesRouterState, properties_err_status};
use crate::domain::error::PropertiesErr;
use crate::domain::model::{EditReceipt, ViewReceipt};
use crate::domain::service::PropertiesService;

/// Path parameters for entity-scoped properties routes.
#[derive(serde::Deserialize)]
struct EntityPathParams {
    entity_type: EntityType,
    entity_id: String,
}

/// Rejection for the receipt extractors.
#[derive(Debug, thiserror::Error)]
pub enum ReceiptRejection {
    /// The route requires an authenticated user.
    #[error("Authentication required")]
    Unauthorized,
    /// The path is missing or has invalid entity parameters.
    #[error("{0}")]
    BadRequest(&'static str),
    /// Minting failed (no access, or the permission backend failed).
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
}

impl IntoResponse for ReceiptRejection {
    fn into_response(self) -> Response {
        let status_code = match &self {
            ReceiptRejection::Unauthorized => StatusCode::UNAUTHORIZED,
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

async fn entity_path_params(parts: &mut Parts) -> Result<EntityPathParams, ReceiptRejection> {
    let Path(params): Path<EntityPathParams> = parts.extract().await.map_err(|_| {
        ReceiptRejection::BadRequest("Missing or invalid entity_type / entity_id in path")
    })?;
    Ok(params)
}

/// Mints a [`ViewReceipt`] for the `{entity_type}/{entity_id}` in the route.
/// Allows anonymous callers, for publicly shared entities.
pub struct ViewReceiptExtractor(pub ViewReceipt);

impl<S, A> FromRequestParts<PropertiesRouterState<S, A>> for ViewReceiptExtractor
where
    S: PropertiesService,
    A: EntityAccessService,
{
    type Rejection = ReceiptRejection;

    #[tracing::instrument(err, skip(parts, state))]
    async fn from_request_parts(
        parts: &mut Parts,
        state: &PropertiesRouterState<S, A>,
    ) -> Result<Self, Self::Rejection> {
        let params = entity_path_params(parts).await?;

        let OptionalMacroUserExtractor {
            macro_user_id: user,
            ..
        } = parts
            .extract()
            .await
            .map_err(|_| ReceiptRejection::Unauthorized)?;

        let receipt = state
            .properties_service
            .mint_view_receipt(user.as_ref(), &params.entity_id, params.entity_type)
            .await?;

        Ok(Self(receipt))
    }
}

/// Mints an [`EditReceipt`] for the `{entity_type}/{entity_id}` in the route.
/// Requires an authenticated user.
pub struct EditReceiptExtractor(pub EditReceipt);

impl<S, A> FromRequestParts<PropertiesRouterState<S, A>> for EditReceiptExtractor
where
    S: PropertiesService,
    A: EntityAccessService,
{
    type Rejection = ReceiptRejection;

    #[tracing::instrument(err, skip(parts, state))]
    async fn from_request_parts(
        parts: &mut Parts,
        state: &PropertiesRouterState<S, A>,
    ) -> Result<Self, Self::Rejection> {
        let params = entity_path_params(parts).await?;

        let MacroUserExtractor {
            macro_user_id: user,
            ..
        } = parts
            .extract()
            .await
            .map_err(|_| ReceiptRejection::Unauthorized)?;

        let receipt = state
            .properties_service
            .mint_edit_receipt(&user, &params.entity_id, params.entity_type)
            .await?;

        Ok(Self(receipt))
    }
}
