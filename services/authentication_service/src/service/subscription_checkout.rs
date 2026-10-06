//! Subscription checkout policy, independent of HTTP and the payment provider.

use std::{collections::HashMap, future::Future};

use macro_user_id::user_id::MacroUserIdStr;
use teams::domain::model::SeatPlan;
use thiserror::Error;

#[cfg(test)]
mod test;

/// The introductory offer is granted by the server, never supplied as a duration by clients.
pub const ONBOARDING_TRIAL_DAYS: u8 = 30;

/// Facts across the customer's entire subscription history, including canceled subscriptions.
#[derive(Debug, Default, Clone, Copy)]
pub struct SubscriptionHistory {
    /// An active subscription already owns the customer's paid access.
    pub has_active_subscription: bool,
    /// Any previous subscription makes the customer ineligible for an introductory trial.
    pub has_previous_subscription: bool,
}

/// Authenticated purchase intent; the caller cannot choose a customer or price ID.
pub struct CheckoutRequest<'a> {
    /// Identity established by the authentication boundary.
    pub user_id: MacroUserIdStr<'a>,
    /// Requested seat plan.
    pub plan: SeatPlan,
    /// Request the introductory Premium trial instead of immediate billing.
    pub onboarding_trial: bool,
    /// Return destination after successful checkout.
    pub success_url: String,
    /// Return destination after cancellation.
    pub cancel_url: String,
    /// Optional promotion for a standard paid checkout.
    pub discount: Option<String>,
    /// Team ownership and attribution supplied by the authenticated boundary.
    pub metadata: HashMap<String, String>,
}

/// Billing terms approved by the service.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckoutTerms {
    /// Charge the configured plan price immediately.
    Paid,
    /// Collect a payment method now and begin billing after the introductory period.
    Trial,
}

/// Confirms the granted terms as well as the hosted destination.
pub struct CheckoutResult {
    /// Opaque hosted checkout URL.
    pub url: String,
    /// The trial duration actually granted by the server.
    pub trial_days: Option<u8>,
}

/// Errors that callers can distinguish without understanding the provider.
#[derive(Debug, Error)]
pub enum CheckoutError<E> {
    /// The account has no billing customer.
    #[error("User does not have a stripe id")]
    MissingCustomer,
    /// A second subscription must not be created.
    #[error("User already has an active subscription")]
    AlreadySubscribed,
    /// Never silently replace an advertised trial with an immediate charge.
    #[error("The 30-day trial is only available for your first Premium subscription")]
    TrialUnavailable,
    /// The requested plan is not currently sold.
    #[error("This plan is not available yet")]
    PlanUnavailable,
    /// An explicitly supplied promotion must be valid.
    #[error("Invalid promo code")]
    PromoCodeNotFound,
    /// Persistence or provider failure, preserving its original type and cause.
    #[error(transparent)]
    Gateway(E),
}

/// Billing capabilities used by the checkout service. Provider IDs stay opaque.
pub trait CheckoutGateway: Send + Sync {
    /// Validated provider customer identity.
    type Customer: Send + Sync;
    /// Validated provider promotion identity.
    type Promotion: Send + Sync;
    /// Adapter error retaining the original failure.
    type Error: std::error::Error + Send + Sync + 'static;

    /// Resolve the authenticated account's billing customer.
    fn customer(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<Self::Customer>, Self::Error>> + Send;
    /// Include every page and every subscription status.
    fn history(
        &self,
        customer: &Self::Customer,
    ) -> impl Future<Output = Result<SubscriptionHistory, Self::Error>> + Send;
    /// Read the offer already granted by the invite domain.
    fn invite_promotion(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<String>, Self::Error>> + Send;
    /// Resolve an active promotion code.
    fn promotion(
        &self,
        code: &str,
    ) -> impl Future<Output = Result<Option<Self::Promotion>, Self::Error>> + Send;
    /// Create a checkout with exactly the approved terms and optional promotion.
    fn create_session(
        &self,
        customer: Self::Customer,
        request: CheckoutRequest<'_>,
        terms: CheckoutTerms,
        promotion: Option<Self::Promotion>,
    ) -> impl Future<Output = Result<String, Self::Error>> + Send;
}

/// Orchestrates eligibility, existing invite offers, and provider checkout creation.
pub struct CheckoutService<G> {
    gateway: G,
}

impl<G: CheckoutGateway> CheckoutService<G> {
    /// Compose a service with its billing adapter.
    pub fn new(gateway: G) -> Self {
        Self { gateway }
    }

    /// Create a paid checkout or a code-free first-subscription trial.
    pub async fn create(
        &self,
        request: CheckoutRequest<'_>,
    ) -> Result<CheckoutResult, CheckoutError<G::Error>> {
        if !SeatPlan::PURCHASABLE.contains(&request.plan) {
            return Err(CheckoutError::PlanUnavailable);
        }
        let customer = self
            .gateway
            .customer(&request.user_id)
            .await
            .map_err(CheckoutError::Gateway)?
            .ok_or(CheckoutError::MissingCustomer)?;
        let history = self
            .gateway
            .history(&customer)
            .await
            .map_err(CheckoutError::Gateway)?;
        if history.has_active_subscription {
            return Err(CheckoutError::AlreadySubscribed);
        }
        let terms = if request.onboarding_trial {
            if request.plan != SeatPlan::Premium || history.has_previous_subscription {
                return Err(CheckoutError::TrialUnavailable);
            }
            CheckoutTerms::Trial
        } else {
            CheckoutTerms::Paid
        };

        // The introductory trial is automatic and does not stack with discount codes.
        // Preserve existing invite/explicit-promotion behavior for standard purchases.
        let promotion = if terms == CheckoutTerms::Trial {
            None
        } else if let Some(code) = request.discount.as_deref() {
            Some(
                self.gateway
                    .promotion(code)
                    .await
                    .map_err(CheckoutError::Gateway)?
                    .ok_or(CheckoutError::PromoCodeNotFound)?,
            )
        } else {
            self.invite_promotion(&request.user_id).await
        };
        let url = self
            .gateway
            .create_session(customer, request, terms, promotion)
            .await
            .map_err(CheckoutError::Gateway)?;
        Ok(CheckoutResult {
            url,
            trial_days: (terms == CheckoutTerms::Trial).then_some(ONBOARDING_TRIAL_DAYS),
        })
    }

    async fn invite_promotion(&self, user: &MacroUserIdStr<'_>) -> Option<G::Promotion> {
        let offer = async {
            match self.gateway.invite_promotion(user).await? {
                Some(code) => self.gateway.promotion(&code).await,
                None => Ok(None),
            }
        }
        .await;
        match offer {
            Ok(promotion) => promotion,
            Err(error) => {
                tracing::error!(error=?error, "failed to apply optional invite promotion");
                None
            }
        }
    }
}
