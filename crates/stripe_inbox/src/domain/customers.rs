//! Stripe customers as the inbox holds them: from `customer.*` events, or
//! read from Stripe once when a consumer needs one the inbox never saw.

use std::sync::Arc;

use chrono::Utc;
use stripe::CustomerId;

use super::model::{ApplyError, CustomerFacts, ObjectKind, ObjectSnapshot};
use super::ports::{InboxRepo, StripeReader};
use super::translate;

/// Customer lookups for consumers.
pub struct StripeCustomers<Repo, Reader> {
    repo: Repo,
    reader: Arc<Reader>,
}

impl<Repo, Reader> StripeCustomers<Repo, Reader>
where
    Repo: InboxRepo,
    Reader: StripeReader,
{
    /// Lookups over the inbox's snapshots, reading through `reader`.
    pub fn new(repo: Repo, reader: Arc<Reader>) -> Self {
        Self { repo, reader }
    }

    /// The customer as held, without calling Stripe.
    pub async fn held(&self, customer: &CustomerId) -> Result<Option<CustomerFacts>, ApplyError> {
        let held = self
            .repo
            .customer_snapshot(customer)
            .await
            .map_err(|error| ApplyError::Retry(rootcause::Report::new(error).into_dynamic()))?;
        held.map(|(snapshot, deleted)| translate::customer_facts(&snapshot, deleted))
            .transpose()
            .map_err(|error| ApplyError::Reject(rootcause::Report::new(error).into_dynamic()))
    }

    /// The customer as held, or read from Stripe once and then held.
    pub async fn fetch(&self, customer: &CustomerId) -> Result<CustomerFacts, ApplyError> {
        if let Some(held) = self.held(customer).await? {
            return Ok(held);
        }
        let read_at = Utc::now();
        let snapshot = self
            .reader
            .retrieve_customer(customer)
            .await
            .map_err(|error| ApplyError::Retry(rootcause::Report::new(error).into_dynamic()))?;
        let facts = translate::customer_facts(&snapshot, false)
            .map_err(|error| ApplyError::Reject(rootcause::Report::new(error).into_dynamic()))?;
        self.repo
            .store_read(
                &[ObjectSnapshot {
                    id: facts.id.to_string(),
                    kind: ObjectKind::Customer,
                    customer: Some(facts.id.to_string()),
                    snapshot,
                    deleted: facts.deleted,
                }],
                read_at,
                None,
            )
            .await
            .map_err(|error| ApplyError::Retry(rootcause::Report::new(error).into_dynamic()))?;
        Ok(facts)
    }
}
