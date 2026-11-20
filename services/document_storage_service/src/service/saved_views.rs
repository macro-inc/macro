//! Composition of saved-view storage with the Teams-owned membership reader.
use crm::domain::companies_repo::CompaniesRepository;
use crm::outbound::companies_repo::CompaniesRepositoryImpl;
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
pub struct Membership {
    teams: TeamRepositoryImpl,
    crm: CompaniesRepositoryImpl,
}
impl Membership {
    /// Use primary storage for both team sharing and configuration access.
    pub fn new(pool: sqlx::PgPool) -> Self {
        Self {
            teams: TeamRepositoryImpl::new(pool.clone()),
            crm: CompaniesRepositoryImpl::new(pool),
        }
    }
}
impl MembershipPort for Membership {
    type Err = TeamError;

    async fn denied_view_kinds(
        &self,
        viewer: &str,
        kinds: &HashSet<String>,
    ) -> Result<HashSet<String>, Self::Err> {
        let restricted: HashSet<_> = kinds
            .iter()
            .filter(|kind| matches!(kind.as_str(), "crm" | "crm-list"))
            .cloned()
            .collect();
        if restricted.is_empty() {
            return Ok(restricted);
        }
        let access = self
            .crm
            .current_member_access(viewer)
            .await
            .map_err(|error| TeamError::StorageLayerError(error.into()))?;
        Ok(if access.is_some_and(|(_, allowed)| allowed) {
            HashSet::new()
        } else {
            restricted
        })
    }

    async fn viewer_teams(&self, viewer: &str) -> Result<Vec<Uuid>, Self::Err> {
        let viewer = MacroUserIdStr::parse_from_str(viewer)
            .map_err(|error| TeamError::BadRequest(error.to_string()))?;
        Ok(self
            .teams
            .get_user_teams(&viewer)
            .await?
            .into_iter()
            .map(|team| *team.id())
            .collect())
    }

    async fn team_members(&self, team: Uuid) -> Result<HashSet<String>, Self::Err> {
        Ok(self
            .teams
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
        Membership::new(pool),
        notifier,
    )
}
