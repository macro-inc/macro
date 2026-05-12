//! Team access extractor.
//!
//! Unlike the other access extractors, this one does not take a team id from
//! the path — it resolves whichever team the authenticated user belongs to
//! and reports the role they hold.

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
use model_user::axum_extractor::MacroUserExtractor;

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

        let team_info = service
            .get_user_team(&macro_user_id)
            .await
            .map_err(ExtractorError::from)?;

        let Some(team_info) = team_info else {
            return Ok(Self {
                entity_access_receipt: None,
                _marker: PhantomData,
            });
        };

        let permission = EntityPermission::TeamRole {
            role: team_info.role,
        };

        if !permission.satisfies::<T>() {
            return Ok(Self {
                entity_access_receipt: None,
                _marker: PhantomData,
            });
        }

        Ok(Self {
            entity_access_receipt: Some(EntityAccessReceipt {
                entity: Entity {
                    entity_id: team_info.team_id.to_string(),
                    entity_type: EntityType::Team,
                },
                auth: EntityAccessAuth::Authenticated(macro_user_id),
                entity_permission: permission,
                _marker: PhantomData,
            }),
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

        let team_info = service
            .get_user_team(&macro_user_id)
            .await
            .map_err(ExtractorError::from)?;

        let Some(team_info) = team_info else {
            return Err(ExtractorError::UnauthorizedWithMessage("not in a team"));
        };

        let permission = EntityPermission::TeamRole {
            role: team_info.role,
        };

        if !permission.satisfies::<T>() {
            return Err(ExtractorError::UnauthorizedWithMessage(
                "you do not have a high enough role",
            ));
        }

        Ok(Self {
            entity_access_receipt: EntityAccessReceipt {
                entity: Entity {
                    entity_id: team_info.team_id.to_string(),
                    entity_type: EntityType::Team,
                },
                auth: EntityAccessAuth::Authenticated(macro_user_id),
                entity_permission: permission,
                _marker: PhantomData,
            },
            _marker: PhantomData,
        })
    }
}
