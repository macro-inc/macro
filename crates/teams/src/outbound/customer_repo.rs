//! Implementation for CustomerRepository using Stripe.

use std::{collections::HashMap, sync::Arc};

#[cfg(test)]
mod test;

mod billing;
mod item_changes;
mod subscription_items;
use subscription_items::{cadence, item_quantity_updates, update_error};
mod subscription_error;
use subscription_error::SubscriptionDataError;

use anyhow::Context;
use macro_user_id::user_id::MacroUserIdStr;
use stripe::{UpdateSubscription, UpdateSubscriptionItems};

use crate::domain::{
    customer_repo::CustomerRepository,
    model::{
        BillingCadence, BillingInterval, CustomerError, ItemQuantityChange, PriceInfo,
        ScheduledSeatPlan, SeatPlan, SeatPrices, SeatQuote, SubscriptionTerms,
    },
};

/// The CustomerRepositoryImpl struct is a wrapper around a stripe::Client connected to stripe.
#[derive(Clone)]
pub struct CustomerRepositoryImpl {
    /// The underlying stripe::Client connected to stripe.
    client: Arc<stripe::Client>,
    /// The Stripe price behind each plan's seat item. A team subscription
    /// holds one item per plan its members are on.
    seat_prices: SeatPrices,
    pool: sqlx::PgPool,
    team_locks: sqlx::PgPool,
    subscription_locks: sqlx::PgPool,
}

/// How an item update is sent beyond the items themselves.
#[derive(Default)]
struct ItemUpdateOptions<'a> {
    /// Journals the request and marks the provider object with this key,
    /// also sent as Stripe's idempotency key, so a retry applies once.
    idempotency_key: Option<&'a str>,
    /// Fail the update when its invoice cannot be paid, instead of leaving
    /// the subscription past due.
    error_if_incomplete: bool,
}

/// One plan's seat item on a subscription.
#[derive(Debug, Clone)]
struct SeatItem {
    id: String,
    quantity: u64,
}

impl CustomerRepository for CustomerRepositoryImpl {
    type TeamBillingGuard = sqlx::Transaction<'static, sqlx::Postgres>;

    async fn lock_team_billing(
        &self,
        team_id: &uuid::Uuid,
    ) -> Result<Self::TeamBillingGuard, CustomerError> {
        Self::billing_guard(&self.team_locks, &format!("team-billing:{team_id}")).await
    }

    async fn scheduled_seat_plan(
        &self,
        subscription: &stripe::SubscriptionId,
        schedule: &stripe::SubscriptionScheduleId,
        user: &MacroUserIdStr<'_>,
    ) -> Result<Option<ScheduledSeatPlan>, CustomerError> {
        Ok(self
            .read_scheduled_seat_plans(subscription, schedule)
            .await?
            .remove(user.as_ref()))
    }

    async fn pending_seat_plan(
        &self,
        id: &stripe::SubscriptionId,
        user: &MacroUserIdStr<'_>,
    ) -> Result<Option<ScheduledSeatPlan>, CustomerError> {
        Ok(self.pending_seat_plans(id).await?.remove(user.as_ref()))
    }

    async fn pending_seat_plans(
        &self,
        id: &stripe::SubscriptionId,
    ) -> Result<HashMap<String, ScheduledSeatPlan>, CustomerError> {
        let subscription = stripe::Subscription::retrieve(&self.client, id, &[])
            .await
            .map_err(storage)?;
        let Some(schedule) = subscription.schedule.as_ref() else {
            return Ok(HashMap::new());
        };
        let mut changes = self.read_scheduled_seat_plans(id, &schedule.id()).await?;
        changes.retain(|_, change| {
            change.effective_at.timestamp() > subscription.current_period_start
        });
        Ok(changes)
    }

    fn seat_price_id(
        &self,
        plan: SeatPlan,
    ) -> Result<stripe_price_id::StripePriceId, CustomerError> {
        self.seat_prices.price_id(plan).cloned()
    }

    #[tracing::instrument(skip(self), err)]
    async fn seat_quote(&self, plan: SeatPlan) -> Result<SeatQuote, CustomerError> {
        let price_id = self.seat_price_id(plan)?;
        let parsed_price_id: stripe::PriceId = price_id
            .as_str()
            .parse()
            .context("configured seat price id is malformed")?;
        let price = stripe::Price::retrieve(&self.client, &parsed_price_id, &[])
            .await
            .map_err(storage)?;
        let amount = price
            .unit_amount
            .context("the seat price has no unit amount")?;
        let recurring = price.recurring.context("the seat price is not recurring")?;
        if recurring.interval_count != 1 {
            return Err(anyhow::anyhow!(
                "the seat price bills every {} intervals",
                recurring.interval_count
            )
            .into());
        }
        let interval = match recurring.interval {
            stripe::RecurringInterval::Month => BillingInterval::Month,
            stripe::RecurringInterval::Year => BillingInterval::Year,
            other => {
                return Err(anyhow::anyhow!("the seat price bills per {}", other.as_str()).into());
            }
        };

        let currency = price
            .currency
            .context("the seat price has no currency")?
            .to_string();

        Ok(SeatQuote {
            price_id,
            amount,
            currency,
            interval,
        })
    }

    #[tracing::instrument(skip(self), err)]
    async fn increment_seat_count(
        &self,
        subscription_id: &stripe::SubscriptionId,
        plan: SeatPlan,
        amount: u64,
    ) -> Result<(), CustomerError> {
        let _billing = self.subscription_guard(subscription_id, None).await?;
        let items = self.get_seat_items(subscription_id).await?;
        let existing = items.get(&plan);
        let quantity = existing
            .map_or(0, |item| item.quantity)
            .checked_add(amount)
            .context("seat count overflow")?;
        let update = self.seat_item_update(plan, existing, quantity)?;

        self.update_items(subscription_id, vec![update], ItemUpdateOptions::default())
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn decrement_seat_count(
        &self,
        subscription_id: &stripe::SubscriptionId,
        plan: SeatPlan,
        amount: u64,
    ) -> Result<(), CustomerError> {
        let _billing = self.subscription_guard(subscription_id, None).await?;
        let items = self.get_seat_items(subscription_id).await?;
        let Some(existing) = items.get(&plan) else {
            return Err(CustomerError::NoMatchingLineItem);
        };
        let total: u64 = items.values().map(|item| item.quantity).sum();
        // Never leave the subscription without a seat: the payer keeps one.
        let removable = existing.quantity.min(total.saturating_sub(1));
        let quantity = existing.quantity - amount.min(removable);
        if quantity == existing.quantity {
            return Ok(());
        }
        let update = self.seat_item_update(plan, Some(existing), quantity)?;

        self.update_items(subscription_id, vec![update], ItemUpdateOptions::default())
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn move_seat(
        &self,
        subscription_id: &stripe::SubscriptionId,
        from: SeatPlan,
        to: SeatPlan,
    ) -> Result<(), CustomerError> {
        if from == to {
            return Ok(());
        }
        let _billing = self.subscription_guard(subscription_id, None).await?;
        // Make sure the target plan is sold before touching anything.
        self.seat_prices.price_id(to)?;

        let items = self.get_seat_items(subscription_id).await?;
        let Some(source) = items.get(&from) else {
            return Err(CustomerError::NoMatchingLineItem);
        };
        let target = items.get(&to);

        let updates = vec![
            self.seat_item_update(from, Some(source), source.quantity.saturating_sub(1))?,
            self.seat_item_update(to, target, target.map_or(0, |item| item.quantity) + 1)?,
        ];

        self.update_items(subscription_id, updates, ItemUpdateOptions::default())
            .await
    }

    async fn schedule_seat_plan(
        &self,
        id: &stripe::SubscriptionId,
        user: &MacroUserIdStr<'_>,
        plan: Option<SeatPlan>,
    ) -> Result<(), CustomerError> {
        let _billing = self.subscription_guard(id, None).await?;
        let subscription = stripe::Subscription::retrieve(&self.client, id, &[])
            .await
            .map_err(storage)?;
        let existing = if let Some(id) = subscription.schedule.as_ref().map(|s| s.id()) {
            let schedule = stripe::SubscriptionSchedule::retrieve(&self.client, &id, &[])
                .await
                .map_err(storage)?;
            require_owned_schedule(&schedule)?;
            Some(schedule)
        } else {
            None
        };
        if plan.is_none() && existing.is_none() {
            return Ok(());
        }
        let mut pending = if let Some(schedule) = existing.as_ref() {
            self.pending_changes(schedule, &subscription).await?
        } else {
            PendingChanges {
                at: subscription.current_period_end,
                members: HashMap::new(),
            }
        };
        if pending.at <= subscription.current_period_start {
            pending = PendingChanges {
                at: subscription.current_period_end,
                members: HashMap::new(),
            };
        }
        match plan {
            Some(SeatPlan::Premium) => {
                pending.members.insert(user.to_string(), SeatPlan::Premium);
            }
            Some(_) => return Err(CustomerError::PlanUnavailable(plan.unwrap())),
            None => {
                pending.members.remove(user.as_ref());
            }
        }
        if pending.members.is_empty() {
            if let Some(schedule) = existing {
                self.release_schedule(&schedule.id).await?;
            }
            return Ok(());
        }
        let schedule = match existing {
            Some(s) => s,
            None => {
                let mut create = stripe::CreateSubscriptionSchedule::new();
                create.from_subscription = Some(id.as_str());
                create.metadata = Some(HashMap::from([(OWNED_KEY.to_string(), "1".to_string())]));
                stripe::SubscriptionSchedule::create(&self.client, create)
                    .await
                    .map_err(storage)?
            }
        };
        let current = phase_parameters(current_phase(&schedule, &subscription)?)?;
        self.write_schedule(&schedule, &subscription, current, pending, "none", None)
            .await
    }

    async fn upgrade_personal_plan(
        &self,
        id: &stripe::SubscriptionId,
        plan: SeatPlan,
        end_trial: bool,
    ) -> Result<(), CustomerError> {
        let _billing = self.subscription_guard(id, None).await?;
        let subscription = stripe::Subscription::retrieve(&self.client, id, &[])
            .await
            .map_err(storage)?;
        // Both cancellation and the price replacement use this same guard.
        // Calling the public schedule method here would acquire it recursively.
        if let Some(schedule) = subscription.schedule.as_ref() {
            let schedule =
                stripe::SubscriptionSchedule::retrieve(&self.client, &schedule.id(), &[])
                    .await
                    .map_err(storage)?;
            require_owned_schedule(&schedule)?;
            self.release_schedule(&schedule.id).await?;
        }
        let item = subscription
            .items
            .data
            .iter()
            .find(|i| {
                i.price
                    .as_ref()
                    .is_some_and(|p| self.seat_prices.plan_for_price(p.id.as_str()).is_some())
            })
            .ok_or(CustomerError::NoMatchingLineItem)?;
        let end_trial = end_trial && subscription.status == stripe::SubscriptionStatus::Trialing;
        let mut params = UpdateSubscription {
            items: Some(vec![UpdateSubscriptionItems { id: Some(item.id.to_string()), price: Some(self.seat_prices.price_id(plan)?.to_string()), ..Default::default() }]),
            metadata: Some(HashMap::from([("macro_plan_change_at".to_string(), chrono::Utc::now().to_rfc3339()), (APPLIED_KEY.to_string(), String::new())])),
            proration_behavior: Some(stripe::generated::billing::subscription::SubscriptionProrationBehavior::AlwaysInvoice), ..Default::default()
        };
        if end_trial {
            params.trial_end = Some(stripe::Scheduled::now());
            params.billing_cycle_anchor = Some(stripe::SubscriptionBillingCycleAnchor::Now);
        }
        stripe::Subscription::update(&self.client, id, params)
            .await
            .map_err(storage)?;
        Ok(())
    }

    async fn renewed_seat_plans(
        &self,
        id: &stripe::SubscriptionId,
    ) -> Result<Vec<(String, SeatPlan)>, CustomerError> {
        let subscription = stripe::Subscription::retrieve(&self.client, id, &[])
            .await
            .map_err(storage)?;
        let Some(encoded) = subscription
            .metadata
            .get(APPLIED_KEY)
            .filter(|s| !s.is_empty())
        else {
            return Ok(Vec::new());
        };
        let changes = self.read_pending(id.as_str(), encoded).await?;
        Ok(if subscription.current_period_start >= changes.at {
            changes.members.into_iter().collect()
        } else {
            Vec::new()
        })
    }

    async fn acknowledge_renewed_seat_plans(
        &self,
        id: &stripe::SubscriptionId,
    ) -> Result<(), CustomerError> {
        let _billing = self.subscription_guard(id, None).await?;
        let params = stripe::UpdateSubscription {
            metadata: Some(HashMap::from([(APPLIED_KEY.to_string(), String::new())])),
            ..Default::default()
        };
        stripe::Subscription::update(&self.client, id, params)
            .await
            .map_err(storage)?;
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn replay_item_change(&self, idempotency_key: &str) -> Result<bool, CustomerError> {
        CustomerRepositoryImpl::replay_item_change(self, idempotency_key).await
    }

    async fn change_item_quantities(
        &self,
        subscription_id: &stripe::SubscriptionId,
        changes: Vec<ItemQuantityChange>,
        idempotency_key: &str,
    ) -> Result<(), CustomerError> {
        let _billing = self
            .subscription_guard(subscription_id, Some(idempotency_key))
            .await?;
        if let Some(change) = self.item_change(idempotency_key).await? {
            return self
                .replay_item_change_locked(idempotency_key, change)
                .await;
        }
        let subscription = stripe::Subscription::retrieve(&self.client, subscription_id, &[])
            .await
            .map_err(storage)?;
        if subscription
            .metadata
            .get(ITEM_CHANGE_KEY)
            .map(String::as_str)
            == Some(idempotency_key)
        {
            tracing::info!("item change already applied");
            return Ok(());
        }
        let items = item_quantity_updates(&subscription, &changes)?;
        if items.is_empty() {
            return Ok(());
        }
        let adds = changes.iter().any(|change| change.delta > 0);
        let billable = match subscription.status {
            stripe::SubscriptionStatus::Active | stripe::SubscriptionStatus::Trialing => true,
            // Removing items from a subscription behind on payment still
            // stops what it bills; adding to one is refused.
            stripe::SubscriptionStatus::PastDue | stripe::SubscriptionStatus::Unpaid => !adds,
            _ => false,
        };
        if !billable {
            return Err(CustomerError::SubscriptionNotActive);
        }
        self.update_retrieved_items(
            subscription,
            items,
            ItemUpdateOptions {
                idempotency_key: Some(idempotency_key),
                error_if_incomplete: true,
            },
        )
        .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn subscription_terms(
        &self,
        subscription_id: &stripe::SubscriptionId,
    ) -> Result<SubscriptionTerms, CustomerError> {
        let subscription = stripe::Subscription::retrieve(&self.client, subscription_id, &[])
            .await
            .map_err(storage)?;
        let interval = subscription
            .items
            .data
            .iter()
            .find_map(|item| item.price.as_ref()?.recurring.as_ref())
            .map(|recurring| cadence(recurring.interval))
            .ok_or(SubscriptionDataError::MissingRecurringItem)?;
        let current_period_end =
            chrono::DateTime::from_timestamp(subscription.current_period_end, 0)
                .ok_or(SubscriptionDataError::InvalidPeriodEnd)?;
        Ok(SubscriptionTerms {
            current_period_end,
            interval,
            currency: subscription.currency.to_string(),
        })
    }

    #[tracing::instrument(skip(self), err)]
    async fn price(
        &self,
        price_id: &stripe_price_id::StripePriceId,
    ) -> Result<PriceInfo, CustomerError> {
        let id: stripe::PriceId = price_id.as_str().parse().map_err(|error| {
            SubscriptionDataError::Internal(rootcause::Report::new(error).into_dynamic())
        })?;
        let price = stripe::Price::retrieve(&self.client, &id, &[])
            .await
            .map_err(storage)?;
        Ok(PriceInfo {
            amount: price
                .unit_amount
                .ok_or(SubscriptionDataError::MissingUnitAmount)?,
            currency: price
                .currency
                .ok_or(SubscriptionDataError::MissingCurrency)?
                .to_string(),
            interval: price.recurring.map(|recurring| cadence(recurring.interval)),
        })
    }

    #[tracing::instrument(skip(self), err)]
    async fn cancel_subscription(
        &self,
        subscription_id: &stripe::SubscriptionId,
    ) -> Result<(), CustomerError> {
        let _billing = self.subscription_guard(subscription_id, None).await?;
        // Cancelling is idempotent: a subscription that is already cancelled,
        // or that went away with its customer, needs nothing further.
        match stripe::Subscription::retrieve(&self.client, subscription_id, &[]).await {
            Ok(subscription) if subscription.status == stripe::SubscriptionStatus::Canceled => {
                return Ok(());
            }
            Ok(_) => {}
            Err(stripe::StripeError::Stripe(error))
                if matches!(error.code, Some(stripe::ErrorCode::ResourceMissing)) =>
            {
                return Ok(());
            }
            Err(error) => return Err(CustomerError::StorageLayerError(error.into())),
        }

        let cancel_params = stripe::CancelSubscription::default();

        stripe::Subscription::cancel(&self.client, subscription_id, cancel_params)
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn convert_subscription_to_team(
        &self,
        subscription_id: &stripe::SubscriptionId,
        team_id: &uuid::Uuid,
        team_owner_id: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<(), CustomerError> {
        let _billing = self.subscription_guard(subscription_id, None).await?;
        let mut metadata = HashMap::new();
        metadata.insert("team_id".to_string(), team_id.to_string());
        metadata.insert("owner_id".to_string(), team_owner_id.to_string());

        let mut params = UpdateSubscription::new();
        params.metadata = Some(metadata);

        stripe::Subscription::update(&self.client, subscription_id, params)
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_subscription_id_for_customer(
        &self,
        customer_id: &stripe::CustomerId,
    ) -> Result<Option<stripe::SubscriptionId>, CustomerError> {
        // Stripe's `active` filter excludes `trialing`, so list every
        // uncanceled subscription and choose here. A trial grants Pro like
        // an active subscription, and a team created during the trial must
        // link it.
        let mut params = stripe::ListSubscriptions::new();
        params.customer = Some(customer_id.clone());
        params.limit = Some(MAX_SUBSCRIPTIONS_PER_CUSTOMER);

        let subscriptions = stripe::Subscription::list(&self.client, &params)
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;

        Ok(paying_subscription(subscriptions.data))
    }
}

/// Customers hold one live subscription; the cap only bounds the listing.
const MAX_SUBSCRIPTIONS_PER_CUSTOMER: u64 = 100;

/// The subscription a team should bill through: an active one, else a trial.
fn paying_subscription(subscriptions: Vec<stripe::Subscription>) -> Option<stripe::SubscriptionId> {
    let mut trialing = None;
    for subscription in subscriptions {
        match subscription.status {
            stripe::SubscriptionStatus::Active => return Some(subscription.id),
            stripe::SubscriptionStatus::Trialing => {
                trialing.get_or_insert(subscription.id);
            }
            _ => {}
        }
    }
    trialing
}

const OWNED_KEY: &str = "macro_plan_schedule";
/// Provider metadata holding the key of the last atomically applied item change.
const ITEM_CHANGE_KEY: &str = "macro_item_change";
const PENDING_KEY: &str = "macro_pending_seats";
const APPLIED_KEY: &str = "macro_renewed_seats";

#[derive(serde::Serialize, serde::Deserialize)]
struct PendingChanges {
    at: i64,
    members: HashMap<String, SeatPlan>,
}
#[derive(serde::Serialize)]
struct ScheduleUpdate<'a> {
    phases: Vec<serde_json::Value>,
    proration_behavior: &'a str,
    end_behavior: &'a str,
    metadata: HashMap<String, String>,
}
fn storage(error: stripe::StripeError) -> CustomerError {
    CustomerError::StorageLayerError(error.into())
}

fn require_owned_schedule(schedule: &stripe::SubscriptionSchedule) -> Result<(), CustomerError> {
    if schedule
        .metadata
        .as_ref()
        .and_then(|m| m.get(OWNED_KEY))
        .map(String::as_str)
        != Some("1")
    {
        return Err(CustomerError::StorageLayerError(anyhow::anyhow!(
            "subscription has an externally managed schedule"
        )));
    }
    Ok(())
}
fn current_phase<'a>(
    schedule: &'a stripe::SubscriptionSchedule,
    subscription: &stripe::Subscription,
) -> Result<&'a stripe::SubscriptionSchedulePhaseConfiguration, CustomerError> {
    schedule
        .phases
        .iter()
        .find(|p| {
            p.start_date <= subscription.current_period_start
                && p.end_date > subscription.current_period_start
        })
        .ok_or_else(|| {
            CustomerError::StorageLayerError(anyhow::anyhow!("missing current subscription phase"))
        })
}
// Stripe returns expanded objects where updates require IDs. Keep all phase
// settings (discounts, taxes, collection and payment settings), normalizing only
// expandable references and response-only item aliases.
fn phase_parameters(
    phase: &stripe::SubscriptionSchedulePhaseConfiguration,
) -> Result<serde_json::Value, CustomerError> {
    let mut value =
        serde_json::to_value(phase).map_err(|e| CustomerError::StorageLayerError(e.into()))?;
    normalize_references(&mut value);
    value["proration_behavior"] = "none".into();
    if value.get("metadata").is_none_or(serde_json::Value::is_null) {
        value["metadata"] = serde_json::json!({});
    }
    Ok(value)
}
fn normalize_references(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) if map.contains_key("id") => {
            *value = map["id"].clone();
        }
        serde_json::Value::Object(map) => {
            map.retain(|key, val| !val.is_null() && key != "plan");
            for value in map.values_mut() {
                normalize_references(value);
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                normalize_references(value);
            }
        }
        _ => {}
    }
}
fn phase_quantities(phase: &serde_json::Value) -> Result<HashMap<String, u64>, CustomerError> {
    let items = phase["items"].as_array().context("missing phase items")?;
    items
        .iter()
        .map(|i| {
            Ok((
                i["price"]
                    .as_str()
                    .context("missing phase price")?
                    .to_string(),
                i["quantity"].as_u64().unwrap_or(1),
            ))
        })
        .collect()
}
fn replace_quantities(phase: &mut serde_json::Value, quantities: &HashMap<String, u64>) {
    let old = phase["items"].as_array().cloned().unwrap_or_default();
    let mut items = quantities
        .iter()
        .filter(|(_, n)| **n > 0)
        .map(|(price, quantity)| {
            let mut item = old
                .iter()
                .find(|i| i["price"].as_str() == Some(price.as_str()))
                .cloned()
                .unwrap_or_else(|| serde_json::json!({"price": price}));
            item["quantity"] = (*quantity).into();
            item
        })
        .collect::<Vec<_>>();
    items.sort_by(|a, b| a["price"].as_str().cmp(&b["price"].as_str()));
    phase["items"] = items.into();
}
