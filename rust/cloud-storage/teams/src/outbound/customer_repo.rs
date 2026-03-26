//! Implementation for CustomerRepository using Stripe.

use std::{collections::HashMap, sync::Arc};

use stripe::{CreateSubscription, CreateSubscriptionItems, UpdateSubscription};

use crate::domain::{
    customer_repo::CustomerRepository,
    model::{CreateSubscriptionArgs, CustomerError, TeamUserTier},
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

impl StripePriceIds {
    /// Convert the team user tier to the price id
    fn price_id_for_tier(&self, team_user_tier: &TeamUserTier) -> &str {
        match team_user_tier {
            TeamUserTier::Haiku => &self.haiku,
            TeamUserTier::Sonnet => &self.sonnet,
            TeamUserTier::Opus => &self.opus,
        }
    }
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
    async fn increase_subscription_quantity(
        &self,
        subscription_id: &stripe::SubscriptionId,
        team_user_tier: TeamUserTier,
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

        let tier_price_id = self.stripe_price_ids.price_id_for_tier(&team_user_tier);

        // Find existing subscription item for this tier's price
        let existing_item = subscription.items.data.iter().find(|item| {
            item.price
                .as_ref()
                .map(|p| p.id == tier_price_id)
                .unwrap_or(false)
        });

        let items = match existing_item {
            // Tier line item exists — increment quantity
            Some(item) => {
                let current_quantity = item.quantity.unwrap_or(1);
                vec![stripe::UpdateSubscriptionItems {
                    id: Some(item.id.to_string()),
                    quantity: Some(current_quantity + 1),
                    ..Default::default()
                }]
            }
            // Tier line item doesn't exist — create with quantity 1
            None => {
                vec![stripe::UpdateSubscriptionItems {
                    price: Some(tier_price_id.to_string()),
                    quantity: Some(1),
                    ..Default::default()
                }]
            }
        };

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

    #[tracing::instrument(skip(self), err)]
    async fn decrease_subscription_quantity(
        &self,
        subscription_id: &stripe::SubscriptionId,
        team_user_tier: TeamUserTier,
    ) -> Result<(), CustomerError> {
        let subscription = stripe::Subscription::retrieve(&self.client, subscription_id, &[])
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;

        if subscription.status != stripe::SubscriptionStatus::Active {
            return Err(CustomerError::SubscriptionNotActive);
        }

        let tier_price_id = self.stripe_price_ids.price_id_for_tier(&team_user_tier);

        let item = subscription
            .items
            .data
            .iter()
            .find(|item| {
                item.price
                    .as_ref()
                    .map(|p| p.id == tier_price_id)
                    .unwrap_or(false)
            })
            .ok_or_else(|| {
                CustomerError::StorageLayerError(anyhow::anyhow!(
                    "No subscription item found for tier {:?}",
                    team_user_tier
                ))
            })?;

        let current_quantity = item.quantity.unwrap_or(1);

        // If this is the last item across all tiers, cancel the subscription
        if current_quantity <= 1 && subscription.items.data.len() == 1 {
            return self.cancel_subscription(subscription_id).await;
        }

        let items = if current_quantity <= 1 {
            // Last seat on this tier — delete the line item
            vec![stripe::UpdateSubscriptionItems {
                id: Some(item.id.to_string()),
                deleted: Some(true),
                ..Default::default()
            }]
        } else {
            // Decrement quantity
            vec![stripe::UpdateSubscriptionItems {
                id: Some(item.id.to_string()),
                quantity: Some(current_quantity - 1),
                ..Default::default()
            }]
        };

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

    #[tracing::instrument(skip(self), err)]
    async fn update_subscription_tier(
        &self,
        subscription_id: &stripe::SubscriptionId,
        old_team_user_tier: TeamUserTier,
        new_team_user_tier: TeamUserTier,
    ) -> Result<(), CustomerError> {
        if old_team_user_tier == new_team_user_tier {
            tracing::warn!("tried to update tier to the same tier");
            return Ok(());
        }

        let subscription = stripe::Subscription::retrieve(&self.client, subscription_id, &[])
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;

        if subscription.status != stripe::SubscriptionStatus::Active {
            return Err(CustomerError::SubscriptionNotActive);
        }

        let old_price_id = self.stripe_price_ids.price_id_for_tier(&old_team_user_tier);
        let new_price_id = self.stripe_price_ids.price_id_for_tier(&new_team_user_tier);

        // Find old tier line item — must exist
        let old_item = subscription
            .items
            .data
            .iter()
            .find(|item| {
                item.price
                    .as_ref()
                    .map(|p| p.id == old_price_id)
                    .unwrap_or(false)
            })
            .ok_or_else(|| {
                CustomerError::StorageLayerError(anyhow::anyhow!(
                    "No subscription item found for old tier {:?}",
                    old_team_user_tier
                ))
            })?;

        let old_quantity = old_item.quantity.unwrap_or(1);

        // Find new tier line item — may or may not exist
        let new_item = subscription.items.data.iter().find(|item| {
            item.price
                .as_ref()
                .map(|p| p.id == new_price_id)
                .unwrap_or(false)
        });

        let mut items = Vec::with_capacity(2);

        // Old tier: delete if last seat, otherwise decrement
        if old_quantity <= 1 {
            items.push(stripe::UpdateSubscriptionItems {
                id: Some(old_item.id.to_string()),
                deleted: Some(true),
                ..Default::default()
            });
        } else {
            items.push(stripe::UpdateSubscriptionItems {
                id: Some(old_item.id.to_string()),
                quantity: Some(old_quantity - 1),
                ..Default::default()
            });
        }

        // New tier: increment if exists, otherwise create with quantity 1
        match new_item {
            Some(item) => {
                let current_quantity = item.quantity.unwrap_or(1);
                items.push(stripe::UpdateSubscriptionItems {
                    id: Some(item.id.to_string()),
                    quantity: Some(current_quantity + 1),
                    ..Default::default()
                });
            }
            None => {
                items.push(stripe::UpdateSubscriptionItems {
                    price: Some(new_price_id.to_string()),
                    quantity: Some(1),
                    ..Default::default()
                });
            }
        }

        // Single atomic update — one prorated invoice for both changes
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
