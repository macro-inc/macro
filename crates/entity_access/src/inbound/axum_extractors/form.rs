//! Form access extractor: a form's grants are its own `entity_access` rows,
//! and a form whose audience is public is viewable by anyone, signed in or
//! not.

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
    AnyPrincipal, MacroAuthorization, MacroAuthorizationService, MacroAuthorizationState,
    OptionalMacroAuthorizationExtractor,
};
use tracing::Level;

use super::{ExtractorError, bot::generate_bot_entity_access_receipt};
use crate::domain::{
    models::{
        AccessLevel, Entity, EntityAccessReceipt, EntityPermission, EntityType, RequiredPermission,
    },
    ports::EntityAccessService,
};

#[derive(Debug, serde::Deserialize)]
struct FormAccessParams {
    id: String,
}

/// Validates that the caller satisfies the required permission for the form
/// named by an `id` path parameter.
///
/// A request with no credentials asks the form's public audience: a public,
/// live form yields a View receipt with
/// [`EntityAccessAuth::Unauthenticated`](crate::domain::models::EntityAccessAuth::Unauthenticated).
/// Anything above View can never be met anonymously, so such requirements are
/// refused before any lookup.
///
/// `Permission` is the required permission marker, `AccessService` the entity
/// access service implementation, and `Authorization` the authorization
/// service implementation.
#[derive(Debug)]
pub struct FormAccessLevelExtractor<Permission: RequiredPermission, AccessService, Authorization> {
    /// The entity access receipt for the form.
    pub entity_access_receipt: EntityAccessReceipt<Permission>,
    _marker: PhantomData<(Permission, AccessService, Authorization)>,
}

impl<Permission, State, AccessService, Authorization> FromRequestParts<State>
    for FormAccessLevelExtractor<Permission, AccessService, Authorization>
where
    Permission: RequiredPermission,
    Arc<AccessService>: FromRef<State>,
    AccessService: EntityAccessService,
    MacroAuthorizationState<Authorization>: FromRef<State>,
    Authorization: MacroAuthorizationService,
    State: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err(level = Level::INFO), skip(state, parts))]
    async fn from_request_parts(parts: &mut Parts, state: &State) -> Result<Self, Self::Rejection> {
        let service = <Arc<AccessService>>::from_ref(state);

        let authorization =
            OptionalMacroAuthorizationExtractor::<Authorization, AnyPrincipal>::from_request_parts(
                parts, state,
            )
            .await
            .map_err(ExtractorError::from)?;

        let Path(FormAccessParams { id: form_id }) = parts
            .extract::<Path<FormAccessParams>>()
            .await
            .map_err(|_| ExtractorError::BadRequest("missing id path parameter"))?;

        if let Some(MacroAuthorization::Bot(authentication)) = authorization.authorization.as_ref()
        {
            let entity_access_receipt = generate_bot_entity_access_receipt::<Permission>(
                service.as_ref(),
                authentication,
                &form_id,
                EntityType::Form,
            )
            .await?;

            return Ok(Self {
                entity_access_receipt,
                _marker: PhantomData,
            });
        }

        let is_internal_access = authorization
            .authorization
            .as_ref()
            .is_some_and(MacroAuthorization::is_internal);
        let macro_user_id = authorization
            .authorization
            .as_ref()
            .and_then(MacroAuthorization::acting_user)
            .map(|user| user.macro_user_id.clone());

        // An internal service with no acting user is trusted: it is Macro's
        // own machinery, not a person whose grants we could look up.
        if macro_user_id.is_none() && is_internal_access {
            return Ok(Self {
                entity_access_receipt: EntityAccessReceipt::dangerously_assert_internal_user(
                    &form_id,
                    EntityType::Form,
                ),
                _marker: PhantomData,
            });
        }

        let Some(macro_user_id) = macro_user_id else {
            return public_receipt(service.as_ref(), form_id).await;
        };

        let permission = service
            .get_entity_permission(Some(&macro_user_id), &form_id, EntityType::Form, None)
            .await
            .map_err(ExtractorError::from)?;

        Ok(Self {
            entity_access_receipt: EntityAccessReceipt::try_new_authenticated_user(
                macro_user_id,
                Entity {
                    entity_id: form_id,
                    entity_type: EntityType::Form,
                },
                permission,
            )?,
            _marker: PhantomData,
        })
    }
}

/// The receipt for a caller with no credentials, who holds View at most, so a
/// requirement View cannot meet is refused before the lookup.
async fn public_receipt<Permission, AccessService, Authorization>(
    service: &AccessService,
    form_id: String,
) -> Result<FormAccessLevelExtractor<Permission, AccessService, Authorization>, ExtractorError>
where
    Permission: RequiredPermission,
    AccessService: EntityAccessService,
{
    let form = Entity {
        entity_id: form_id,
        entity_type: EntityType::Form,
    };
    let strongest_grant = EntityPermission::AccessLevel {
        access_level: AccessLevel::Owner,
    };
    if EntityAccessReceipt::<Permission>::try_new_for_user(None, form.clone(), strongest_grant)
        .is_err()
    {
        return Err(ExtractorError::Unauthorized);
    }

    let Some(access_level) = service
        .get_access_level(None, &form.entity_id, EntityType::Form)
        .await
        .map_err(ExtractorError::from)?
    else {
        return Err(ExtractorError::Unauthorized);
    };

    Ok(FormAccessLevelExtractor {
        entity_access_receipt: EntityAccessReceipt::try_new_for_user(
            None,
            form,
            EntityPermission::AccessLevel { access_level },
        )?,
        _marker: PhantomData,
    })
}
