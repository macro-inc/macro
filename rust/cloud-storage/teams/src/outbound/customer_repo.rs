//! Implementation for CustomerRepository using Stripe.

use std::{collections::HashMap, sync::Arc};

use stripe::{CreateSubscription, CreateSubscriptionItems, UpdateSubscription};

use crate::domain::{
    customer_repo::CustomerRepository,
    model::{CreateSubscriptionArgs, CustomerError},
};

/// The stripe price ids for all tiers
#[derive(Clone)]
pub struct StripePriceIds {
    /// haiku tier price id
    pub haiku: String,
    /// sonnet tier price id
    pub sonnet: String,
    /// opus tier price id
    pub opus: String,
}

/// The CustomerRepositoryImpl struct is a wrapper around a stripe::Client connected to stripe.
#[derive(Clone)]
pub struct CustomerRepositoryImpl {
    /// The underlying stripe::Client connected to stripe.
    client: Arc<stripe::Client>,
    /// The stripe price ids
    stripe_price_ids: StripePriceIds,
}

impl CustomerRepositoryImpl {
    /// Creates a new instance of CustomerRepositoryImpl
    pub fn new(stripe_client: stripe::Client, stripe_price_ids: StripePriceIds) -> Self {
        Self {
            client: Arc::new(stripe_client),
            stripe_price_ids,
        }
    }
}

impl CustomerRepository for CustomerRepositoryImpl {
    #[tracing::instrument(skip(self), err)]
    async fn create_subscription(
        &self,
        args: CreateSubscriptionArgs,
    ) -> Result<stripe::SubscriptionId, CustomerError> {
        // Create the subscription
        let mut params = CreateSubscription::new(args.customer_id);
        params.items = Some(vec![CreateSubscriptionItems {
            price: Some(self.stripe_price_ids.haiku.clone()),
            quantity: Some(args.quantity),
            ..Default::default()
        }]);

        params.metadata = args.metadata;

        let subscription = stripe::Subscription::create(&self.client, params)
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;

        Ok(subscription.id)
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
