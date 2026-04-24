//! Middleware for team access control.

use std::marker::PhantomData;

use axum::{
    Json, RequestPartsExt,
    extract::{FromRef, FromRequestParts, Path},
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;

use crate::domain::{model::TeamRole, team_repo::TeamService};

use super::{TeamPathParam, TeamRouterState};

/// Marker for member-level access
#[derive(Debug)]
pub struct MemberRole;

/// Marker for admin-level access
#[derive(Debug)]
pub struct AdminRole;

/// Marker for owner-level access
#[derive(Debug)]
pub struct OwnerRole;

trait BuildTeamAccess {
    fn into_team_role() -> TeamRole;
}

impl BuildTeamAccess for MemberRole {
    fn into_team_role() -> TeamRole {
        TeamRole::Member
    }
}

impl BuildTeamAccess for AdminRole {
    fn into_team_role() -> TeamRole {
        TeamRole::Admin
    }
}

impl BuildTeamAccess for OwnerRole {
    fn into_team_role() -> TeamRole {
        TeamRole::Owner
    }
}

/// Extractor that verifies the user has at least the required role in the team.
#[derive(Debug)]
pub struct TeamAccessRoleExtractor<Role, TS: TeamService> {
    #[expect(dead_code)]
    role: TeamRole,
    _role: PhantomData<Role>,
    _ts: PhantomData<TS>,
}

/// Errors from team access role extraction
#[derive(Debug, thiserror::Error)]
pub enum RoleAccessErr {
    /// Team id not found in path params
    #[error("Team id not found in path params")]
    MissingTeamId,
    /// User context failed to extract
    #[error("Internal server err")]
    UserContextErr,
    /// Failed to get team role
    #[error("Failed to get team role")]
    DbErr(#[from] crate::domain::model::TeamError),
    /// User is not a member of this team
    #[error("User is not a member of this team")]
    NotInTeam,
    /// User does not have access to the desired resource
    #[error("User does not have access to the desired resource")]
    NotHighEnoughAccess,
}

impl IntoResponse for RoleAccessErr {
    fn into_response(self) -> Response {
        let err = Json(ErrorResponse {
            message: self.to_string().into(),
        });
        match self {
            RoleAccessErr::MissingTeamId => (StatusCode::BAD_REQUEST, err),
            RoleAccessErr::UserContextErr => (StatusCode::INTERNAL_SERVER_ERROR, err),
            RoleAccessErr::DbErr(_) => (StatusCode::INTERNAL_SERVER_ERROR, err),
            RoleAccessErr::NotInTeam => (StatusCode::UNAUTHORIZED, err),
            RoleAccessErr::NotHighEnoughAccess => (StatusCode::UNAUTHORIZED, err),
        }
        .into_response()
    }
}

impl<S, Role, TS> FromRequestParts<S> for TeamAccessRoleExtractor<Role, TS>
where
    TeamRouterState<TS>: FromRef<S>,
    S: Send + Sync + Clone + 'static,
    Role: BuildTeamAccess,
    TS: TeamService,
{
    type Rejection = RoleAccessErr;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let router_state = TeamRouterState::<TS>::from_ref(state);

        let user_context: MacroUserExtractor = parts
            .extract()
            .await
            .map_err(|_| RoleAccessErr::UserContextErr)?;

        let Path(TeamPathParam { team_id }) = parts
            .extract()
            .await
            .map_err(|_| RoleAccessErr::MissingTeamId)?;

        let team_role = router_state
            .service
            .get_team_role(&team_id, &user_context.macro_user_id)
            .await?;

        let team_role = team_role.ok_or(RoleAccessErr::NotInTeam)?;

        if team_role < Role::into_team_role() {
            return Err(RoleAccessErr::NotHighEnoughAccess);
        }

        Ok(Self {
            role: team_role,
            _role: PhantomData,
            _ts: PhantomData,
        })
    }
}

/// Extractor that verifies the user has a specific permission, exposing the
/// user context so the handler doesn't need to extract it again.
pub struct TeamPremiumUserExtractor<TS: TeamService> {
    /// The authenticated user context, available for use by the handler.
    pub user_context: MacroUserExtractor,
    _ts: PhantomData<TS>,
}

/// Errors from premium user extraction
#[derive(Debug, thiserror::Error)]
pub enum PremiumUserErr {
    /// User context failed to extract
    #[error("Internal server error")]
    UserContextErr,
    /// Failed to fetch permissions
    #[error("Failed to fetch permissions")]
    InternalErr(#[from] crate::domain::model::TeamError),
    /// User does not have the required permission
    #[error("User does not have the required permission")]
    MissingPermission,
}

impl IntoResponse for PremiumUserErr {
    fn into_response(self) -> Response {
        let err = Json(ErrorResponse {
            message: self.to_string().into(),
        });
        match self {
            PremiumUserErr::UserContextErr | PremiumUserErr::InternalErr(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, err)
            }
            PremiumUserErr::MissingPermission => (StatusCode::FORBIDDEN, err),
        }
        .into_response()
    }
}

use roles_and_permissions::domain::model::PermissionId;

/// The permission ID required to create a team.
const CREATE_TEAM_PERMISSION: [PermissionId; 2] = [
    PermissionId::ReadProfessionalFeatures,
    PermissionId::WriteStripeSubscription,
];

impl<S, TS> FromRequestParts<S> for TeamPremiumUserExtractor<TS>
where
    TeamRouterState<TS>: FromRef<S>,
    S: Send + Sync + Clone + 'static,
    TS: TeamService,
{
    type Rejection = PremiumUserErr;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let router_state = TeamRouterState::<TS>::from_ref(state);

        let user_context: MacroUserExtractor = parts
            .extract()
            .await
            .map_err(|_| PremiumUserErr::UserContextErr)?;

        let permissions: std::collections::HashSet<PermissionId> = router_state
            .service
            .get_team_user_permissions(&user_context.macro_user_id)
            .await?;

        for perm in CREATE_TEAM_PERMISSION {
            if !permissions.contains(&perm) {
                return Err(PremiumUserErr::MissingPermission);
            }
        }

        Ok(Self {
            user_context,
            _ts: PhantomData,
        })
    }
}
