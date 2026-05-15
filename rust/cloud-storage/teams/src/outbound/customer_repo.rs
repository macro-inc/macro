//! Implementation for CustomerRepository using Stripe.

use std::{collections::HashMap, sync::Arc};

use stripe::{CreateSubscription, CreateSubscriptionItems, UpdateSubscription};

use crate::domain::{
    customer_repo::CustomerRepository,
    model::{CreateSubscriptionArgs, CustomerError, TeamPlan},
};

/// The stripe price ids for all tiers
/// These are legacy stripe price ids for the old tier system
#[derive(Clone)]
pub struct LegacyStripePriceIds {
    /// haiku tier price id
    pub haiku: String,
    /// sonnet tier price id
    pub sonnet: String,
    /// opus tier price id
    pub opus: String,
}

/// Team plan stripe price ids
/// Note: there is not `growth` plan price id as growth plan is white glove.
#[derive(Clone)]
pub struct TeamStripePriceIds {
    /// The idea price id
    pub idea: String,
    /// The pre-seed price id
    pub pre_seed: String,
    /// The seed price id
    pub seed: String,
    /// The series-a price id
    pub series_a: String,
}

impl TeamStripePriceIds {
    /// Tries to map the stripe price id for a team plan
    fn try_get_price_id_for_team_plan(&self, value: TeamPlan) -> Result<String, CustomerError> {
        let price_id = match value {
            TeamPlan::Idea => self.idea.clone(),
            TeamPlan::PreSeed => self.pre_seed.clone(),
            TeamPlan::Seed => self.seed.clone(),
            TeamPlan::SeriesA => self.series_a.clone(),
            TeamPlan::Growth => return Err(anyhow::anyhow!("no price id for growth plan").into()),
        };

        Ok(price_id)
    }
}

/// The CustomerRepositoryImpl struct is a wrapper around a stripe::Client connected to stripe.
#[derive(Clone)]
pub struct CustomerRepositoryImpl {
    /// The underlying stripe::Client connected to stripe.
    client: Arc<stripe::Client>,
    /// The team plan stripe price ids
    team_plan_stripe_price_ids: TeamStripePriceIds,
    /// The legacy stripe price ids
    legacy_stripe_price_ids: LegacyStripePriceIds,
}

impl CustomerRepositoryImpl {
    /// Creates a new instance of CustomerRepositoryImpl
    pub fn new(
        stripe_client: stripe::Client,
        team_plan_stripe_price_ids: TeamStripePriceIds,
        legacy_stripe_price_ids: LegacyStripePriceIds,
    ) -> Self {
        Self {
            client: Arc::new(stripe_client),
            team_plan_stripe_price_ids,
            legacy_stripe_price_ids,
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
            price: Some(self.legacy_stripe_price_ids.haiku.clone()),
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

    #[tracing::instrument(skip(self), err)]
    async fn update_team_plan(
        &self,
        subscription_id: &stripe::SubscriptionId,
        current_plan: Option<TeamPlan>,
        team_plan: TeamPlan,
    ) -> Result<(), CustomerError> {
        // Get new plan price id
        let new_plan_price_id = self
            .team_plan_stripe_price_ids
            .try_get_price_id_for_team_plan(team_plan)?;

        let subscription = stripe::Subscription::retrieve(&self.client, subscription_id, &[])
            .await
            .map_err(|e| CustomerError::StorageLayerError(e.into()))?;

        if subscription.status != stripe::SubscriptionStatus::Active {
            return Err(CustomerError::SubscriptionNotActive);
        }

        let mut items = Vec::with_capacity(2);

        if let Some(current_team_plan) = current_plan {
            let old_plan_price_id = self
                .team_plan_stripe_price_ids
                .try_get_price_id_for_team_plan(current_team_plan)?;

            // The old item must exist
            let old_item = subscription
                .items
                .data
                .iter()
                .find(|item| {
                    item.price
                        .as_ref()
                        .map(|p| p.id == old_plan_price_id)
                        .unwrap_or(false)
                })
                .ok_or_else(|| {
                    CustomerError::StorageLayerError(anyhow::anyhow!(
                        "No subscription item found for old tier {:?}",
                        current_team_plan
                    ))
                })?;

            // delete the current price id
            items.push(stripe::UpdateSubscriptionItems {
                id: Some(old_item.id.to_string()),
                deleted: Some(true),
                ..Default::default()
            });
        }

        // Add the new item
        items.push(stripe::UpdateSubscriptionItems {
            price: Some(new_plan_price_id.to_string()),
            quantity: Some(1),
            ..Default::default()
        });

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
