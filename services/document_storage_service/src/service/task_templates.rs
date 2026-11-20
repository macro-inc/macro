//! Compose task templates with primary-backed Teams membership and roles.
use macro_user_id::user_id::MacroUserIdStr;
use task_templates::{
    domain::{Membership, Service, TeamAccess},
    outbound::PgTaskTemplates,
};
use teams::{
    domain::{
        model::{TeamError, TeamRole},
        team_repo::TeamRepository,
    },
    outbound::team_repo::TeamRepositoryImpl,
};
use uuid::Uuid;

pub struct TeamsMembership(TeamRepositoryImpl);

impl Membership for TeamsMembership {
    type Err = TeamError;
    async fn access(&self, user: &str, team: Uuid) -> Result<Option<TeamAccess>, Self::Err> {
        let user = MacroUserIdStr::parse_from_str(user)
            .map_err(|error| TeamError::BadRequest(error.to_string()))?;
        Ok(self
            .0
            .get_all_team_members(&team)
            .await?
            .into_iter()
            .find(|member| member.user_id.as_ref() == user.as_ref())
            .map(|member| match member.role {
                TeamRole::Member => TeamAccess::Member,
                TeamRole::Admin | TeamRole::Owner => TeamAccess::Admin,
            }))
    }
}

pub fn service(pool: sqlx::PgPool) -> Service<PgTaskTemplates, TeamsMembership> {
    Service::new(
        PgTaskTemplates(pool.clone()),
        TeamsMembership(TeamRepositoryImpl::new(pool)),
    )
}
