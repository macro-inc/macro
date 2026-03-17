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
            message: &self.to_string(),
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
