//! Implementation for CustomerRepository using Stripe.

use std::{collections::HashMap, sync::Arc};

use anyhow::Context;
use stripe::{UpdateSubscription, UpdateSubscriptionItems};

use crate::domain::{
    customer_repo::CustomerRepository,
    model::{CustomerError, SeatPlan, SeatPrices},
};

/// The CustomerRepositoryImpl struct is a wrapper around a stripe::Client connected to stripe.
#[derive(Clone)]
pub struct CustomerRepositoryImpl {
    /// The underlying stripe::Client connected to stripe.
    client: Arc<stripe::Client>,
    /// The Stripe price behind each plan's seat item. A team subscription
    /// holds one item per plan its members are on.
    seat_prices: SeatPrices,
}

/// One plan's seat item on a subscription.
#[derive(Debug, Clone)]
struct SeatItem {
    id: String,
    quantity: u64,
}

impl CustomerRepositoryImpl {
    /// Creates a new instance of CustomerRepositoryImpl
    pub fn new(stripe_client: stripe::Client, seat_prices: SeatPrices) -> Self {
        Self {
            client: Arc::new(stripe_client),
            seat_prices,
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
    #[tracing::instrument(skip(self), err)]
    async fn increment_seat_count(
        &self,
        subscription_id: &stripe::SubscriptionId,
        plan: SeatPlan,
        amount: u64,
    ) -> Result<(), CustomerError> {
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

    #[tracing::instrument(skip(self), err)]
    async fn cancel_subscription(
        &self,
        subscription_id: &stripe::SubscriptionId,
    ) -> Result<(), CustomerError> {
        let cancel_parmas = stripe::CancelSubscription::default();

        stripe::Subscription::cancel(&self.client, subscription_id, cancel_parmas)
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
