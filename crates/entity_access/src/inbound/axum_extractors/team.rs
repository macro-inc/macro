//! Team access extractor.
//!
//! Unlike the other access extractors, this one does not take a team id from
//! the path. It resolves the team represented by the authenticated principal
//! and reports the role granted under that principal's access scope.

#[cfg(test)]
mod test;

use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    RequestPartsExt,
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
};

use super::{ExtractorError, RequiredPermission, bot::map_bot_access_scope};
use crate::domain::{
    models::{
        AccessError, BotAccessScope, Entity, EntityAccessAuth, EntityAccessReceipt,
        EntityPermission, EntityType,
    },
    ports::EntityAccessService,
};
use macro_authorization::{
    AnyPrincipal, BotAuthentication, MacroAuthorization, MacroAuthorizationExtractor,
    MacroAuthorizationService, MacroAuthorizationState,
};
use macro_user_id::user_id::MacroUserIdStr;

enum TeamAccessOutcome<T: RequiredPermission> {
    Qualifying(EntityAccessReceipt<T>),
    NotInTeam,
    InsufficientRole,
}

impl<T: RequiredPermission> TeamAccessOutcome<T> {
    fn into_optional_receipt(self) -> Option<EntityAccessReceipt<T>> {
        match self {
            Self::Qualifying(receipt) => Some(receipt),
            Self::NotInTeam | Self::InsufficientRole => None,
        }
    }

    fn into_required_receipt(self) -> Result<EntityAccessReceipt<T>, ExtractorError> {
        match self {
            Self::Qualifying(receipt) => Ok(receipt),
            Self::NotInTeam => Err(ExtractorError::UnauthorizedWithMessage("not in a team")),
            Self::InsufficientRole => Err(ExtractorError::UnauthorizedWithMessage(
                "you do not have a high enough role",
            )),
        }
    }
}

async fn user_team_access_outcome<T, Svc>(
    service: &Svc,
    macro_user_id: MacroUserIdStr<'static>,
) -> Result<TeamAccessOutcome<T>, ExtractorError>
where
    T: RequiredPermission,
    Svc: EntityAccessService,
{
    let Some(team_info) = service
        .get_user_team(&macro_user_id)
        .await
        .map_err(ExtractorError::from)?
    else {
        return Ok(TeamAccessOutcome::NotInTeam);
    };

    let permission = EntityPermission::TeamRole {
        role: team_info.role,
    };
    if !permission.satisfies::<T>() {
        return Ok(TeamAccessOutcome::InsufficientRole);
    }

    Ok(TeamAccessOutcome::Qualifying(EntityAccessReceipt {
        entity: Entity {
            entity_id: team_info.team_id.to_string(),
            entity_type: EntityType::Team,
        },
        auth: EntityAccessAuth::Authenticated(macro_user_id),
        entity_permission: permission,
        _marker: PhantomData,
    }))
}

async fn bot_team_access_outcome<T, Svc>(
    service: &Svc,
    authentication: &BotAuthentication,
) -> Result<TeamAccessOutcome<T>, ExtractorError>
where
    T: RequiredPermission,
    Svc: EntityAccessService,
{
    let scope = map_bot_access_scope(authentication)?;
    let team_id = match &scope {
        BotAccessScope::User { user_id, .. } => {
            let Some(team_info) = service
                .get_user_team(user_id)
                .await
                .map_err(ExtractorError::from)?
            else {
                return Ok(TeamAccessOutcome::NotInTeam);
            };
            team_info.team_id
        }
        BotAccessScope::Team { team_id } => *team_id,
    };

    match service
        .generate_bot_entity_access_receipt::<T>(
            authentication.bot_id,
            scope,
            &team_id.to_string(),
            EntityType::Team,
        )
        .await
    {
        Ok(receipt) => Ok(TeamAccessOutcome::Qualifying(receipt)),
        Err(AccessError::Unauthorized) => Ok(TeamAccessOutcome::InsufficientRole),
        Err(error) => Err(ExtractorError::from(error)),
    }
}

async fn principal_team_access_outcome<T, Svc>(
    service: &Svc,
    authorization: MacroAuthorization,
) -> Result<TeamAccessOutcome<T>, ExtractorError>
where
    T: RequiredPermission,
    Svc: EntityAccessService,
{
    match authorization {
        MacroAuthorization::User(user) | MacroAuthorization::Internal(Some(user)) => {
            user_team_access_outcome::<T, Svc>(service, user.macro_user_id).await
        }
        MacroAuthorization::Bot(authentication) => {
            bot_team_access_outcome::<T, Svc>(service, &authentication).await
        }
        MacroAuthorization::Harness(_) | MacroAuthorization::Internal(None) => {
            Err(ExtractorError::UnauthorizedWithMessage("unauthorized"))
        }
    }
}

/// Authorizes a principal and resolves its optional team access.
///
/// The extractor uses the required [`MacroAuthorizationExtractor`], so missing,
/// invalid, and identity-less internal credentials are rejected. A qualifying
/// team role produces a receipt; no membership or an insufficient role produces
/// `None`.
#[derive(Debug)]
pub struct OptionalMacroUserTeamExtractorV2<T: RequiredPermission, Svc, Auth> {
    /// The entity access receipt, if the principal has qualifying team access.
    pub entity_access_receipt: Option<EntityAccessReceipt<T>>,
    _marker: PhantomData<(T, Svc, Auth)>,
}

impl<T: RequiredPermission, Svc, Auth> Clone for OptionalMacroUserTeamExtractorV2<T, Svc, Auth>
where
    EntityAccessReceipt<T>: Clone,
{
    fn clone(&self) -> Self {
        Self {
            entity_access_receipt: self.entity_access_receipt.clone(),
            _marker: PhantomData,
        }
    }
}

impl<T, S, Svc, Auth> FromRequestParts<S> for OptionalMacroUserTeamExtractorV2<T, Svc, Auth>
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
        let authorization: MacroAuthorizationExtractor<Auth, AnyPrincipal> = parts
            .extract_with_state(state)
            .await
            .map_err(ExtractorError::from)?;
        let outcome =
            principal_team_access_outcome::<T, Svc>(service.as_ref(), authorization.authorization)
                .await?;

        Ok(Self {
            entity_access_receipt: outcome.into_optional_receipt(),
            _marker: PhantomData,
        })
    }
}

/// Authorizes a principal and resolves its required team access.
///
/// The extractor uses [`MacroAuthorizationExtractor`] to authenticate the request.
/// It returns an [`EntityAccessReceipt`] when the principal has team access whose
/// role satisfies `T`. A user without a team receives `"not in a team"`; a role
/// that does not satisfy `T` receives `"you do not have a high enough role"`.
#[derive(Debug)]
pub struct MacroUserTeamExtractorV2<T: RequiredPermission, Svc, Auth> {
    /// The entity access receipt for the authorized principal.
    pub entity_access_receipt: EntityAccessReceipt<T>,
    _marker: PhantomData<(T, Svc, Auth)>,
}

impl<T, S, Svc, Auth> FromRequestParts<S> for MacroUserTeamExtractorV2<T, Svc, Auth>
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
        let authorization: MacroAuthorizationExtractor<Auth, AnyPrincipal> = parts
            .extract_with_state(state)
            .await
            .map_err(ExtractorError::from)?;
        let entity_access_receipt =
            principal_team_access_outcome::<T, Svc>(service.as_ref(), authorization.authorization)
                .await?
                .into_required_receipt()?;

        Ok(Self {
            entity_access_receipt,
            _marker: PhantomData,
        })
    }
}
