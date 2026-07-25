//! Team access extractor.
//!
//! Unlike the other access extractors, this one does not take a team id from
//! the path — it resolves whichever team the authenticated user belongs to
//! and reports the role they hold.

#[cfg(test)]
mod test;

use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    RequestPartsExt,
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
};

use super::{ExtractorError, RequiredPermission};
use crate::domain::{
    models::{Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType},
    ports::EntityAccessService,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
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

async fn team_access_outcome<T, Svc>(
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

/// Authorizes a user and resolves their optional team membership.
///
/// The extractor uses the required [`MacroAuthorizationExtractor`], so missing,
/// invalid, and identity-less internal credentials are rejected. A qualifying
/// team role produces a receipt; no membership or an insufficient role produces
/// `None`.
#[derive(Debug)]
pub struct OptionalMacroUserTeamExtractorV2<T: RequiredPermission, Svc, Auth> {
    /// The entity access receipt, if the authorized user has a qualifying team membership.
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
        let authorization: MacroAuthorizationExtractor<Auth, UserOrInternal> = parts
            .extract_with_state(state)
            .await
            .map_err(ExtractorError::from)?;
        let outcome = team_access_outcome::<T, Svc>(
            service.as_ref(),
            authorization.authorization.user.macro_user_id,
        )
        .await?;

        Ok(Self {
            entity_access_receipt: outcome.into_optional_receipt(),
            _marker: PhantomData,
        })
    }
}

/// Authorizes a user and resolves their required team membership.
///
/// The extractor uses [`MacroAuthorizationExtractor`] to authenticate the request.
/// It returns an [`EntityAccessReceipt`] when the user belongs to a team and their
/// role satisfies `T`. A user without a team receives `"not in a team"`; a user
/// whose role does not satisfy `T` receives `"you do not have a high enough role"`.
#[derive(Debug)]
pub struct MacroUserTeamExtractorV2<T: RequiredPermission, Svc, Auth> {
    /// The entity access receipt for the authorized team member.
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
        let authorization: MacroAuthorizationExtractor<Auth, UserOrInternal> = parts
            .extract_with_state(state)
            .await
            .map_err(ExtractorError::from)?;
        let entity_access_receipt = team_access_outcome::<T, Svc>(
            service.as_ref(),
            authorization.authorization.user.macro_user_id,
        )
        .await?
        .into_required_receipt()?;

        Ok(Self {
            entity_access_receipt,
            _marker: PhantomData,
        })
    }
}
