//! Composition of saved-view storage with the Teams-owned membership reader.
use macro_user_id::user_id::MacroUserIdStr;
use saved_views::{
    PgViewStorage,
    domain::{MembershipPort, SavedViewService},
};
use std::collections::HashSet;
use teams::{
    domain::{model::TeamError, team_repo::TeamRepository},
    outbound::team_repo::TeamRepositoryImpl,
};
use uuid::Uuid;

/// Teams-backed membership port for saved-view policy.
pub struct Membership(pub TeamRepositoryImpl);
impl MembershipPort for Membership {
    type Err = TeamError;

    async fn viewer_teams(&self, viewer: &str) -> Result<Vec<Uuid>, Self::Err> {
        let viewer = MacroUserIdStr::parse_from_str(viewer)
            .map_err(|error| TeamError::BadRequest(error.to_string()))?;
        Ok(self
            .0
            .get_user_teams(&viewer)
            .await?
            .into_iter()
            .map(|team| *team.id())
            .collect())
    }

    async fn team_members(&self, team: Uuid) -> Result<HashSet<String>, Self::Err> {
        Ok(self
            .0
            .get_all_team_members(&team)
            .await?
            .into_iter()
            .map(|member| member.user_id.to_string())
            .collect())
    }
}

/// Construct the domain service with primary-backed storage and membership evidence.
pub fn service(pool: sqlx::PgPool) -> SavedViewService<PgViewStorage, Membership> {
    SavedViewService::new(
        PgViewStorage::new(pool.clone()),
        Membership(TeamRepositoryImpl::new(pool)),
    )
}
