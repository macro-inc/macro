//! Outbound port for the `team_crm_settings` table and the bulk
//! teardown of a team's CRM data.
//!
//! CRM data (`crm_companies` and the cascading `crm_domains` /
//! `crm_contacts` / `crm_contact_sources` rows) is owned by macrodb,
//! same as `team_crm_settings`. We expose both behind a single port so
//! the disable flow can flip the flag and drop the data atomically in
//! one transaction.

use crate::domain::model::TeamError;

/// Repository for team-level CRM enable/disable state.
pub trait TeamCrmSettingsRepository: Clone + Send + Sync + 'static {
    /// Returns the current `crm_enabled` state for the team, or `false`
    /// if no row exists yet (the default).
    fn get_crm_enabled(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<bool, TeamError>> + Send;

    /// Upserts `crm_enabled = true` for the team. Returns `true` if
    /// this call flipped the value (previously absent or `false`), or
    /// `false` if it was already `true` (in which case the caller
    /// should skip the backfill fan-out).
    fn enable_crm(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<bool, TeamError>> + Send;

    /// Atomically upserts `crm_enabled = false` for the team and
    /// deletes every `crm_companies` row owned by the team. The FK
    /// cascade from `crm_companies` clears `crm_domains`,
    /// `crm_contacts`, and `crm_contact_sources`. Idempotent — safe to
    /// call when already disabled (the DELETE just affects zero rows).
    fn disable_crm_and_purge_data(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), TeamError>> + Send;
}

/// No-op repository for tests/callers that don't exercise CRM
/// settings. Reports CRM as disabled and treats every mutation as a
/// success without recording state.
#[derive(Clone, Debug, Default)]
pub struct NoOpTeamCrmSettingsRepository;

impl TeamCrmSettingsRepository for NoOpTeamCrmSettingsRepository {
    async fn get_crm_enabled(&self, _team_id: &uuid::Uuid) -> Result<bool, TeamError> {
        Ok(false)
    }

    async fn enable_crm(&self, _team_id: &uuid::Uuid) -> Result<bool, TeamError> {
        Ok(true)
    }

    async fn disable_crm_and_purge_data(&self, _team_id: &uuid::Uuid) -> Result<(), TeamError> {
        Ok(())
    }
}
