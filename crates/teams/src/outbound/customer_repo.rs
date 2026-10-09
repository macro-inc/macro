//! Implementation for CustomerRepository using Stripe.

use std::{collections::HashMap, sync::Arc};

#[cfg(test)]
mod test;

use anyhow::Context;
use macro_user_id::user_id::MacroUserIdStr;
use stripe::{UpdateSubscription, UpdateSubscriptionItems};

use crate::domain::{
    customer_repo::CustomerRepository,
    model::{CustomerError, ScheduledSeatPlan, SeatPlan, SeatPrices},
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

/// One plan's seat item on a subscription.
#[derive(Debug, Clone)]
struct SeatItem {
    id: String,
    quantity: u64,
}

impl CustomerRepositoryImpl {
    async fn billing_guard(
        locks: &sqlx::PgPool,
        key: &str,
    ) -> Result<sqlx::Transaction<'static, sqlx::Postgres>, CustomerError> {
        let mut guard = locks
            .begin()
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;
        sqlx::query!("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key)
            .execute(&mut *guard)
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;
        Ok(guard)
    }

    async fn subscription_guard(
        &self,
        id: &stripe::SubscriptionId,
    ) -> Result<sqlx::Transaction<'static, sqlx::Postgres>, CustomerError> {
        Self::billing_guard(
            &self.subscription_locks,
            &format!("subscription-billing:{id}"),
        )
        .await
    }

    async fn read_pending(
        &self,
        subscription: &str,
        record: &str,
    ) -> Result<PendingChanges, CustomerError> {
        let id: uuid::Uuid = record
            .parse()
            .map_err(|e| CustomerError::StorageLayerError(anyhow::Error::from(e)))?;
        let row = sqlx::query!("SELECT effective_at, member_plans FROM subscription_plan_schedule WHERE id = $1 AND subscription_id = $2", id, subscription).fetch_one(&self.pool).await.map_err(|e| CustomerError::StorageLayerError(e.into()))?;
        Ok(PendingChanges {
            at: row.effective_at.timestamp(),
            members: serde_json::from_value(row.member_plans)
                .map_err(|e| CustomerError::StorageLayerError(e.into()))?,
        })
    }
    async fn pending_changes(
        &self,
        schedule: &stripe::SubscriptionSchedule,
        subscription: &stripe::Subscription,
    ) -> Result<PendingChanges, CustomerError> {
        match schedule.metadata.as_ref().and_then(|m| m.get(PENDING_KEY)) {
            Some(record) => self.read_pending(subscription.id.as_str(), record).await,
            None => Ok(PendingChanges {
                at: subscription.current_period_end,
                members: HashMap::new(),
            }),
        }
    }

    async fn read_scheduled_seat_plans(
        &self,
        subscription: &stripe::SubscriptionId,
        schedule: &stripe::SubscriptionScheduleId,
    ) -> Result<HashMap<String, ScheduledSeatPlan>, CustomerError> {
        let schedule = stripe::SubscriptionSchedule::retrieve(&self.client, schedule, &[])
            .await
            .map_err(storage)?;
        if schedule
            .metadata
            .as_ref()
            .and_then(|m| m.get(OWNED_KEY))
            .map(String::as_str)
            != Some("1")
            || !matches!(
                schedule.status,
                stripe::SubscriptionScheduleStatus::Active
                    | stripe::SubscriptionScheduleStatus::NotStarted
            )
        {
            return Ok(HashMap::new());
        }
        let Some(record) = schedule.metadata.as_ref().and_then(|m| m.get(PENDING_KEY)) else {
            return Ok(HashMap::new());
        };
        let changes = self.read_pending(subscription.as_str(), record).await?;
        let effective_at =
            chrono::DateTime::from_timestamp(changes.at, 0).context("invalid scheduled renewal")?;
        Ok(changes
            .members
            .into_iter()
            .map(|(user, plan)| (user, ScheduledSeatPlan { plan, effective_at }))
            .collect())
    }

    async fn release_schedule(
        &self,
        id: &stripe::SubscriptionScheduleId,
    ) -> Result<(), CustomerError> {
        self.client
            .post::<stripe::SubscriptionSchedule>(&format!("/subscription_schedules/{id}/release"))
            .await
            .map_err(storage)?;
        Ok(())
    }

    async fn write_schedule(
        &self,
        schedule: &stripe::SubscriptionSchedule,
        subscription: &stripe::Subscription,
        mut current: serde_json::Value,
        pending: PendingChanges,
        proration: &str,
    ) -> Result<(), CustomerError> {
        current["end_date"] = pending.at.into();
        let mut next = current.clone();
        next["start_date"] = pending.at.into();
        next.as_object_mut().unwrap().remove("end_date");
        next.as_object_mut().unwrap().remove("trial_end");
        next.as_object_mut().unwrap().remove("add_invoice_items");
        next["iterations"] = 1.into();
        next["proration_behavior"] = "none".into();
        let mut quantities = phase_quantities(&current)?;
        let max = self.seat_prices.price_id(SeatPlan::Max)?.to_string();
        let pro = self.seat_prices.price_id(SeatPlan::Premium)?.to_string();
        let count = pending.members.len() as u64;
        let source = quantities.get(&max).copied().unwrap_or(0);
        if source < count {
            return Err(CustomerError::StorageLayerError(anyhow::anyhow!(
                "scheduled downgrades exceed active Max seats"
            )));
        }
        // A new lower-price item retains the seat's item-level tax and billing
        // settings as well as the phase-wide settings copied above.
        let source_item = next["items"]
            .as_array()
            .and_then(|items| {
                items
                    .iter()
                    .find(|item| item["price"].as_str() == Some(max.as_str()))
            })
            .cloned();
        if let Some(mut item) = source_item
            && !next["items"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["price"].as_str() == Some(pro.as_str()))
        {
            item["price"] = pro.clone().into();
            next["items"].as_array_mut().unwrap().push(item);
        }
        quantities.insert(max, source - count);
        *quantities.entry(pro).or_default() += count;
        replace_quantities(&mut next, &quantities);
        if next.get("metadata").is_none() {
            next["metadata"] = serde_json::json!({});
        }
        let record_id = macro_uuid::generate_uuid_v7();
        let effective_at =
            chrono::DateTime::from_timestamp(pending.at, 0).context("invalid scheduled renewal")?;
        let members = serde_json::to_value(&pending.members)
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;
        sqlx::query!("INSERT INTO subscription_plan_schedule (id, subscription_id, effective_at, member_plans) VALUES ($1, $2, $3, $4)", record_id, subscription.id.as_str(), effective_at, members).execute(&self.pool).await.map_err(|e| CustomerError::StorageLayerError(e.into()))?;
        let encoded = record_id.to_string();
        next["metadata"][APPLIED_KEY] = encoded.clone().into();
        let request = ScheduleUpdate {
            phases: vec![current, next],
            proration_behavior: proration,
            end_behavior: "release",
            metadata: HashMap::from([
                (OWNED_KEY.to_string(), "1".to_string()),
                (PENDING_KEY.to_string(), encoded),
            ]),
        };
        self.client
            .post_form::<stripe::SubscriptionSchedule, _>(
                &format!("/subscription_schedules/{}", schedule.id),
                &request,
            )
            .await
            .map_err(storage)?;
        Ok(())
    }

    /// Creates a new instance of CustomerRepositoryImpl
    pub fn new(stripe_client: stripe::Client, seat_prices: SeatPrices, pool: sqlx::PgPool) -> Self {
        // Guards hold connections across provider and repository calls. Separate
        // pools keep waiters from exhausting the pool those calls need, and keep
        // the team -> subscription lock order from exhausting its own capacity.
        let lock_pool = || {
            sqlx::postgres::PgPoolOptions::new()
                .max_connections(pool.options().get_max_connections().min(4))
                .idle_timeout(std::time::Duration::from_secs(60))
                .connect_lazy_with(
                    pool.connect_options()
                        .as_ref()
                        .clone()
                        .options([("lock_timeout", "30000")]),
                )
        };
        let team_locks = lock_pool();
        let subscription_locks = lock_pool();
        Self {
            client: Arc::new(stripe_client),
            seat_prices,
            pool,
            team_locks,
            subscription_locks,
        }
    }

    /// The active subscription's seat items, keyed by plan.
    async fn get_seat_items(
        &self,
        subscription_id: &stripe::SubscriptionId,
    ) -> Result<HashMap<SeatPlan, SeatItem>, CustomerError> {
        let subscription = stripe::Subscription::retrieve(&self.client, subscription_id, &[])
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;

        if subscription.status != stripe::SubscriptionStatus::Active
            && subscription.status != stripe::SubscriptionStatus::Trialing
        {
            return Err(CustomerError::SubscriptionNotActive);
        }

        let items: HashMap<SeatPlan, SeatItem> = subscription
            .items
            .data
            .iter()
            .filter_map(|item| {
                let price = item.price.as_ref()?;
                let plan = self.seat_prices.plan_for_price(price.id.as_str())?;
                Some((
                    plan,
                    SeatItem {
                        id: item.id.to_string(),
                        quantity: item.quantity.unwrap_or(1),
                    },
                ))
            })
            .collect();

        if items.is_empty() {
            return Err(CustomerError::NoMatchingLineItem);
        }

        Ok(items)
    }

    /// The item update that leaves `plan` with `quantity` seats: a new item
    /// when the plan had none, a deletion when it drops to zero.
    fn seat_item_update(
        &self,
        plan: SeatPlan,
        existing: Option<&SeatItem>,
        quantity: u64,
    ) -> Result<UpdateSubscriptionItems, CustomerError> {
        Ok(match existing {
            Some(item) if quantity == 0 => UpdateSubscriptionItems {
                id: Some(item.id.clone()),
                deleted: Some(true),
                ..Default::default()
            },
            Some(item) => UpdateSubscriptionItems {
                id: Some(item.id.clone()),
                quantity: Some(quantity),
                ..Default::default()
            },
            None => UpdateSubscriptionItems {
                price: Some(self.seat_prices.price_id(plan)?.to_string()),
                quantity: Some(quantity),
                ..Default::default()
            },
        })
    }

    async fn update_items(
        &self,
        subscription_id: &stripe::SubscriptionId,
        items: Vec<UpdateSubscriptionItems>,
    ) -> Result<(), CustomerError> {
        let subscription = stripe::Subscription::retrieve(&self.client, subscription_id, &[])
            .await
            .map_err(storage)?;
        if let Some(schedule_id) = subscription.schedule.as_ref().map(|s| s.id()) {
            let schedule = stripe::SubscriptionSchedule::retrieve(&self.client, &schedule_id, &[])
                .await
                .map_err(storage)?;
            require_owned_schedule(&schedule)?;
            let pending = self.pending_changes(&schedule, &subscription).await?;
            if pending.at > subscription.current_period_start {
                let current = current_phase(&schedule, &subscription)?;
                let mut phase = phase_parameters(current)?;
                let mut quantities = subscription
                    .items
                    .data
                    .iter()
                    .filter_map(|i| {
                        i.price
                            .as_ref()
                            .map(|p| (p.id.to_string(), i.quantity.unwrap_or(1)))
                    })
                    .collect::<HashMap<_, _>>();
                for update in &items {
                    let price = update
                        .price
                        .clone()
                        .or_else(|| {
                            subscription
                                .items
                                .data
                                .iter()
                                .find(|i| Some(i.id.as_str()) == update.id.as_deref())
                                .and_then(|i| i.price.as_ref())
                                .map(|p| p.id.to_string())
                        })
                        .context("missing item price")?;
                    if update.deleted == Some(true) {
                        quantities.remove(&price);
                    } else {
                        quantities.insert(price, update.quantity.unwrap_or(1));
                    }
                }
                replace_quantities(&mut phase, &quantities);
                return self
                    .write_schedule(&schedule, &subscription, phase, pending, "always_invoice")
                    .await;
            }
            // The scheduled phase already became effective. Release it before
            // an immediate upgrade; acknowledging old metadata cannot undo it.
            self.release_schedule(&schedule.id).await?;
        }
        let update_params = UpdateSubscription {
            items: Some(items),
            proration_behavior: Some(
                stripe::generated::billing::subscription::SubscriptionProrationBehavior::AlwaysInvoice,
            ),
            ..Default::default()
        };

        stripe::Subscription::update(&self.client, subscription_id, update_params)
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;

        Ok(())
    }
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

    #[tracing::instrument(skip(self), err)]
    async fn increment_seat_count(
        &self,
        subscription_id: &stripe::SubscriptionId,
        plan: SeatPlan,
        amount: u64,
    ) -> Result<(), CustomerError> {
        let _billing = self.subscription_guard(subscription_id).await?;
        let items = self.get_seat_items(subscription_id).await?;
        let existing = items.get(&plan);
        let quantity = existing
            .map_or(0, |item| item.quantity)
            .checked_add(amount)
            .context("seat count overflow")?;
        let update = self.seat_item_update(plan, existing, quantity)?;

        self.update_items(subscription_id, vec![update]).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn decrement_seat_count(
        &self,
        subscription_id: &stripe::SubscriptionId,
        plan: SeatPlan,
        amount: u64,
    ) -> Result<(), CustomerError> {
        let _billing = self.subscription_guard(subscription_id).await?;
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

        self.update_items(subscription_id, vec![update]).await
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
        let _billing = self.subscription_guard(subscription_id).await?;
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

        self.update_items(subscription_id, updates).await
    }

    async fn schedule_seat_plan(
        &self,
        id: &stripe::SubscriptionId,
        user: &MacroUserIdStr<'_>,
        plan: Option<SeatPlan>,
    ) -> Result<(), CustomerError> {
        let _billing = self.subscription_guard(id).await?;
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
        self.write_schedule(&schedule, &subscription, current, pending, "none")
            .await
    }

    async fn upgrade_personal_plan(
        &self,
        id: &stripe::SubscriptionId,
        plan: SeatPlan,
    ) -> Result<(), CustomerError> {
        let _billing = self.subscription_guard(id).await?;
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
        let params = UpdateSubscription {
            items: Some(vec![UpdateSubscriptionItems { id: Some(item.id.to_string()), price: Some(self.seat_prices.price_id(plan)?.to_string()), ..Default::default() }]),
            metadata: Some(HashMap::from([("macro_plan_change_at".to_string(), chrono::Utc::now().to_rfc3339()), (APPLIED_KEY.to_string(), String::new())])),
            proration_behavior: Some(stripe::generated::billing::subscription::SubscriptionProrationBehavior::AlwaysInvoice), ..Default::default()
        };
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
        let _billing = self.subscription_guard(id).await?;
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
    async fn cancel_subscription(
        &self,
        subscription_id: &stripe::SubscriptionId,
    ) -> Result<(), CustomerError> {
        let _billing = self.subscription_guard(subscription_id).await?;
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
        let _billing = self.subscription_guard(subscription_id).await?;
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
    ) -> Result<stripe::SubscriptionId, CustomerError> {
        let mut params = stripe::ListSubscriptions::new();
        params.customer = Some(customer_id.clone());
        params.status = Some(stripe::SubscriptionStatusFilter::Active);
        params.limit = Some(1);

        let subscriptions = stripe::Subscription::list(&self.client, &params)
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;

        subscriptions
            .data
            .into_iter()
            .next()
            .map(|sub| sub.id)
            .ok_or(CustomerError::SubscriptionNotActive)
    }
}

const OWNED_KEY: &str = "macro_plan_schedule";
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
