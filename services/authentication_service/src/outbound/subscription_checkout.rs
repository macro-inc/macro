//! Checkout persistence and Stripe wire-format adapter.

use std::sync::Arc;

use gtm_invite::domain::{models::GtmInviteError, ports::GtmInviteService};
use macro_user_id::user_id::MacroUserIdStr;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use teams::domain::model::{CustomerError, SeatPrices};
use thiserror::Error;
use tracing::Instrument;

use crate::service::subscription_checkout::{
    CheckoutGateway, CheckoutRequest, CheckoutTerms, ONBOARDING_TRIAL_DAYS, SubscriptionHistory,
};

const TRIAL_SESSION_MARKER: &str = "onboarding_trial";

enum SessionAttempt {
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
    /// Checkout terms could not be serialized.
    #[error(transparent)]
    Serialization(#[from] serde_json::Error),
    /// A subscription completed while checkout was being prepared.
    #[error("You already have a subscription. Open Manage in Settings → Billing to update it.")]
    ExistingSubscription,
    /// Subscription history changed after the introductory offer was approved.
    #[error("The 30-day trial is only available for your first Premium subscription")]
    TrialUnavailable,
    /// Another request is preparing different checkout terms.
    #[error("Checkout changed in another tab. Please try again.")]
    CheckoutConflict,
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

    // One generation key is shared across all plans and terms. Stripe atomically
    // replays identical creates and rejects competing parameters. Advance only
    // after every older payable link has been conclusively invalidated.
    #[tracing::instrument(name = "billing.checkout.prepare", skip_all, fields(stripe_customer_id = %customer, ?terms), err)]
    async fn session_attempt(
        &self,
        customer: &stripe::CustomerId,
        fingerprint: &str,
        terms: CheckoutTerms,
    ) -> Result<SessionAttempt, StripeCheckoutError> {
        let mut params = stripe::ListCheckoutSessions::new();
        params.customer = Some(customer.clone());
        params.limit = Some(100);
        let mut sessions = Vec::new();
        loop {
            let page = stripe::CheckoutSession::list(&self.stripe, &params)
                .instrument(tracing::info_span!("stripe.checkout.list"))
                .await?;
            let next = page.data.last().map(|session| session.id.clone());
            sessions.extend(
                page.data
                    .into_iter()
                    .filter(|session| session.mode == stripe::CheckoutSessionMode::Subscription),
            );
            if !page.has_more {
                break;
            }
            params.starting_after = Some(next.ok_or(StripeCheckoutError::UnexpectedResponse)?);
        }
        let mut reusable = None;
        for session in &sessions {
            match session.status {
                Some(stripe::CheckoutSessionStatus::Open) => {
                    if reusable.is_none()
                        && session
                            .metadata
                            .as_ref()
                            .and_then(|m| m.get("checkout_terms"))
                            .is_some_and(|value| value == fingerprint)
                    {
                        tracing::info!(checkout_session_id = %session.id, outcome = "reuse", "matched checkout offer");
                        reusable = Some(
                            session
                                .url
                                .clone()
                                .ok_or(StripeCheckoutError::UnexpectedResponse)?,
                        );
                    } else {
                        // A failure may mean completion raced expiration. Never create
                        // or return another payable link after an ambiguous expiration.
                        let expired =
                            stripe::CheckoutSession::expire(&self.stripe, &session.id)
                            .instrument(tracing::info_span!("stripe.checkout.expire", checkout_session_id = %session.id))
                            .await?;
                        if expired.status != Some(stripe::CheckoutSessionStatus::Expired) {
                            return Err(StripeCheckoutError::UnexpectedResponse);
                        }
                    }
                }
                Some(stripe::CheckoutSessionStatus::Complete)
                    if sessions
                        .first()
                        .is_some_and(|latest| latest.id == session.id) =>
                {
                    // A list/history race must not turn a completed checkout into
                    // permission to subscribe again. Read its subscription directly.
                    let subscription = session
                        .subscription
                        .as_ref()
                        .ok_or(StripeCheckoutError::UnexpectedResponse)?;
                    let subscription =
                        stripe::Subscription::retrieve(&self.stripe, &subscription.id(), &[])
                            .instrument(tracing::info_span!("stripe.subscription.retrieve", subscription_id = %subscription.id()))
                            .await?;
                    if !subscription_terminal(subscription.status) {
                        return Err(StripeCheckoutError::ExistingSubscription);
                    }
                }
                Some(
                    stripe::CheckoutSessionStatus::Expired
                    | stripe::CheckoutSessionStatus::Complete,
                ) => {}
                None => return Err(StripeCheckoutError::UnexpectedResponse),
            }
        }
        let history = subscription_history(&self.stripe, customer).await?;
        if history.has_existing_subscription {
            return Err(StripeCheckoutError::ExistingSubscription);
        }
        if terms == CheckoutTerms::Trial && !history.trial_eligible() {
            return Err(StripeCheckoutError::TrialUnavailable);
        }
        if let Some(url) = reusable {
            return Ok(SessionAttempt::Reuse(url));
        }
        Ok(SessionAttempt::Create(match sessions.first() {
            Some(session) => format!("subscription-checkout-{customer}-after-{}", session.id),
            None => format!("subscription-checkout-{customer}-first"),
        }))
    }

    #[tracing::instrument(name = "billing.checkout", skip_all, fields(stripe_customer_id = %customer, ?terms), err)]
    async fn checkout(
        &self,
        customer: stripe::CustomerId,
        request: CheckoutRequest<'_>,
        terms: CheckoutTerms,
        promotion: Option<stripe::PromotionCodeId>,
    ) -> Result<String, StripeCheckoutError> {
        let mut params = checkout_params(
            customer.clone(),
            &request,
            self.prices.price_id(request.plan)?,
            terms,
            promotion,
        );
        // Sort nested metadata too: HashMap iteration order changes between requests.
        let mut payload = serde_json::to_value(&params)?;
        payload.sort_all_objects();
        let payload = serde_json::to_vec(&payload)?;
        let fingerprint = format!("{:x}", Sha256::digest(payload));
        params
            .metadata
            .get_or_insert_default()
            .insert("checkout_terms".into(), fingerprint.clone());
        let key = match self.session_attempt(&customer, &fingerprint, terms).await? {
            SessionAttempt::Reuse(url) => {
                url::Url::parse(&url)?;
                return Ok(url);
            }
            SessionAttempt::Create(key) => key,
        };
        tracing::info!(idempotency_key = %key, outcome = "create", "creating checkout offer");
        let stripe = self
            .stripe
            .as_ref()
            .clone()
            .with_strategy(stripe::RequestStrategy::Idempotent(key));
        let session = stripe::CheckoutSession::create(&stripe, params)
            .instrument(tracing::info_span!("stripe.checkout.create"))
            .await
            .map_err(|error| match &error {
                stripe::StripeError::Stripe(error)
                    if error.http_status == 409
                        || error.error_type == stripe::ErrorType::IdempotencyError =>
                {
                    StripeCheckoutError::CheckoutConflict
                }
                _ => StripeCheckoutError::Stripe(error),
            })?;
        // An idempotency replay contains the original response, even if another
        // tab has since expired that session. Never redirect to that stale URL.
        let session = stripe::CheckoutSession::retrieve(&self.stripe, &session.id, &[])
            .instrument(
                tracing::info_span!("stripe.checkout.retrieve", checkout_session_id = %session.id),
            )
            .await?;
        if session.status != Some(stripe::CheckoutSessionStatus::Open) {
            return Err(StripeCheckoutError::CheckoutConflict);
        }
        let url = session.url.ok_or(StripeCheckoutError::UnexpectedResponse)?;
        url::Url::parse(&url)?;
        Ok(url)
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
        self.checkout(customer, request, terms, promotion).await
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

fn subscription_terminal(status: stripe::SubscriptionStatus) -> bool {
    matches!(
        status,
        stripe::SubscriptionStatus::Canceled | stripe::SubscriptionStatus::IncompleteExpired
    )
}

#[tracing::instrument(skip_all, fields(stripe_customer_id = %customer), err, ret)]
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
        history.has_existing_subscription |= page
            .data
            .iter()
            .any(|sub| !subscription_terminal(sub.status));
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
