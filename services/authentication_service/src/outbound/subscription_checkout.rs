//! Checkout persistence and Stripe wire-format adapter.

use std::sync::Arc;

use gtm_invite::domain::{models::GtmInviteError, ports::GtmInviteService};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use teams::domain::model::{CustomerError, SeatPrices};
use thiserror::Error;

use crate::service::subscription_checkout::{
    CheckoutGateway, CheckoutRequest, CheckoutTerms, ONBOARDING_TRIAL_DAYS, SubscriptionHistory,
};

const TRIAL_SESSION_MARKER: &str = "onboarding_trial";

enum TrialSessionAttempt {
    Reuse(String),
    Create(String),
}

#[cfg(test)]
mod test;

/// Provider and persistence errors retained for logging at the HTTP boundary.
#[derive(Debug, Error)]
pub enum StripeCheckoutError {
    /// Customer lookup failed.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    /// Stripe rejected or could not process the request.
    #[error(transparent)]
    Stripe(#[from] stripe::StripeError),
    /// Persisted customer identity was malformed.
    #[error(transparent)]
    CustomerId(#[from] stripe::ParseIdError),
    /// The invite domain could not read an offer.
    #[error(transparent)]
    Invite(#[from] GtmInviteError),
    /// A configured price is unavailable.
    #[error(transparent)]
    Price(#[from] CustomerError),
    /// Stripe returned an invalid URL.
    #[error(transparent)]
    Url(#[from] url::ParseError),
    /// Stripe omitted data needed to complete the operation safely.
    #[error("Unexpected Stripe response")]
    UnexpectedResponse,
}

/// Concrete capabilities composed at authentication-service startup.
pub struct StripeCheckoutGateway<I> {
    db: PgPool,
    stripe: Arc<stripe::Client>,
    invites: Arc<I>,
    prices: SeatPrices,
}

impl<I> StripeCheckoutGateway<I> {
    /// Bind existing customer storage, invite service, prices, and Stripe client.
    pub fn new(
        db: PgPool,
        stripe: Arc<stripe::Client>,
        invites: Arc<I>,
        prices: SeatPrices,
    ) -> Self {
        Self {
            db,
            stripe,
            invites,
            prices,
        }
    }

    // Reuse an open attempt. Anchor Stripe's idempotency key to the previous
    // expired attempt so concurrent tabs cannot stockpile usable trial links,
    // while an abandoned/expired checkout remains retryable.
    async fn trial_attempt(
        &self,
        customer: &stripe::CustomerId,
        request: &CheckoutRequest<'_>,
    ) -> Result<TrialSessionAttempt, StripeCheckoutError> {
        let mut params = stripe::ListCheckoutSessions::new();
        params.customer = Some(customer.clone());
        params.limit = Some(100);
        loop {
            let page = stripe::CheckoutSession::list(&self.stripe, &params).await?;
            if let Some(session) = page.data.iter().find(|session| {
                session
                    .metadata
                    .as_ref()
                    .is_some_and(|metadata| metadata.contains_key(TRIAL_SESSION_MARKER))
            }) {
                return match session.status {
                    Some(stripe::CheckoutSessionStatus::Open)
                        if trial_session_matches(session, request) =>
                    {
                        Ok(TrialSessionAttempt::Reuse(
                            session
                                .url
                                .clone()
                                .ok_or(StripeCheckoutError::UnexpectedResponse)?,
                        ))
                    }
                    Some(stripe::CheckoutSessionStatus::Open) => {
                        // A changed team or return destination needs fresh metadata.
                        stripe::CheckoutSession::expire(&self.stripe, &session.id).await?;
                        Ok(TrialSessionAttempt::Create(format!(
                            "onboarding-trial-{customer}-after-{}",
                            session.id
                        )))
                    }
                    Some(stripe::CheckoutSessionStatus::Expired) => {
                        Ok(TrialSessionAttempt::Create(format!(
                            "onboarding-trial-{customer}-after-{}",
                            session.id
                        )))
                    }
                    // The customer finished checkout between history lookup and
                    // this read. Do not create a second subscription in that race.
                    _ => Err(StripeCheckoutError::UnexpectedResponse),
                };
            }
            if !page.has_more {
                break;
            }
            params.starting_after = Some(
                page.data
                    .last()
                    .ok_or(StripeCheckoutError::UnexpectedResponse)?
                    .id
                    .clone(),
            );
        }
        Ok(TrialSessionAttempt::Create(format!(
            "onboarding-trial-{customer}-first"
        )))
    }
}

impl<I: GtmInviteService> CheckoutGateway for StripeCheckoutGateway<I> {
    type Customer = stripe::CustomerId;
    type Promotion = stripe::PromotionCodeId;
    type Error = StripeCheckoutError;

    async fn customer(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> Result<Option<Self::Customer>, Self::Error> {
        macro_db_client::user::get::get_stripe_customer_id_by_user_id(&self.db, user)
            .await?
            .map(|id| id.parse().map_err(StripeCheckoutError::from))
            .transpose()
    }

    async fn history(&self, customer: &Self::Customer) -> Result<SubscriptionHistory, Self::Error> {
        subscription_history(&self.stripe, customer).await
    }

    async fn invite_promotion(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> Result<Option<String>, Self::Error> {
        Ok(self
            .invites
            .active_offer_for_user(user)
            .await?
            .map(|link| link.promo_code.to_string()))
    }

    async fn promotion(&self, code: &str) -> Result<Option<Self::Promotion>, Self::Error> {
        let mut params = stripe::ListPromotionCodes::new();
        params.code = Some(code);
        params.active = Some(true);
        params.limit = Some(1);
        Ok(stripe::PromotionCode::list(&self.stripe, &params)
            .await?
            .data
            .into_iter()
            .next()
            .map(|promo| promo.id))
    }

    async fn create_session(
        &self,
        customer: Self::Customer,
        request: CheckoutRequest<'_>,
        terms: CheckoutTerms,
        promotion: Option<Self::Promotion>,
    ) -> Result<String, Self::Error> {
        let stripe = match terms {
            CheckoutTerms::Paid => self.stripe.as_ref().clone(),
            CheckoutTerms::Trial => match self.trial_attempt(&customer, &request).await? {
                TrialSessionAttempt::Reuse(url) => {
                    url::Url::parse(&url)?;
                    return Ok(url);
                }
                TrialSessionAttempt::Create(key) => self
                    .stripe
                    .as_ref()
                    .clone()
                    .with_strategy(stripe::RequestStrategy::Idempotent(key)),
            },
        };
        let params = checkout_params(
            customer,
            &request,
            self.prices.price_id(request.plan)?,
            terms,
            promotion,
        );
        let session = stripe::CheckoutSession::create(&stripe, params).await?;
        let url = session.url.ok_or(StripeCheckoutError::UnexpectedResponse)?;
        // Preserve the exact signed/opaque URL returned by Stripe.
        url::Url::parse(&url)?;
        Ok(url)
    }
}

fn checkout_params<'a>(
    customer: stripe::CustomerId,
    request: &'a CheckoutRequest<'_>,
    price: &str,
    terms: CheckoutTerms,
    promotion: Option<stripe::PromotionCodeId>,
) -> stripe::CreateCheckoutSession<'a> {
    let trial = terms == CheckoutTerms::Trial;
    stripe::CreateCheckoutSession {
        customer: Some(customer),
        mode: Some(stripe::CheckoutSessionMode::Subscription),
        success_url: Some(&request.success_url),
        cancel_url: Some(&request.cancel_url),
        payment_method_collection: Some(stripe::CheckoutSessionPaymentMethodCollection::Always),
        metadata: trial.then(|| {
            let mut metadata = request.metadata.clone();
            metadata.insert(
                TRIAL_SESSION_MARKER.to_owned(),
                ONBOARDING_TRIAL_DAYS.to_string(),
            );
            metadata
        }),
        allow_promotion_codes: (!trial && promotion.is_none()).then_some(true),
        discounts: promotion.map(|id| {
            vec![stripe::CreateCheckoutSessionDiscounts {
                promotion_code: Some(id.to_string()),
                ..Default::default()
            }]
        }),
        line_items: Some(vec![stripe::CreateCheckoutSessionLineItems {
            price: Some(price.to_owned()),
            quantity: Some(1),
            ..Default::default()
        }]),
        subscription_data: Some(stripe::CreateCheckoutSessionSubscriptionData {
            metadata: (!request.metadata.is_empty()).then(|| request.metadata.clone()),
            trial_period_days: trial.then_some(u32::from(ONBOARDING_TRIAL_DAYS)),
            ..Default::default()
        }),
        ..Default::default()
    }
}

fn trial_session_matches(session: &stripe::CheckoutSession, request: &CheckoutRequest<'_>) -> bool {
    session.success_url.as_deref() == Some(request.success_url.as_str())
        && session.cancel_url.as_deref() == Some(request.cancel_url.as_str())
        && ["team_id", "owner_id"].iter().all(|key| {
            session
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.get(*key))
                == request.metadata.get(*key)
        })
}

async fn subscription_history(
    stripe_client: &stripe::Client,
    customer: &stripe::CustomerId,
) -> Result<SubscriptionHistory, StripeCheckoutError> {
    let mut params = stripe::ListSubscriptions::new();
    params.customer = Some(customer.clone());
    params.status = Some(stripe::SubscriptionStatusFilter::All);
    params.limit = Some(100);
    let mut history = SubscriptionHistory::default();
    loop {
        let page = stripe::Subscription::list(stripe_client, &params).await?;
        history.has_previous_subscription |= !page.data.is_empty();
        history.has_active_subscription |= page.data.iter().any(|sub| {
            matches!(
                sub.status,
                stripe::SubscriptionStatus::Active | stripe::SubscriptionStatus::Trialing
            )
        });
        if !page.has_more {
            break;
        }
        params.starting_after = Some(
            page.data
                .last()
                .ok_or(StripeCheckoutError::UnexpectedResponse)?
                .id
                .clone(),
        );
    }
    Ok(history)
}
