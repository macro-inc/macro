//! Pin access extractor.

#[cfg(test)]
mod test;

use serde::de::DeserializeOwned;
use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    Json, RequestExt,
    extract::{FromRef, FromRequest, Path, Request},
};
use macro_authorization::{
    AnyPrincipal, MacroAuthorization, MacroAuthorizationService, MacroAuthorizationState,
    OptionalMacroAuthorizationExtractor,
};

use super::{ExtractorError, RequiredPermission, bot::generate_bot_entity_access_receipt};
use crate::domain::{
    models::{Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType},
    ports::EntityAccessService,
};
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

/// Validates an authenticated user has access to pin the particular item.
///
/// Type parameter `T` specifies the required access level, `Svc` is the entity access service,
/// `V` is the request body, and `Auth` is the authorization service.
#[derive(Debug)]
pub struct PinAccessLevelExtractor<T: RequiredPermission, Svc, V, Auth> {
    /// The entity access receipt
    pub entity_access_receipt: EntityAccessReceipt<T>,
    /// The pin type extracted from the request body
    pub pin_type: JsonBodyWithPinType,
    /// Request body
    pub inner: V,
    _marker: PhantomData<(T, Svc, Auth)>,
}

impl<T, S, Svc, V, Auth> FromRequest<S> for PinAccessLevelExtractor<T, Svc, V, Auth>
where
    T: RequiredPermission,
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
    V: DeserializeOwned + std::fmt::Debug,
    MacroAuthorizationState<Auth>: FromRef<S>,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err, skip(req, state))]
    async fn from_request(mut req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let service = <Arc<Svc>>::from_ref(state);

        let authorization = req
            .extract_parts_with_state::<OptionalMacroAuthorizationExtractor<Auth, AnyPrincipal>, _>(
                state,
            )
            .await
            .map_err(ExtractorError::from)?
            .authorization
            .ok_or(ExtractorError::Unauthorized)?;
        let macro_user_id = match &authorization {
            MacroAuthorization::User(user) | MacroAuthorization::Internal(Some(user)) => {
                Some(user.macro_user_id.clone())
            }
            MacroAuthorization::Bot(_) => None,
            MacroAuthorization::Harness(_) | MacroAuthorization::Internal(None) => {
                return Err(ExtractorError::Unauthorized);
            }
        };

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

        let entity_access_receipt = match authorization {
            MacroAuthorization::Bot(authentication) => {
                generate_bot_entity_access_receipt::<T>(
                    service.as_ref(),
                    &authentication,
                    &pinned_item_id,
                    entity_type,
                )
                .await?
            }
            MacroAuthorization::User(_) | MacroAuthorization::Internal(Some(_)) => {
                let macro_user_id = macro_user_id.ok_or(ExtractorError::Unauthorized)?;
                let access_level = service
                    .get_access_level(Some(&macro_user_id), &pinned_item_id, entity_type)
                    .await
                    .map_err(ExtractorError::from)?
                    .ok_or(ExtractorError::Unauthorized)?;
                let permission = EntityPermission::AccessLevel { access_level };
                if !permission.satisfies::<T>() {
                    return Err(ExtractorError::Unauthorized);
                }

                EntityAccessReceipt {
                    entity: Entity {
                        entity_id: pinned_item_id,
                        entity_type,
                    },
                    auth: EntityAccessAuth::Authenticated(macro_user_id),
                    entity_permission: permission,
                    _marker: PhantomData,
                }
            }
            MacroAuthorization::Harness(_) | MacroAuthorization::Internal(None) => {
                return Err(ExtractorError::Unauthorized);
            }
        };

        Ok(Self {
            entity_access_receipt,
            inner: serde_json::from_value(json_clone)
                .map_err(|_| ExtractorError::BadRequest("Invalid request body"))?,
            pin_type: JsonBodyWithPinType { pin_type },
            _marker: PhantomData,
        })
    }
}
