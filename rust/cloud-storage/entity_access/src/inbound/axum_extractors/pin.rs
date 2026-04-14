//! Pin access extractor.

use serde::de::DeserializeOwned;
use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    Json, RequestExt,
    extract::{FromRef, FromRequest, Path, Request},
};

use super::{ExtractorError, RequiredPermission};
use crate::domain::{
    models::{Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType},
    ports::EntityAccessService,
};
use model_user::axum_extractor::MacroUserExtractor;

/// Path parameters for pin routes.
#[derive(serde::Deserialize)]
pub struct PinParams {
    /// The ID of the item.
    pub pinned_item_id: String,
}

/// Json body containing the pin type
#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonBodyWithPinType {
    /// The pin type
    pub pin_type: String,
}

/// Validates the user has access to pin the particular item.
#[derive(Debug)]
pub struct PinAccessLevelExtractor<T: RequiredPermission, Svc, V> {
    /// The entity access receipt
    pub entity_access_receipt: EntityAccessReceipt<T>,
    /// The pin type extracted from the request body
    pub pin_type: JsonBodyWithPinType,
    /// Request body
    pub inner: V,
    _marker: PhantomData<(T, Svc)>,
}

impl<T, S, Svc, V> FromRequest<S> for PinAccessLevelExtractor<T, Svc, V>
where
    T: RequiredPermission,
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
    V: DeserializeOwned + std::fmt::Debug,
    S: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err, skip(req, state))]
    async fn from_request(mut req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let service = <Arc<Svc>>::from_ref(state);

        // NOTE: for pinned items, the user must exist so we explicitly do not
        // use the OptionalMacroUserExtractor
        let MacroUserExtractor { macro_user_id, .. } = req
            .extract_parts()
            .await
            .map_err(|_| ExtractorError::Internal)?;

        let Path(PinParams { pinned_item_id }) = req
            .extract_parts_with_state(state)
            .await
            .map_err(|_| ExtractorError::BadRequest("Missing pinned_item_id in path"))?;

        let Json(json): Json<serde_json::Value> = req
            .extract()
            .await
            .map_err(|_| ExtractorError::BadRequest("No body was provided"))?;

        let json_clone = json.clone();

        let JsonBodyWithPinType { pin_type } = serde_json::from_value(json)
            .map_err(|_| ExtractorError::BadRequest("body is missing pinType"))?;

        // Parse the pin_type string into EntityType
        let entity_type: EntityType = pin_type
            .parse()
            .map_err(|_| ExtractorError::BadRequest("Invalid pin_type"))?;

        let access_level = match service
            .get_access_level(Some(&macro_user_id), &pinned_item_id, entity_type)
            .await
            .map_err(ExtractorError::from)?
        {
            Some(access_level) => access_level,
            None => return Err(ExtractorError::Unauthorized),
        };

        let permission = EntityPermission::AccessLevel { access_level };
        if !permission.satisfies::<T>() {
            return Err(ExtractorError::Unauthorized);
        };

        Ok(Self {
            entity_access_receipt: EntityAccessReceipt {
                entity: Entity {
                    entity_id: pinned_item_id,
                    entity_type,
                },
                auth: EntityAccessAuth::Authenticated(macro_user_id),
                entity_permission: permission,
                _marker: PhantomData,
            },
            inner: serde_json::from_value(json_clone)
                .map_err(|_| ExtractorError::BadRequest("Invalid request body"))?,
            pin_type: JsonBodyWithPinType { pin_type },
            _marker: PhantomData,
        })
    }
}
