//! What each Stripe inbox consumer decides from an event's typed facts.
//! Pure: `crate::outbound::stripe_consumers` carries the decisions out.

use ai_billing::PlanTier;
use ai_billing::domain::BillingPeriod;
use ai_billing::domain::period::{PeriodEvidence, SubscriptionActivity, SubscriptionPeriod};
use ai_billing::domain::plan_change::PlanChange;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use roles_and_permissions::domain::model::{ProductTier, SubscriptionStatus as RoleStatus};
use stripe::{EventId, SubscriptionStatus};
use stripe_inbox::domain::model::{
    InvoiceFacts, ItemFacts, PeriodProof, SubscriptionChange, SubscriptionFacts,
};
use teams::domain::model::{SeatPlan, SeatPrices};
use teams::domain::open_seat_release::SubscriptionStart;

#[cfg(test)]
mod test;

/// A subscription granting access on a price that neither a sold seat price
/// nor the legacy list matches: no tier is inferred from it, the event
/// dead-letters and pages. Revokes never need a price, so they never fail.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("subscription {subscription_id} has no known seat price")]
pub struct UnknownPrice {
    /// The subscription.
    pub subscription_id: String,
}

/// The plan whose entitlements a personal subscription's price grants.
fn seat_plan(
    subscription: &SubscriptionFacts,
    prices: &SeatPrices,
) -> Result<SeatPlan, UnknownPrice> {
    subscription
        .items
        .iter()
        .find_map(|item| prices.entitlement_plan(item.price.as_str()))
        .ok_or_else(|| UnknownPrice {
            subscription_id: subscription.id.to_string(),
        })
}

/// The roles status a subscription status grants; `None` for `incomplete`,
/// which grants and revokes nothing.
fn role_status(status: SubscriptionStatus) -> Option<RoleStatus> {
    match status {
        SubscriptionStatus::Active | SubscriptionStatus::Trialing => Some(RoleStatus::Active),
        SubscriptionStatus::Canceled => Some(RoleStatus::Canceled),
        SubscriptionStatus::IncompleteExpired => Some(RoleStatus::IncompleteExpired),
        SubscriptionStatus::PastDue => Some(RoleStatus::PastDue),
        SubscriptionStatus::Paused => Some(RoleStatus::Paused),
        SubscriptionStatus::Unpaid => Some(RoleStatus::Unpaid),
        SubscriptionStatus::Incomplete => None,
    }
}

/// The legacy payer anchor: the first item's period (the subscription's on
/// older API versions).
pub fn legacy_period(subscription: &SubscriptionFacts) -> Option<BillingPeriod> {
    let period = subscription.items.first()?.period?;
    Some(BillingPeriod {
        start: period.start,
        end: period.end,
    })
}

fn period_evidence(proof: PeriodProof) -> PeriodEvidence {
    match proof {
        PeriodProof::Snapshot => PeriodEvidence::Snapshot,
        PeriodProof::Initial => PeriodEvidence::Initial,
        PeriodProof::Renewal => PeriodEvidence::Renewal,
    }
}

/// Verified per-item period facts for the usage policy. Only a complete
/// item list qualifies; an item without both period boundaries, quantity,
/// product or currency is an activation exception, never a calendar guess.
pub fn subscription_periods(
    event_id: &EventId,
    event_at: DateTime<Utc>,
    subscription: &SubscriptionFacts,
    invoice: Option<&InvoiceFacts>,
) -> Vec<SubscriptionPeriod> {
    if !subscription.items_complete {
        return Vec::new();
    }
    let item_count = subscription.items.len();
    subscription
        .items
        .iter()
        .filter_map(|item| {
            let Some(period) = item.period else {
                tracing::warn!(
                    subscription_id = %subscription.id,
                    item_id = %item.id,
                    "usage policy activation exception: missing or invalid period anchors"
                );
                return None;
            };
            period_facts(
                event_id,
                event_at,
                subscription,
                item,
                item_count,
                invoice,
                period,
            )
        })
        .collect()
}

fn period_facts(
    event_id: &EventId,
    event_at: DateTime<Utc>,
    subscription: &SubscriptionFacts,
    item: &ItemFacts,
    item_count: usize,
    invoice: Option<&InvoiceFacts>,
    period: stripe_inbox::domain::model::Period,
) -> Option<SubscriptionPeriod> {
    let evidence = invoice
        .map(|invoice| period_evidence(invoice.period_proof(subscription, item)))
        .unwrap_or(PeriodEvidence::Snapshot);
    Some(SubscriptionPeriod {
        event_id: event_id.as_str().parse().ok()?,
        event_at,
        subscription_id: subscription.id.as_str().parse().ok()?,
        subscription_created_at: subscription.created,
        customer_id: subscription.customer.as_str().parse().ok()?,
        team_id: subscription.team_id,
        quantity: item.quantity?,
        item_count,
        item_id: item.id.as_str().parse().ok()?,
        price_id: item.price.as_str().parse().ok()?,
        product_id: item.product.as_ref()?.as_str().parse().ok()?,
        unit_amount: item.unit_amount,
        currency: item.currency.clone()?,
        monthly: item.monthly,
        activity: match subscription.status {
            SubscriptionStatus::Active => SubscriptionActivity::Active,
            SubscriptionStatus::Trialing => SubscriptionActivity::Trialing,
            SubscriptionStatus::Canceled
            | SubscriptionStatus::Incomplete
            | SubscriptionStatus::IncompleteExpired
            | SubscriptionStatus::PastDue
            | SubscriptionStatus::Paused
            | SubscriptionStatus::Unpaid => SubscriptionActivity::Inactive,
        },
        period: BillingPeriod {
            start: period.start,
            end: period.end,
        },
        evidence,
    })
}

/// An AI plan change on a personal subscription: Free to paid when it
/// starts, or an item's price moving between plans. Matching item ids keeps
/// an unrelated item edit from reading as a seat change.
pub fn personal_plan_change(
    change: &SubscriptionChange,
    event_at: DateTime<Utc>,
    prices: &SeatPrices,
) -> Option<PlanChange> {
    let subscription = &change.subscription;
    if subscription.team_id.is_some() || !subscription.is_live() {
        return None;
    }
    let initial = change.is_new();
    let previous_items = change.previous.items.as_deref();
    subscription.items.iter().find_map(|item| {
        let previous_item =
            previous_items.and_then(|items| items.iter().find(|previous| previous.id == item.id));
        let from = if initial {
            PlanTier::Free
        } else {
            let price = previous_item?.price.as_ref()?;
            prices.plan_for_price(price.as_str())?.into()
        };
        let to: PlanTier = prices.plan_for_price(item.price.as_str())?.into();
        let period = item.period?;
        let previous_period_start = previous_item
            .and_then(|previous| previous.period_start)
            .or(change.previous.period_start);
        let renewed = previous_period_start.is_some_and(|start| start < period.start);

        // A downgrade at renewal belongs to the new period. An immediate
        // change carries Macro's own stamp only when this update set it;
        // a later portal edit must not reuse an old stamp.
        let at = if renewed && !PlanChange::is_upgrade(from, to) {
            period.start
        } else if change.previous.plan_change_stamped {
            subscription.plan_change_at.unwrap_or(event_at)
        } else {
            event_at
        };
        Some(PlanChange {
            from,
            to,
            at,
            period: BillingPeriod {
                start: period.start,
                end: period.end,
            },
        })
    })
}

/// What a personal subscription event does to its subscriber.
#[derive(Debug, Clone, PartialEq)]
pub enum PersonalDecision {
    /// Nothing: a team subscription, or one still `incomplete`.
    Ignore,
    /// The customer already has an older live subscription: cancel this one
    /// and change nothing else.
    CancelDuplicate,
    /// Revoking, but another live subscription still grants access.
    KeepAccess,
    /// Set the subscriber's roles and billing state.
    Apply(PersonalUpdate),
}

/// What a personal update does to the subscriber's roles.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PersonalAccess {
    /// Grant the subscriber role and the tier the seat price grants.
    Grant(ProductTier),
    /// Remove the subscriber role and every tier's role: no price is read,
    /// so an unknown price never blocks a revoke.
    Revoke(RoleStatus),
}

/// The subscriber's new roles and billing state.
#[derive(Debug, Clone, PartialEq)]
pub struct PersonalUpdate {
    /// Grant or revoke.
    pub access: PersonalAccess,
    /// The subscription entered its trial with this event.
    pub started_trial: bool,
    /// The legacy payer anchor.
    pub period: Option<BillingPeriod>,
    /// Verified per-item periods.
    pub verified: Vec<SubscriptionPeriod>,
    /// An AI plan change to record.
    pub plan_change: Option<PlanChange>,
}

/// Decides a personal subscription snapshot. `customer_subscriptions` holds
/// every subscription of the customer (team ones included: an older live
/// one of any kind makes a new personal one a duplicate).
pub fn decide_personal_subscription(
    event_id: &EventId,
    event_at: DateTime<Utc>,
    change: &SubscriptionChange,
    customer_subscriptions: &[SubscriptionFacts],
    prices: &SeatPrices,
) -> Result<PersonalDecision, UnknownPrice> {
    let subscription = &change.subscription;
    if subscription.team_id.is_some() {
        return Ok(PersonalDecision::Ignore);
    }
    let Some(status) = role_status(subscription.status) else {
        return Ok(PersonalDecision::Ignore);
    };

    let live: Vec<&SubscriptionFacts> = customer_subscriptions
        .iter()
        .filter(|other| other.is_live())
        .collect();
    if subscription.is_live() && live.len() > 1 {
        let oldest = live
            .iter()
            .min_by_key(|other| (other.created, other.id.as_str()))
            .map(|other| &other.id);
        if oldest != Some(&subscription.id) {
            return Ok(PersonalDecision::CancelDuplicate);
        }
    }
    if subscription.status == SubscriptionStatus::Canceled && !live.is_empty() {
        return Ok(PersonalDecision::KeepAccess);
    }

    let access = match status {
        RoleStatus::Active => {
            PersonalAccess::Grant(seat_plan(subscription, prices)?.product_tier())
        }
        revoked => PersonalAccess::Revoke(revoked),
    };
    Ok(PersonalDecision::Apply(PersonalUpdate {
        access,
        started_trial: change.started_trial(),
        period: legacy_period(subscription),
        verified: subscription_periods(event_id, event_at, subscription, None),
        plan_change: personal_plan_change(change, event_at, prices),
    }))
}

/// Decides a personal subscription's invoice outcome. A failed payment
/// revokes at once (Stripe may still be retrying) unless another live
/// personal subscription grants access.
pub fn decide_personal_invoice(
    event_id: &EventId,
    event_at: DateTime<Utc>,
    invoice: &InvoiceFacts,
    subscription: &SubscriptionFacts,
    customer_subscriptions: &[SubscriptionFacts],
    prices: &SeatPrices,
) -> Result<PersonalDecision, UnknownPrice> {
    if subscription.team_id.is_some() || (invoice.paid && is_terminal(subscription.status)) {
        // A payment that arrives after the subscription ended grants
        // nothing back.
        return Ok(PersonalDecision::Ignore);
    }
    if !invoice.paid {
        let other_live_personal = customer_subscriptions
            .iter()
            .any(|other| other.team_id.is_none() && other.id != subscription.id && other.is_live());
        if other_live_personal {
            return Ok(PersonalDecision::KeepAccess);
        }
    }
    let access = if invoice.paid {
        PersonalAccess::Grant(seat_plan(subscription, prices)?.product_tier())
    } else {
        PersonalAccess::Revoke(RoleStatus::PastDue)
    };
    Ok(PersonalDecision::Apply(PersonalUpdate {
        access,
        started_trial: false,
        period: legacy_period(subscription),
        verified: subscription_periods(event_id, event_at, subscription, Some(invoice)),
        plan_change: None,
    }))
}

/// What a team subscription event does to its team.
#[derive(Debug, Clone, PartialEq)]
pub struct TeamUpdate {
    /// The team.
    pub team_id: uuid::Uuid,
    /// The team's subscription.
    pub subscription_id: stripe::SubscriptionId,
    /// The owner, whose billing anchor and usage policy follow the team.
    pub owner: Option<MacroUserIdStr<'static>>,
    /// Whether the team pays and its members keep their seats.
    pub paying: bool,
    /// Set when the subscription started with this event.
    pub start: Option<SubscriptionStart>,
    /// The subscription entered its trial with this event.
    pub started_trial: bool,
    /// The legacy payer anchor.
    pub period: Option<BillingPeriod>,
    /// Verified per-item periods.
    pub verified: Vec<SubscriptionPeriod>,
}

/// Decides a team subscription snapshot; `None` when it is personal or
/// still `incomplete`.
pub fn decide_team_subscription(
    event_id: &EventId,
    event_at: DateTime<Utc>,
    change: &SubscriptionChange,
) -> Option<TeamUpdate> {
    let subscription = &change.subscription;
    let team_id = subscription.team_id?;
    role_status(subscription.status)?;
    let paying = subscription.is_live();
    let verified = subscription_periods(event_id, event_at, subscription, None);
    let start = (paying && change.is_new())
        .then(|| {
            verified.first().map(|facts| SubscriptionStart {
                at: facts.event_at,
                period_start: facts.period.start,
                period_end: facts.period.end,
            })
        })
        .flatten();
    Some(TeamUpdate {
        team_id,
        subscription_id: subscription.id.clone(),
        owner: subscription.owner_id.clone(),
        paying,
        start,
        started_trial: change.started_trial(),
        period: legacy_period(subscription),
        verified,
    })
}

/// What Macro holds for a team subscription event's team.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TeamState {
    /// The team was deleted.
    Missing,
    /// The team exists, bound to this subscription, if any.
    Bound(Option<stripe::SubscriptionId>),
}

/// How a team subscription event applies to its team.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TeamBinding {
    /// The team was deleted: nothing to apply, and no retry.
    TeamGone,
    /// The team moved to another subscription; this one's lapse cannot
    /// revoke seats the new one pays for.
    IgnoreLapse,
    /// Apply; `replaced` when the event's subscription becomes the team's.
    Apply {
        /// The team was bound to no or another subscription.
        replaced: bool,
    },
}

/// Decides how a team update applies given the team's current binding.
pub fn decide_team_binding(update: &TeamUpdate, team: TeamState) -> TeamBinding {
    let bound = match team {
        TeamState::Missing => return TeamBinding::TeamGone,
        TeamState::Bound(bound) => bound,
    };
    let replaced = bound.as_ref() != Some(&update.subscription_id);
    if replaced && bound.is_some() && !update.paying {
        return TeamBinding::IgnoreLapse;
    }
    TeamBinding::Apply { replaced }
}

/// Whether the subscription ended for good.
fn is_terminal(status: SubscriptionStatus) -> bool {
    matches!(
        status,
        SubscriptionStatus::Canceled | SubscriptionStatus::IncompleteExpired
    )
}

/// Decides a team subscription's invoice outcome; `None` when personal or
/// paid after the subscription ended.
pub fn decide_team_invoice(
    event_id: &EventId,
    event_at: DateTime<Utc>,
    invoice: &InvoiceFacts,
    subscription: &SubscriptionFacts,
) -> Option<TeamUpdate> {
    let team_id = subscription.team_id?;
    if invoice.paid && is_terminal(subscription.status) {
        return None;
    }
    Some(TeamUpdate {
        team_id,
        subscription_id: subscription.id.clone(),
        owner: subscription.owner_id.clone(),
        paying: invoice.paid,
        start: None,
        started_trial: false,
        period: legacy_period(subscription),
        verified: subscription_periods(event_id, event_at, subscription, Some(invoice)),
    })
}

/// A subscription conversion to report to GA, Meta and PostHog.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Conversion {
    /// A new subscription went live.
    Purchase,
    /// A subscription was canceled.
    Cancel,
}

/// The conversion the analytics consumer reports for a subscription event.
/// A personal subscription granting on an unknown price reports nothing:
/// analytics never dead-letters, the personal plan consumer pages for it.
pub fn analytics_conversion(
    event_id: &EventId,
    event_at: DateTime<Utc>,
    change: &SubscriptionChange,
    customer_subscriptions: &[SubscriptionFacts],
    prices: &SeatPrices,
) -> Option<Conversion> {
    if change.subscription.team_id.is_some() {
        return conversion(change, None);
    }
    match decide_personal_subscription(event_id, event_at, change, customer_subscriptions, prices) {
        Ok(personal) => conversion(change, Some(&personal)),
        Err(error) => {
            tracing::info!(error = %error, "skipping analytics tracking: unknown price");
            None
        }
    }
}

/// Which conversion, if any, a subscription event reports. A personal
/// subscription reports only when the personal plan consumer applies it
/// (never for a canceled duplicate or a cancel that keeps access).
pub fn conversion(
    change: &SubscriptionChange,
    personal: Option<&PersonalDecision>,
) -> Option<Conversion> {
    if let Some(decision) = personal
        && !matches!(decision, PersonalDecision::Apply(_))
    {
        return None;
    }
    let subscription = &change.subscription;
    if subscription.status == SubscriptionStatus::Incomplete {
        return None;
    }
    if subscription.is_live() && change.is_new() {
        return Some(Conversion::Purchase);
    }
    (subscription.status == SubscriptionStatus::Canceled).then_some(Conversion::Cancel)
}
