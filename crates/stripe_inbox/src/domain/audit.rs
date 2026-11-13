//! The daily detect-only audit: finds webhooks we never received, types we
//! receive but nobody applies, snapshots that drifted from Stripe, and
//! domain state that disagrees with Stripe. It records and logs findings and
//! never changes anything; fixing one is an operator's replay.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use stripe::{EventId, SubscriptionId};
use uuid::Uuid;

use super::model::{EventType, SubscriptionFacts};
use super::ports::{AuditRepo, DomainAudit, StripeReader};
use super::translate;

#[cfg(test)]
mod test;

/// How often the audit runs.
pub const AUDIT_INTERVAL: chrono::Duration = chrono::Duration::hours(24);
/// How long one replica holds the run.
const AUDIT_LEASE: chrono::Duration = chrono::Duration::hours(2);
/// How far back the completeness check looks; a little over a day, so runs
/// overlap.
const EVENT_LOOKBACK: chrono::Duration = chrono::Duration::hours(26);
/// Events this young may still be in flight from Stripe.
const IN_FLIGHT: chrono::Duration = chrono::Duration::minutes(5);
/// Snapshots observed this recently may not match yet.
const SNAPSHOT_SETTLE: chrono::Duration = chrono::Duration::minutes(10);
/// Payloads are cleared after Stripe's own event retention.
const PAYLOAD_RETENTION: chrono::Duration = chrono::Duration::days(30);
/// Rows are kept long enough to dedupe every redelivery (Stripe retries for
/// three days).
const EVENT_RETENTION: chrono::Duration = chrono::Duration::days(90);

/// What kind of disagreement a finding is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::Display, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum MismatchKind {
    /// Stripe sent an event the inbox never stored.
    MissingEvent,
    /// The inbox stores events of a type no consumer applies.
    UnconsumedEventType,
    /// The held snapshot differs from Stripe's subscription.
    StaleSnapshot,
    /// A team's subscription id or payment state disagrees with Stripe.
    TeamBilling,
    /// A person's plan roles disagree with their subscription.
    PersonalPlan,
    /// Macro's side of a subscription could not be read, so it was not
    /// checked.
    Unchecked,
}

/// One finding.
#[derive(Debug, Clone, PartialEq)]
pub struct Mismatch {
    /// What disagrees.
    pub kind: MismatchKind,
    /// The Stripe object (or event type) it concerns.
    pub object_id: String,
    /// Stripe's side.
    pub stripe_value: Option<serde_json::Value>,
    /// Macro's side.
    pub macro_value: Option<serde_json::Value>,
}

/// Counts from one run.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AuditReport {
    /// Events listed from Stripe.
    pub events: usize,
    /// Subscriptions listed from Stripe.
    pub subscriptions: usize,
    /// Findings recorded.
    pub mismatches: usize,
}

/// Runs the audit on whichever replica claims it.
pub struct AuditService<Repo, Reader, Domains> {
    repo: Repo,
    reader: Arc<Reader>,
    domains: Arc<Domains>,
    replica: Uuid,
}

impl<Repo, Reader, Domains> AuditService<Repo, Reader, Domains>
where
    Repo: AuditRepo,
    Reader: StripeReader,
    Domains: DomainAudit,
{
    /// An audit reading Stripe through `reader` (paced for the audit).
    pub fn new(repo: Repo, reader: Arc<Reader>, domains: Arc<Domains>) -> Self {
        Self {
            repo,
            reader,
            domains,
            replica: Uuid::now_v7(),
        }
    }

    /// Runs the audit if it is due and no other replica is running it.
    #[tracing::instrument(name = "stripe_inbox.audit", skip(self), fields(run_id), err)]
    pub async fn run_if_due(&self) -> Result<Option<AuditReport>, rootcause::Report> {
        let Some(run_id) = self
            .repo
            .claim_run(self.replica, AUDIT_INTERVAL, AUDIT_LEASE)
            .await
            .map_err(storage)?
        else {
            return Ok(None);
        };
        tracing::Span::current().record("run_id", tracing::field::display(run_id));
        let now = Utc::now();
        self.repo
            .apply_retention(now - PAYLOAD_RETENTION, now - EVENT_RETENTION)
            .await
            .map_err(storage)?;

        let mut report = AuditReport::default();
        let mut mismatches = self.missing_events(now, &mut report).await?;
        mismatches.extend(self.unconsumed_types(now).await?);
        mismatches.extend(self.subscriptions(now, &mut report).await?);

        for mismatch in &mismatches {
            tracing::warn!(
                kind = mismatch.kind.as_ref(),
                object_id = %mismatch.object_id,
                "stripe audit mismatch"
            );
        }
        self.repo
            .record(run_id, &mismatches)
            .await
            .map_err(storage)?;
        self.repo.finish_run(self.replica).await.map_err(storage)?;
        report.mismatches = mismatches.len();
        tracing::info!(
            events = report.events,
            subscriptions = report.subscriptions,
            mismatches = report.mismatches,
            "stripe audit finished"
        );
        Ok(Some(report))
    }

    /// Logs `stripe inbox dead cursors` per consumer while any cursor is
    /// dead-lettered, so its alert holds until the cursor is replayed.
    pub async fn report_dead_cursors(&self) -> Result<(), rootcause::Report> {
        for (consumer, dead) in self.repo.dead_cursors().await.map_err(storage)? {
            tracing::error!(consumer = %consumer, dead, "stripe inbox dead cursors");
        }
        Ok(())
    }

    async fn missing_events(
        &self,
        now: DateTime<Utc>,
        report: &mut AuditReport,
    ) -> Result<Vec<Mismatch>, rootcause::Report> {
        let mut mismatches = Vec::new();
        let mut starting_after: Option<EventId> = None;
        loop {
            let page = self
                .reader
                .events(now - EVENT_LOOKBACK, starting_after.as_ref())
                .await
                .map_err(|error| rootcause::Report::new(error).into_dynamic())?;
            let listed = page
                .data
                .iter()
                .map(translate::listed_event)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| rootcause::Report::new(error).into_dynamic())?;
            report.events += listed.len();

            let ids: Vec<EventId> = listed.iter().map(|event| event.id.clone()).collect();
            let stored: HashSet<EventId> = self
                .repo
                .stored_event_ids(&ids)
                .await
                .map_err(storage)?
                .into_iter()
                .collect();
            // Stripe lists every event of the account; only the types a
            // consumer applies are sent to the webhook.
            mismatches.extend(
                listed
                    .iter()
                    .filter(|event| {
                        event
                            .type_name
                            .parse::<EventType>()
                            .is_ok_and(|event_type| !event_type.consumers().is_empty())
                            && !stored.contains(&event.id)
                            && event.created_at < now - IN_FLIGHT
                    })
                    .map(|event| Mismatch {
                        kind: MismatchKind::MissingEvent,
                        object_id: event.id.to_string(),
                        stripe_value: Some(serde_json::json!({
                            "type": event.type_name,
                            "created": event.created_at.timestamp(),
                        })),
                        macro_value: None,
                    }),
            );

            starting_after = ids.last().cloned();
            if !page.has_more || starting_after.is_none() {
                return Ok(mismatches);
            }
        }
    }

    async fn unconsumed_types(
        &self,
        now: DateTime<Utc>,
    ) -> Result<Vec<Mismatch>, rootcause::Report> {
        let types = self
            .repo
            .received_types(now - EVENT_LOOKBACK)
            .await
            .map_err(storage)?;
        Ok(types
            .into_iter()
            .filter(|type_name| type_name.parse::<EventType>().is_err())
            .map(|type_name| Mismatch {
                kind: MismatchKind::UnconsumedEventType,
                object_id: type_name,
                stripe_value: None,
                macro_value: None,
            })
            .collect())
    }

    async fn subscriptions(
        &self,
        now: DateTime<Utc>,
        report: &mut AuditReport,
    ) -> Result<Vec<Mismatch>, rootcause::Report> {
        let mut mismatches = Vec::new();
        let mut starting_after: Option<SubscriptionId> = None;
        loop {
            let page = self
                .reader
                .subscriptions(starting_after.as_ref())
                .await
                .map_err(|error| rootcause::Report::new(error).into_dynamic())?;
            let mut listed = Vec::with_capacity(page.data.len());
            for snapshot in &page.data {
                match translate::subscription_facts(snapshot) {
                    Ok(facts) => listed.push(facts),
                    Err(error) => {
                        tracing::warn!(error = %error, "stripe audit could not read a subscription");
                    }
                }
            }
            report.subscriptions += listed.len();

            let ids: Vec<SubscriptionId> = listed.iter().map(|facts| facts.id.clone()).collect();
            let held = self
                .repo
                .subscription_snapshots(&ids)
                .await
                .map_err(storage)?;
            for (snapshot, observed_at) in held {
                let Ok(held) = translate::subscription_facts(&snapshot) else {
                    continue;
                };
                let Some(stripe) = listed.iter().find(|facts| facts.id == held.id) else {
                    continue;
                };
                if observed_at < now - SNAPSHOT_SETTLE && snapshot_drifted(stripe, &held) {
                    mismatches.push(Mismatch {
                        kind: MismatchKind::StaleSnapshot,
                        object_id: stripe.id.to_string(),
                        stripe_value: Some(serde_json::json!({ "status": stripe.status.as_str() })),
                        macro_value: Some(serde_json::json!({ "status": held.status.as_str() })),
                    });
                }
            }
            for facts in &listed {
                let last_invoice_failed = self
                    .repo
                    .last_invoice_failed(&facts.customer)
                    .await
                    .map_err(storage)?;
                mismatches.extend(self.domains.check(facts, last_invoice_failed).await?);
            }

            // Page on the raw objects, so a page Macro cannot read is not
            // mistaken for the end of the list.
            if !page.has_more {
                return Ok(mismatches);
            }
            let last = page
                .data
                .last()
                .and_then(|object| object["id"].as_str())
                .ok_or_else(|| rootcause::report!("stripe subscription page has no last id"))?;
            starting_after =
                Some(last.parse().map_err(|_| {
                    rootcause::report!("stripe subscription page has an invalid id")
                })?);
        }
    }
}

/// Whether the held snapshot disagrees with Stripe on what consumers act
/// on: the status, or an item's price or quantity. Items both sides show
/// are compared; the item sets only when both lists are complete.
pub fn snapshot_drifted(stripe: &SubscriptionFacts, held: &SubscriptionFacts) -> bool {
    let items = |facts: &SubscriptionFacts| -> HashMap<String, (String, Option<u64>)> {
        facts
            .items
            .iter()
            .map(|item| (item.id.to_string(), (item.price.to_string(), item.quantity)))
            .collect()
    };
    let (stripe_items, held_items) = (items(stripe), items(held));
    let known_differ = stripe_items
        .iter()
        .any(|(id, item)| held_items.get(id).is_some_and(|held| held != item));
    let both_complete = stripe.items_complete && held.items_complete;
    stripe.status != held.status
        || known_differ
        || (both_complete
            && stripe_items.keys().collect::<HashSet<_>>()
                != held_items.keys().collect::<HashSet<_>>())
}

fn storage(error: impl std::error::Error + Send + Sync + 'static) -> rootcause::Report {
    rootcause::Report::new(error).into_dynamic()
}
