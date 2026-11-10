//! Composition of saved-view storage with the Teams-owned membership reader.
use macro_user_id::user_id::MacroUserIdStr;
use saved_views::{
    PgViewStorage,
    domain::{ChangeNotifier, MembershipPort, SavedViewService},
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

/// The composed service: Postgres storage, Teams membership evidence, and
/// connection-gateway pushes for each committed change.
pub type DssSavedViewService = SavedViewService<
    PgViewStorage,
    Membership,
    crate::outbound::saved_view_changes::ConnectionGatewaySavedViewChanges<Membership>,
>;

/// Construct the domain service with primary-backed storage and membership
/// evidence; `notifier` hears each committed change.
pub fn service<N: ChangeNotifier>(
    pool: sqlx::PgPool,
    notifier: N,
) -> SavedViewService<PgViewStorage, Membership, N> {
    SavedViewService::new(
        PgViewStorage::new(pool.clone()),
        Membership(TeamRepositoryImpl::new(pool)),
        notifier,
    )
}
