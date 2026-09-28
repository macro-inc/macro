//! Billing-only Stripe translation. The dispatcher and base subscription handlers
//! stay in the parent module; activation policy lives in ai_billing's domain.

use ai_billing::BillingService;
use ai_billing::domain::BillingPeriod;
use ai_billing::domain::period::{PeriodEvidence, SubscriptionActivity, SubscriptionPeriod};
use ai_billing::outbound::stripe_gateway::{
    PAYER_METADATA_KEY, PURPOSE_AI_CREDITS, PURPOSE_METADATA_KEY,
};
use anyhow::Context;
use chrono::{DateTime, Utc};
use macro_user_id::{email::Email, lowercased::Lowercase, user_id::MacroUserIdStr};
use serde_json::Value;
use stripe_webhook::EventObject;

use crate::api::context::ApiContext;

#[cfg(test)]
mod test;

/// Retain occurrence time and raw versioned period fields only after signature
/// verification. Delivery time cannot establish rollout eligibility.
pub(super) struct BillingEvent {
    pub id: String,
    pub at: DateTime<Utc>,
    pub object: Value,
}

impl BillingEvent {
    pub fn from_verified_payload(payload: &str) -> anyhow::Result<Self> {
        let event: Value = serde_json::from_str(payload)?;
        Ok(Self {
            id: event["id"]
                .as_str()
                .context("missing verified event id")?
                .to_owned(),
            at: timestamp(&event["created"]).context("invalid verified event time")?,
            object: event["data"]["object"].clone(),
        })
    }
}

fn timestamp(value: &Value) -> Option<DateTime<Utc>> {
    DateTime::from_timestamp(value.as_i64()?, 0)
}

pub(super) fn period_from_timestamps(
    start: i64,
    end: i64,
) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
    if start >= end {
        return None;
    }
    DateTime::from_timestamp(start, 0).zip(DateTime::from_timestamp(end, 0))
}

fn object_id(value: &Value) -> Option<&str> {
    value.as_str().or_else(|| value["id"].as_str())
}

fn period(subscription: &Value, item: &Value) -> Option<BillingPeriod> {
    // If an item supplies either boundary, require both. Never mix versions or
    // synthesize a monthly end for an incomplete/custom interval.
    let source =
        if item.get("current_period_start").is_some() || item.get("current_period_end").is_some() {
            item
        } else {
            subscription
        };
    let (start, end) = period_from_timestamps(
        source["current_period_start"].as_i64()?,
        source["current_period_end"].as_i64()?,
    )?;
    Some(BillingPeriod { start, end })
}

fn invoice_evidence(
    invoice: &Value,
    subscription: &Value,
    item: &Value,
    period: BillingPeriod,
) -> PeriodEvidence {
    let subscription_id = object_id(&subscription["id"]);
    let invoice_subscription = object_id(&invoice["subscription"])
        .or_else(|| object_id(&invoice["parent"]["subscription_details"]["subscription"]));
    if subscription_id.is_none()
        || invoice_subscription != subscription_id
        || object_id(&invoice["customer"]) != object_id(&subscription["customer"])
        || invoice["status"].as_str() != Some("paid")
        || invoice["lines"]["has_more"].as_bool() != Some(false)
    {
        return PeriodEvidence::Snapshot;
    }
    let evidence = match invoice["billing_reason"].as_str() {
        Some("subscription_create") => PeriodEvidence::Initial,
        Some("subscription_cycle") => PeriodEvidence::Renewal,
        _ => return PeriodEvidence::Snapshot,
    };
    let Some(lines) = invoice["lines"]["data"].as_array() else {
        return PeriodEvidence::Snapshot;
    };
    let matches = lines
        .iter()
        .filter(|line| {
            let details = &line["parent"]["subscription_item_details"];
            let item_id = object_id(&line["subscription_item"])
                .or_else(|| object_id(&details["subscription_item"]));
            let price_id = object_id(&line["price"])
                .or_else(|| object_id(&line["pricing"]["price_details"]["price"]));
            item_id == object_id(&item["id"])
                && price_id == object_id(&item["price"])
                && line["proration"]
                    .as_bool()
                    .or_else(|| details["proration"].as_bool())
                    == Some(false)
                && timestamp(&line["period"]["start"]) == Some(period.start)
                && timestamp(&line["period"]["end"]) == Some(period.end)
        })
        .count();
    if matches == 1 {
        evidence
    } else {
        PeriodEvidence::Snapshot
    }
}

/// Translate complete verified subscription/item/price facts. Unknown fields or
/// missing boundaries remain activation exceptions, never calendar fallbacks.
pub(super) fn subscription_periods(
    event: &BillingEvent,
    subscription: &Value,
    invoice: Option<&Value>,
) -> Vec<SubscriptionPeriod> {
    if subscription["items"]["has_more"].as_bool() != Some(false) {
        return vec![];
    }
    let Some(items) = subscription["items"]["data"].as_array() else {
        return vec![];
    };
    items
        .iter()
        .filter_map(|item| {
            let Some(period) = period(subscription, item) else {
            tracing::warn!(subscription_id = ?object_id(&subscription["id"]), item_id = ?object_id(&item["id"]), "usage policy activation exception: missing or invalid period anchors");
            return None;
        };
            let price = &item["price"];
            let team_id = match subscription["metadata"].get("team_id") {
                Some(value) => Some(value.as_str()?.parse().ok()?),
                None => None,
            };
            Some(SubscriptionPeriod {
                event_id: event.id.parse().ok()?,
                event_at: event.at,
                subscription_id: object_id(&subscription["id"])?.parse().ok()?,
                subscription_created_at: timestamp(&subscription["created"])?,
                customer_id: object_id(&subscription["customer"])?.parse().ok()?,
                team_id,
                quantity: item["quantity"].as_u64()?,
                item_count: items.len(),
                item_id: object_id(&item["id"])?.parse().ok()?,
                price_id: object_id(price)?.parse().ok()?,
                product_id: object_id(&price["product"])?.parse().ok()?,
                unit_amount: price["unit_amount"].as_i64(),
                currency: price["currency"].as_str()?.to_owned(),
                monthly: price["type"].as_str() == Some("recurring")
                    && price["recurring"]["interval"].as_str() == Some("month")
                    && price["recurring"]["interval_count"].as_u64() == Some(1),
                activity: match subscription["status"].as_str() {
                Some("active") => SubscriptionActivity::Active,
                Some("trialing") => SubscriptionActivity::Trialing,
                _ => SubscriptionActivity::Inactive,
            },
                period,
                evidence: invoice
                    .map(|invoice| invoice_evidence(invoice, subscription, item, period))
                    .unwrap_or(PeriodEvidence::Snapshot),
            })
        })
        .collect()
}

pub(super) async fn sync_personal_billing_period(
    ctx: &ApiContext,
    email: &Email<Lowercase<'_>>,
    period: Option<(DateTime<Utc>, DateTime<Utc>)>,
    verified: Vec<SubscriptionPeriod>,
) -> anyhow::Result<()> {
    let Ok(user_id) = MacroUserIdStr::try_from_email(email.as_ref()) else {
        tracing::warn!("could not derive a candidate for billing period sync");
        return Ok(());
    };
    sync_periods(ctx, &user_id, period, verified).await
}

#[derive(Debug, Clone)]
pub(super) struct TeamPlanSync {
    pub owner: Option<MacroUserIdStr<'static>>,
    pub period: Option<(DateTime<Utc>, DateTime<Utc>)>,
    pub verified: Vec<SubscriptionPeriod>,
}

pub(super) async fn sync_team_billing_period(
    ctx: &ApiContext,
    sync: &TeamPlanSync,
) -> anyhow::Result<()> {
    let Some(owner) = sync.owner.as_ref() else {
        tracing::warn!("team subscription without owner candidate; skipping period sync");
        return Ok(());
    };
    sync_periods(ctx, owner, sync.period, Vec::new()).await
}

/// Check the owning team's existing subscription binding before the base handler
/// patches it. Otherwise that write would make the identity check tautological.
pub(super) async fn sync_team_usage_policy(
    ctx: &ApiContext,
    sync: &TeamPlanSync,
) -> anyhow::Result<()> {
    let Some(owner) = sync.owner.as_ref() else {
        return Ok(());
    };
    sync_periods(ctx, owner, None, sync.verified.clone()).await
}

/// Preserve the pre-update identity check without letting its failure skip base
/// subscription work. Still fail the webhook afterwards so Stripe retries policy
/// persistence; acknowledging the event here would lose that retry.
pub(super) async fn complete_subscription_webhook(
    policy: impl Future<Output = anyhow::Result<()>>,
    subscription: impl Future<Output = anyhow::Result<()>>,
) -> anyhow::Result<()> {
    let policy_result = policy.await.inspect_err(|error| {
        tracing::warn!(error = ?error, "usage policy sync failed; completing base subscription work before retry");
    });
    subscription.await?;
    policy_result
}

async fn sync_periods(
    ctx: &ApiContext,
    payer: &MacroUserIdStr<'_>,
    period: Option<(DateTime<Utc>, DateTime<Utc>)>,
    verified: Vec<SubscriptionPeriod>,
) -> anyhow::Result<()> {
    if let Some((start, end)) = period {
        ctx.ai_billing_service
            .sync_period(payer, start, end, None)
            .await
            .context("failed to sync legacy billing anchor")?;
    }
    for facts in verified {
        ctx.ai_billing_service
            .sync_period(payer, facts.period.start, facts.period.end, Some(facts))
            .await
            .context("failed to sync verified usage policy period")?;
    }
    Ok(())
}

/// Credit checkout behavior is unchanged; T10 extends this single handler.
#[tracing::instrument(skip(ctx, event_object), err, ret)]
pub(super) async fn handle_checkout_session_completed(
    ctx: &ApiContext,
    event_object: EventObject,
) -> anyhow::Result<()> {
    let session = match event_object {
        EventObject::CheckoutSessionCompleted(session)
        | EventObject::CheckoutSessionAsyncPaymentSucceeded(session) => session,
        _ => anyhow::bail!("expected checkout session"),
    };
    let metadata = session.metadata.clone().unwrap_or_default();
    if metadata.get(PURPOSE_METADATA_KEY).map(String::as_str) != Some(PURPOSE_AI_CREDITS) {
        tracing::info!(session_id = %session.id, "checkout session is not a credit purchase");
        return Ok(());
    }
    if session.payment_status.as_str() != "paid" {
        tracing::info!(session_id = %session.id, payment_status = ?session.payment_status, "credit purchase not paid yet; waiting for checkout.session.async_payment_succeeded");
        return Ok(());
    }
    let payer = metadata
        .get(PAYER_METADATA_KEY)
        .cloned()
        .context("credit checkout session is missing the payer")?;
    let payer = MacroUserIdStr::try_from(payer).context("invalid payer id on checkout session")?;
    let amount_cents = session
        .amount_total
        .or_else(|| metadata.get("amount_cents").and_then(|a| a.parse().ok()))
        .context("credit checkout session has no amount")?;
    ctx.ai_billing_service
        .apply_credit_purchase(&payer, amount_cents, session.id.as_str())
        .await
        .context("failed to book credit purchase")?;
    tracing::info!(payer = %payer, amount_cents, "booked ai credit purchase");
    Ok(())
}
