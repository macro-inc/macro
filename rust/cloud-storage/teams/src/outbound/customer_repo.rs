//! Implementation for CustomerRepository using Stripe.

use std::{collections::HashMap, sync::Arc};

use anyhow::Context;
use stripe::UpdateSubscription;

use crate::domain::{customer_repo::CustomerRepository, model::CustomerError};

/// The CustomerRepositoryImpl struct is a wrapper around a stripe::Client connected to stripe.
#[derive(Clone)]
pub struct CustomerRepositoryImpl {
    /// The underlying stripe::Client connected to stripe.
    client: Arc<stripe::Client>,
    /// The stripe price id for the per-seat subscription item.
    stripe_price_id: String,
}

impl CustomerRepositoryImpl {
    /// Creates a new instance of CustomerRepositoryImpl
    pub fn new(stripe_client: stripe::Client, stripe_price_id: String) -> Self {
        Self {
            client: Arc::new(stripe_client),
            stripe_price_id,
        }
    }

    async fn get_seat_subscription_item(
        &self,
        subscription_id: &stripe::SubscriptionId,
    ) -> Result<(String, u64), CustomerError> {
        let subscription = stripe::Subscription::retrieve(&self.client, subscription_id, &[])
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;

        if subscription.status != stripe::SubscriptionStatus::Active {
            return Err(CustomerError::SubscriptionNotActive);
        }

        let item = subscription
            .items
            .data
            .iter()
            .find(|item| {
                item.price
                    .as_ref()
                    .map(|price| price.id == self.stripe_price_id)
                    .unwrap_or(false)
            })
            .ok_or(CustomerError::NoMatchingLineItem)?;

        Ok((item.id.to_string(), item.quantity.unwrap_or(1)))
    }

    async fn update_seat_subscription_item(
        &self,
        subscription_id: &stripe::SubscriptionId,
        subscription_item_id: String,
        quantity: u64,
    ) -> Result<(), CustomerError> {
        let update_params = UpdateSubscription {
            items: Some(vec![stripe::UpdateSubscriptionItems {
                id: Some(subscription_item_id),
                quantity: Some(quantity),
                ..Default::default()
            }]),
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
        amount: u64,
    ) -> Result<(), CustomerError> {
        let (subscription_item_id, current_quantity) =
            self.get_seat_subscription_item(subscription_id).await?;
        let quantity = current_quantity
            .checked_add(amount)
            .context("seat count overflow")?;

        self.update_seat_subscription_item(subscription_id, subscription_item_id, quantity)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn decrement_seat_count(
        &self,
        subscription_id: &stripe::SubscriptionId,
        amount: u64,
    ) -> Result<(), CustomerError> {
        let (subscription_item_id, current_quantity) =
            self.get_seat_subscription_item(subscription_id).await?;
        let quantity = current_quantity.saturating_sub(amount).max(1);

        self.update_seat_subscription_item(subscription_id, subscription_item_id, quantity)
            .await
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
