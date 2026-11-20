//! Asking for populations: one queued message per correspondent at a time.

use super::ports::{PendingContacts, PopulationQueue};
use models_email::service::backfill::{PopulateCrmContactPayload, PopulateCrmPolicyPayload};
use models_email::service::crm_population::{CrmPopulationContact, CrmPopulationMessage};
use uuid::Uuid;

/// Records population requests and sends the messages they need.
#[derive(Clone)]
pub struct CrmPopulationRequests<P, Q> {
    /// Pending entries with their merged hints.
    pub pending: P,
    /// The population queue.
    pub queue: Q,
}

impl<P: PendingContacts, Q: PopulationQueue> CrmPopulationRequests<P, Q> {
    /// Asks for each correspondent of `link` to be populated.
    ///
    /// A correspondent whose message is still queued only merges its hints
    /// into the pending entry. When the entries cannot be read, every request
    /// is sent with a claim no entry holds: duplicates cost a population each,
    /// and a missing request would leave the CRM behind until the next mail.
    /// If sending fails the claims are given back, so a retry sends again.
    #[tracing::instrument(
        name = "crm.population.request",
        skip_all,
        fields(link_id = %link_id, requested = contacts.len(), sent = tracing::field::Empty),
        err
    )]
    pub async fn request(
        &self,
        link_id: Uuid,
        contacts: Vec<PopulateCrmContactPayload>,
    ) -> anyhow::Result<()> {
        if contacts.is_empty() {
            return Ok(());
        }

        let claims = match self.pending.record(link_id, &contacts).await {
            Ok(claims) => claims,
            Err(error) => {
                tracing::warn!(error = ?error, "could not record CRM population requests; sending each");
                contacts.iter().map(|_| Some(Uuid::now_v7())).collect()
            }
        };
        let claimed: Vec<(Uuid, PopulateCrmContactPayload)> = claims
            .into_iter()
            .zip(contacts)
            .filter_map(|(claim, contact)| claim.map(|claim| (claim, contact)))
            .collect();
        tracing::Span::current().record("sent", claimed.len());
        if claimed.is_empty() {
            return Ok(());
        }

        let messages = claimed
            .iter()
            .map(|(claim, contact)| {
                let message = CrmPopulationMessage::Contact(CrmPopulationContact {
                    link_id,
                    claim: *claim,
                    contact: contact.clone(),
                });
                (*claim, message)
            })
            .collect();
        if let Err(error) = self.queue.send(messages).await {
            if let Err(release_error) = self.pending.release(link_id, &claimed).await {
                tracing::warn!(error = ?release_error, "could not release unsent CRM population claims");
            }
            return Err(error);
        }
        Ok(())
    }
}

/// Queues one page of a mailbox's durable email history. Pages are not
/// merged: the history's own cursor decides what each one covers.
pub async fn queue_policy_page<Q: PopulationQueue>(
    queue: &Q,
    page: PopulateCrmPolicyPayload,
) -> anyhow::Result<()> {
    queue
        .send(vec![(
            Uuid::now_v7(),
            CrmPopulationMessage::PolicyPage(page),
        )])
        .await
}
