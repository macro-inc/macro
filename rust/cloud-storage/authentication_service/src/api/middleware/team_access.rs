use crate::api::team::TeamPathParam;
use axum::{
    Extension, Json, RequestPartsExt, async_trait,
    extract::{FromRef, FromRequestParts, Path},
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use model::{response::ErrorResponse, user::UserContext};
use models_team::TeamRole;
use sqlx::PgPool;
use std::marker::PhantomData;
use thiserror::Error;

trait BuildTeamAccess {
    fn into_team_role() -> TeamRole;
}

#[derive(Debug)]
pub struct MemberRole;
#[derive(Debug)]
pub struct AdminRole;
#[derive(Debug)]
pub struct OwnerRole;

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

#[derive(Debug)]
pub struct TeamAccessRoleExtractor<T> {
    #[expect(dead_code)]
    pub role: TeamRole,
    desired: PhantomData<T>,
}

#[derive(Debug, Error)]
pub enum RoleAccessErr {
    #[error("Team id not found in path params")]
    MissingTeamId,
    /// user context failed to extract
    #[error("Internal server err")]
    UserContextErr,
    #[error("Failed to get team role")]
    DbErr(#[from] anyhow::Error),
    #[error("User is not a member of this team")]
    NotInTeam,
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
            RoleAccessErr::DbErr(_error) => (StatusCode::INTERNAL_SERVER_ERROR, err),
            RoleAccessErr::NotInTeam => (StatusCode::UNAUTHORIZED, err),
            RoleAccessErr::NotHighEnoughAccess => (StatusCode::UNAUTHORIZED, err),
        }
        .into_response()
    }
}

#[async_trait]
impl<S, T> FromRequestParts<S> for TeamAccessRoleExtractor<T>
where
    PgPool: FromRef<S>,
    S: Send + Sync + Clone + 'static,
    T: BuildTeamAccess,
{
    type Rejection = RoleAccessErr;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let db = PgPool::from_ref(state);

        let Extension(UserContext { user_id, .. }) = parts
            .extract()
            .await
            .map_err(|_| RoleAccessErr::UserContextErr)?;

        let Path(TeamPathParam { team_id }) = parts
            .extract()
            .await
            .map_err(|_| RoleAccessErr::MissingTeamId)?;

        let team_role = macro_db_client::team::get::get_team_role(&db, &team_id, &user_id).await?;

        let team_role = team_role.ok_or(RoleAccessErr::NotInTeam)?;

        if team_role < T::into_team_role() {
            return Err(RoleAccessErr::NotHighEnoughAccess);
        }

        Ok(Self {
            role: team_role,
            desired: PhantomData,
        })
    }
}
