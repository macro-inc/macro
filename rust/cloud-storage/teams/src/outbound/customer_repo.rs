//! Implementation for CustomerRepository using Stripe.

use std::sync::Arc;

use stripe::{CreateSubscription, CreateSubscriptionItems, UpdateSubscription};

use crate::domain::{
    customer_repo::CustomerRepository,
    model::{CreateSubscriptionArgs, CustomerError},
};

/// The CustomerRepositoryImpl struct is a wrapper around a stripe::Client connected to stripe.
#[derive(Clone)]
pub struct CustomerRepositoryImpl {
    /// The underlying stripe::Client connected to stripe.
    client: Arc<stripe::Client>,
}

impl CustomerRepositoryImpl {
    /// Creates a new instance of CustomerRepositoryImpl
    pub fn new(stripe_client: stripe::Client) -> Self {
        Self {
            client: Arc::new(stripe_client),
        }
    }
}

impl CustomerRepository for CustomerRepositoryImpl {
    async fn create_subscription(
        &self,
        args: CreateSubscriptionArgs<'_>,
    ) -> Result<stripe::SubscriptionId, CustomerError> {
        // Create the subscription
        let mut params = CreateSubscription::new(args.customer_id);
        params.items = Some(vec![CreateSubscriptionItems {
            price: Some(args.price_id.to_string()),
            quantity: Some(args.quantity),
            ..Default::default()
        }]);

        params.metadata = args.metadata;

        let subscription = stripe::Subscription::create(&self.client, params)
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;

        Ok(subscription.id)
    }

    async fn increase_subscription_quantity(
        &self,
        subscription_id: &stripe::SubscriptionId,
        increase_amount: u64,
    ) -> Result<(), CustomerError> {
        // Get existing subscription quantity
        let subscription = stripe::Subscription::retrieve(&self.client, subscription_id, &[])
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;

        match subscription.status {
            stripe::SubscriptionStatus::Active => (),
            _ => {
                return Err(CustomerError::SubscriptionNotActive);
            }
        }

        // Get the first subscription item (assuming single item subscription)
        let item = subscription.items.data.first().ok_or_else(|| {
            CustomerError::StorageLayerError(anyhow::anyhow!("No subscription items found"))
        })?;

        // There should always be a quantity on the subscription item
        let current_quantity = item.quantity.unwrap_or(1);
        let new_quantity = current_quantity + increase_amount;

        // Update the subscription item quantity
        let update_params = UpdateSubscription { items: Some(vec![stripe::UpdateSubscriptionItems {
                  id: Some(item.id.to_string()),
                  quantity: Some(new_quantity),
                  ..Default::default()
              }]), proration_behavior: Some(stripe::generated::billing::subscription::SubscriptionProrationBehavior::CreateProrations), ..Default::default()};

        stripe::Subscription::update(&self.client, subscription_id, update_params)
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;

        Ok(())
    }

    async fn decrease_subscription_quantity(
        &self,
        subscription_id: &stripe::SubscriptionId,
        decrease_amount: u64,
    ) -> Result<(), CustomerError> {
        // Get existing subscription
        let subscription = stripe::Subscription::retrieve(&self.client, subscription_id, &[])
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;

        // Check if subscription is active
        match subscription.status {
            stripe::SubscriptionStatus::Active => (),
            _ => {
                return Err(CustomerError::SubscriptionNotActive);
            }
        }

        // Get the first subscription item (assuming single item subscription)
        let item = subscription.items.data.first().ok_or_else(|| {
            CustomerError::StorageLayerError(anyhow::anyhow!("No subscription items found"))
        })?;

        let current_quantity = item.quantity.unwrap_or(1);

        // Check if decrease amount would result in quantity < 1
        if decrease_amount >= current_quantity {
            // Cancel the subscription instead
            return self.cancel_subscription(subscription_id).await;
        }

        let new_quantity = current_quantity - decrease_amount;

        // Update the subscription item quantity
        let update_params = UpdateSubscription { items: Some(vec![stripe::UpdateSubscriptionItems {
                  id: Some(item.id.to_string()),
                  quantity: Some(new_quantity),
                  ..Default::default()
              }]), proration_behavior: Some(stripe::generated::billing::subscription::SubscriptionProrationBehavior::CreateProrations), ..Default::default()};

        stripe::Subscription::update(&self.client, subscription_id, update_params)
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;

        Ok(())
    }

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
}
