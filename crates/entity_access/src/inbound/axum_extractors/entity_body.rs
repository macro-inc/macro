//! Entity access extractor for entities identified in a JSON request body.

#[cfg(test)]
mod test;

use std::{marker::PhantomData, sync::Arc};

use axum::{
    Json, RequestExt,
    extract::{FromRef, FromRequest, Request},
};
use macro_authorization::{
    AnyPrincipal, MacroAuthorization, MacroAuthorizationService, MacroAuthorizationState,
    OptionalMacroAuthorizationExtractor,
};
use serde::{Deserialize, de::DeserializeOwned};

use super::{ExtractorError, RequiredPermission, bot::generate_bot_entity_access_receipt};
use crate::domain::{
    models::{Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType},
    ports::EntityAccessService,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntityBodyFields {
    entity_type: EntityType,
    entity_id: String,
}

/// Validates that an authenticated principal has access to an entity identified in the request body.
///
/// Type parameter `T` specifies the required access level, `Svc` is the entity access service,
/// `V` is the typed request body, and `Auth` is the authorization service. This extractor consumes
/// the request body and must therefore be the final body-consuming extractor in a handler.
#[derive(Debug)]
pub struct EntityBodyAccessLevelExtractor<T: RequiredPermission, Svc, V, Auth> {
    /// The receipt proving access to the entity from the request body.
    pub entity_access_receipt: EntityAccessReceipt<T>,
    /// The deserialized request body.
    pub inner: V,
    _marker: PhantomData<(T, Svc, Auth)>,
}

impl<T, S, Svc, V, Auth> FromRequest<S> for EntityBodyAccessLevelExtractor<T, Svc, V, Auth>
where
    T: RequiredPermission,
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
    MacroAuthorizationState<Auth>: FromRef<S>,
    Auth: MacroAuthorizationService,
    V: DeserializeOwned + Send,
    S: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err, skip(req, state))]
    async fn from_request(mut req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let authorization = req
            .extract_parts_with_state::<OptionalMacroAuthorizationExtractor<Auth, AnyPrincipal>, _>(
                state,
            )
            .await
            .map_err(ExtractorError::from)?
            .authorization
            .ok_or(ExtractorError::Unauthorized)?;

        if matches!(authorization, MacroAuthorization::Internal(None)) {
            return Err(ExtractorError::Unauthorized);
        }

        let Json(json): Json<serde_json::Value> = req
            .extract()
            .await
            .map_err(|_| ExtractorError::BadRequest("Invalid JSON body"))?;
        let EntityBodyFields {
            entity_type,
            entity_id,
        } = serde_json::from_value(json.clone())
            .map_err(|_| ExtractorError::BadRequest("Invalid entity body"))?;

        let service = Arc::<Svc>::from_ref(state);
        if let MacroAuthorization::Bot(authentication) = &authorization {
            let inner = deserialize_body(json)?;
            let entity_access_receipt = generate_bot_entity_access_receipt::<T>(
                service.as_ref(),
                authentication,
                &entity_id,
                entity_type,
            )
            .await?;

            return Ok(Self {
                entity_access_receipt,
                inner,
                _marker: PhantomData,
            });
        }

        let user = match authorization {
            MacroAuthorization::User(user) | MacroAuthorization::Internal(Some(user)) => {
                user.macro_user_id
            }
            MacroAuthorization::Harness(_) => return Err(ExtractorError::Unauthorized),
            MacroAuthorization::Bot(_) | MacroAuthorization::Internal(None) => {
                unreachable!("bot and identity-less internal access returned above")
            }
        };
        let access_level = service
            .get_access_level(Some(&user), &entity_id, entity_type)
            .await
            .map_err(ExtractorError::from)?
            .ok_or(ExtractorError::Unauthorized)?;
        let entity_permission = EntityPermission::AccessLevel { access_level };
        if !entity_permission.satisfies::<T>() {
            return Err(ExtractorError::Unauthorized);
        }

        Ok(Self {
            entity_access_receipt: EntityAccessReceipt {
                auth: EntityAccessAuth::Authenticated(user),
                entity: Entity {
                    entity_id,
                    entity_type,
                },
                entity_permission,
                _marker: PhantomData,
            },
            inner: deserialize_body(json)?,
            _marker: PhantomData,
        })
    }
}

fn deserialize_body<V: DeserializeOwned>(json: serde_json::Value) -> Result<V, ExtractorError> {
    serde_json::from_value(json).map_err(|_| ExtractorError::BadRequest("Invalid request body"))
}
