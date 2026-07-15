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
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_user::axum_extractor::MacroUserExtractor;

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

/// Resolves the authenticated user's **OPTIONAL** team membership and exposes the receipt
/// when the user satisfies the required permission `T`.
///
/// `entity_access_receipt` is:
/// - `Some(receipt)` if the user belongs to a team and their role satisfies `T`
/// - `None` if the user belongs to a team but their role does not satisfy `T`
/// - `None` if the user belongs to no team
///
/// Returns `ExtractorError::Unauthorized` if there is no authenticated user.
#[derive(Debug)]
pub struct OptionalMacroUserTeamExtractor<T: RequiredPermission, Svc> {
    /// The entity access receipt, if the user has a qualifying team membership.
    pub entity_access_receipt: Option<EntityAccessReceipt<T>>,
    _marker: PhantomData<(T, Svc)>,
}

impl<T: RequiredPermission, Svc> Clone for OptionalMacroUserTeamExtractor<T, Svc>
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

impl<T, S, Svc> FromRequestParts<S> for OptionalMacroUserTeamExtractor<T, Svc>
where
    T: RequiredPermission,
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
    S: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err, skip(state, parts))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let service = <Arc<Svc>>::from_ref(state);

        let MacroUserExtractor { macro_user_id, .. } = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Unauthorized)?;

        let outcome = team_access_outcome::<T, Svc>(service.as_ref(), macro_user_id).await?;

        Ok(Self {
            entity_access_receipt: outcome.into_optional_receipt(),
            _marker: PhantomData,
        })
    }
}

/// Authorizes a user and resolves their optional team membership.
///
/// The extractor uses the required [`MacroAuthorizationExtractor`], so missing,
/// invalid, and identity-less internal credentials are rejected. A qualifying
/// team role produces a receipt; no membership or an insufficient role produces
/// `None`.
#[allow(dead_code)]
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
        let MacroAuthorizationExtractor { macro_user_id, .. } = parts
            .extract_with_state(state)
            .await
            .map_err(ExtractorError::from)?;
        let outcome = team_access_outcome::<T, Svc>(service.as_ref(), macro_user_id).await?;

        Ok(Self {
            entity_access_receipt: outcome.into_optional_receipt(),
            _marker: PhantomData,
        })
    }
}

/// Resolves the authenticated user's team membership and exposes the receipt
/// when the user satisfies the required permission `T`.
/// Returns `ExtractorError::Unauthorized` if there is no authenticated user or no team.
#[derive(Debug)]
pub struct MacroUserTeamExtractor<T: RequiredPermission, Svc> {
    /// The entity access receipt.
    pub entity_access_receipt: EntityAccessReceipt<T>,
    _marker: PhantomData<(T, Svc)>,
}

impl<T, S, Svc> FromRequestParts<S> for MacroUserTeamExtractor<T, Svc>
where
    T: RequiredPermission,
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
    S: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err, skip(state, parts))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let service = <Arc<Svc>>::from_ref(state);

        let MacroUserExtractor { macro_user_id, .. } = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Unauthorized)?;

        let entity_access_receipt =
            match team_access_outcome::<T, Svc>(service.as_ref(), macro_user_id).await? {
                TeamAccessOutcome::Qualifying(receipt) => receipt,
                TeamAccessOutcome::NotInTeam => {
                    return Err(ExtractorError::UnauthorizedWithMessage("not in a team"));
                }
                TeamAccessOutcome::InsufficientRole => {
                    return Err(ExtractorError::UnauthorizedWithMessage(
                        "you do not have a high enough role",
                    ));
                }
            };

        Ok(Self {
            entity_access_receipt,
            _marker: PhantomData,
        })
    }
}
