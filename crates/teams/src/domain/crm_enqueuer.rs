//! Outbound port for triggering CRM-fanout backfills from the teams
//! service.
//!
//! The teams service uses this to ask the email service to seed
//! (`enqueue_populate_crm_for_user`) or tear down
//! (`enqueue_depopulate_crm_for_user`) its
//! `crm_companies`/`crm_domains`/`crm_contacts`/`crm_contact_sources`
//! tables for a single user. The teams service does not know — and
//! does not need to know — that the email service consumes these via a
//! pubsub queue; the port keeps the contract to domain types only. See
//! the matching SQS adapter in `crate::outbound::crm_enqueuer`.
//!
//! Modeled on [`email::domain::ports::EmailMessageEnqueuer`].

use macro_user_id::user_id::MacroUserIdStr;

/// Asks the email service to seed or tear down the CRM tables for one
/// user. Implementations are expected to be best-effort and
/// fire-and-forget — callers (e.g. `join_team`, `remove_user_from_team`)
/// log and swallow failures rather than rolling back the team membership
/// change.
pub trait CrmEnqueuer: Clone + Send + Sync + 'static {
    /// Error type for enqueue operations.
    type Err: std::fmt::Display + std::fmt::Debug + Send;

    /// Enqueue a request to populate the CRM tables for `macro_id`. The
    /// user is expected to already be a member of a team at the time this
    /// fires — the email-service consumer re-checks team membership and
    /// per-domain killswitches, so a race with `remove_user_from_team` is
    /// safe.
    fn enqueue_populate_crm_for_user(
        &self,
        macro_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Enqueue a request to tear down `team_id`'s CRM rows sourced from
    /// `macro_id`'s email link. Counterpart to
    /// [`Self::enqueue_populate_crm_for_user`]; called from
    /// `remove_user_from_team`. The user is expected to no longer be a
    /// member of `team_id` at the time the consumer runs — `team_id` is
    /// passed explicitly because the consumer can't recover it via a
    /// fresh lookup after the removal has committed. Team deletion is
    /// handled separately by the `crm_companies.team_id` FK cascade in
    /// macrodb, so this is not invoked from `delete_team`.
    fn enqueue_depopulate_crm_for_user(
        &self,
        team_id: &uuid::Uuid,
        macro_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// No-op enqueuer for callers that don't need the CRM fan-out side
/// effect (e.g. unit tests, callers that don't have SQS wired up).
#[derive(Clone, Debug)]
pub struct NoOpCrmEnqueuer;

impl CrmEnqueuer for NoOpCrmEnqueuer {
    type Err = std::convert::Infallible;

    async fn enqueue_populate_crm_for_user(
        &self,
        _macro_id: &MacroUserIdStr<'_>,
    ) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn enqueue_depopulate_crm_for_user(
        &self,
        _team_id: &uuid::Uuid,
        _macro_id: &MacroUserIdStr<'_>,
    ) -> Result<(), Self::Err> {
        Ok(())
    }
}
