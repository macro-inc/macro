//! The CRM domain service as the population workers use it.

use crm::domain::{model::CrmError, service::CrmService};
use email::domain::crm_population::{ClaimedPopulation, CrmPopulator};
use uuid::Uuid;

/// Populations through the CRM service, which recomputes each one from the
/// mailbox's currently eligible mail.
pub struct CrmPopulationContacts<S>(pub S);

impl<S: CrmService> CrmPopulator for CrmPopulationContacts<S> {
    async fn team(&self, owner: &str) -> Result<Option<Uuid>, CrmError> {
        self.0.get_team_id_for_user(owner).await
    }
    async fn populate(&self, team: Uuid, claimed: &ClaimedPopulation) -> Result<(), CrmError> {
        let request = &claimed.request;
        self.0
            .populate_contact(
                &team,
                &claimed.link_id,
                &claimed.mailbox,
                &request.contact_email,
                request.contact_name.as_deref(),
                request.first_at,
                request.last_at,
                request.is_sent,
            )
            .await
    }
}
