//! Pin access extractor.

use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    Extension, Json, RequestExt, async_trait,
    extract::{FromRef, FromRequest, Path, Request},
};
use serde::de::DeserializeOwned;

use super::{ExtractorError, RequiredAccessLevel};
use crate::domain::{
    models::{AccessLevel, EntityType},
    ports::EntityAccessService,
};
use model::user::UserContext;

/// Path parameters for pin routes.
#[derive(serde::Deserialize)]
pub struct PinParams {
    /// The ID of the item being pinned.
    pub pinned_item_id: String,
}

/// JSON body containing the pin type.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonBodyWithPinType {
    /// The type of item being pinned (e.g., "document", "chat").
    pub pin_type: String,
}

/// Validates the user has access to pin the particular item.
///
/// Extracts the item ID from the path and the item type from the request body.
#[derive(Debug)]
pub struct PinAccessLevelExtractor<T, V, Svc> {
    /// The actual access level the user has, guaranteed to be >= T.
    pub access_level: AccessLevel,
    /// The type of pin extracted from the request body.
    pub pin_type: JsonBodyWithPinType,
    /// The full parsed request body.
    pub inner: V,
    _marker: PhantomData<(T, Svc)>,
}

#[async_trait]
impl<T, S, V, Svc> FromRequest<S> for PinAccessLevelExtractor<T, V, Svc>
where
    T: RequiredAccessLevel,
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
    V: DeserializeOwned + std::fmt::Debug,
    S: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err, skip(req, state))]
    async fn from_request(mut req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let service = <Arc<Svc>>::from_ref(state);

        let user_context: Extension<UserContext> = req
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
            .map_err(|_| ExtractorError::BadRequest("Invalid JSON body"))?;

        let json_clone = json.clone();

        let JsonBodyWithPinType { pin_type } = serde_json::from_value(json)
            .map_err(|_| ExtractorError::BadRequest("Missing pin_type in body"))?;

        // Parse the pin_type string into EntityType
        let entity_type: EntityType = pin_type
            .parse()
            .map_err(|_| ExtractorError::BadRequest("Invalid pin_type"))?;

        // Check access via service
        let required_level = T::required_level();
        let access_level = service
            .check_access(
                &user_context.user_id,
                &pinned_item_id,
                entity_type,
                required_level,
            )
            .await
            .map_err(ExtractorError::from)?;

        let inner: V = serde_json::from_value(json_clone)
            .map_err(|_| ExtractorError::BadRequest("Invalid request body"))?;

        Ok(Self {
            access_level,
            pin_type: JsonBodyWithPinType { pin_type },
            inner,
            _marker: PhantomData,
        })
    }
}
