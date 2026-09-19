//! Initiative access extractor.

#[cfg(test)]
mod test;

use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    RequestPartsExt,
    extract::{FromRef, FromRequestParts, Path},
    http::request::Parts,
};
use macro_authorization::{
    AnyPrincipal, BotAuthentication, MacroAuthorization, MacroAuthorizationService,
    MacroAuthorizationState, OptionalMacroAuthorizationExtractor,
};
use macro_user_id::user_id::MacroUserIdStr;

use super::{ExtractorError, RequiredPermission, bot::generate_bot_entity_access_receipt};
use crate::domain::{
    models::{Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType},
    ports::EntityAccessService,
};

#[derive(Debug, serde::Deserialize)]
struct InitiativeAccessParams {
    initiative_id: String,
}

/// Validates that the caller satisfies the required permission for the
/// initiative named by an `initiative_id` path parameter.
///
/// Type parameter `T` specifies the required permission marker.
/// Type parameter `Svc` is the entity access service implementation.
/// Type parameter `Auth` is the authorization service implementation.
#[derive(Debug)]
pub struct InitiativeAccessExtractor<T: RequiredPermission, Svc, Auth> {
    /// The entity access receipt for the initiative.
    pub entity_access_receipt: EntityAccessReceipt<T>,
    _marker: PhantomData<(T, Svc, Auth)>,
}

#[derive(Debug)]
enum Caller<'a> {
    Bot(&'a BotAuthentication),
    InternalService,
    Person(Option<MacroUserIdStr<'static>>),
}

impl<'a> From<Option<&'a MacroAuthorization>> for Caller<'a> {
    fn from(authorization: Option<&'a MacroAuthorization>) -> Self {
        match authorization {
            Some(MacroAuthorization::Bot(bot)) => Self::Bot(bot),
            Some(MacroAuthorization::Internal(None)) => Self::InternalService,
            Some(MacroAuthorization::User(user))
            | Some(MacroAuthorization::Internal(Some(user))) => {
                Self::Person(Some(user.macro_user_id.clone()))
            }
            Some(MacroAuthorization::Harness(harness)) => {
                Self::Person(Some(harness.acting_user.macro_user_id.clone()))
            }
            None => Self::Person(None),
        }
    }
}

impl<T, S, Svc, Auth> FromRequestParts<S> for InitiativeAccessExtractor<T, Svc, Auth>
where
    T: RequiredPermission,
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
    MacroAuthorizationState<Auth>: FromRef<S>,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err, skip(state, parts))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let service = <Arc<Svc>>::from_ref(state);

        let authorization =
            OptionalMacroAuthorizationExtractor::<Auth, AnyPrincipal>::from_request_parts(
                parts, state,
            )
            .await
            .map_err(ExtractorError::from)?
            .authorization;

        let Path(InitiativeAccessParams { initiative_id }) = parts
            .extract::<Path<InitiativeAccessParams>>()
            .await
            .map_err(|_| ExtractorError::BadRequest("missing initiative_id path parameter"))?;

        let entity_access_receipt = match Caller::from(authorization.as_ref()) {
            Caller::Bot(bot) => {
                generate_bot_entity_access_receipt::<T>(
                    service.as_ref(),
                    bot,
                    &initiative_id,
                    EntityType::Initiative,
                )
                .await?
            }
            Caller::InternalService => EntityAccessReceipt::dangerously_assert_internal_user(
                &initiative_id,
                EntityType::Initiative,
            ),
            Caller::Person(user) => {
                person_receipt::<T>(service.as_ref(), user, initiative_id).await?
            }
        };

        Ok(Self {
            entity_access_receipt,
            _marker: PhantomData,
        })
    }
}

async fn person_receipt<T: RequiredPermission>(
    service: &impl EntityAccessService,
    user: Option<MacroUserIdStr<'static>>,
    initiative_id: String,
) -> Result<EntityAccessReceipt<T>, ExtractorError> {
    let access_level = service
        .get_access_level(user.as_deref(), &initiative_id, EntityType::Initiative)
        .await
        .map_err(ExtractorError::from)?
        .ok_or(ExtractorError::Unauthorized)?;

    let auth = user
        .map(EntityAccessAuth::Authenticated)
        .unwrap_or(EntityAccessAuth::Unauthenticated);

    EntityAccessReceipt::try_new(
        auth,
        Entity {
            entity_id: initiative_id,
            entity_type: EntityType::Initiative,
        },
        EntityPermission::AccessLevel { access_level },
    )
    .map_err(ExtractorError::from)
}
