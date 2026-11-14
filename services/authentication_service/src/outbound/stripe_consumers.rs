//! Carries out the Stripe inbox consumers' decisions
//! (`crate::domain::stripe_consumers`) through the owning domains. Every
//! step is safe to repeat: the inbox advances a consumer's cursor only after
//! its apply succeeds, so a failure re-runs the whole apply.

use std::collections::HashMap;
use std::sync::Arc;

use ai_billing::BillingService;
use ai_billing::outbound::stripe_gateway::{
    PAYER_METADATA_KEY, PURPOSE_AI_CREDIT_RELOAD, PURPOSE_AI_CREDITS, PURPOSE_AI_OVERAGE,
    PURPOSE_METADATA_KEY, RELOAD_METADATA_KEY,
};
use analytics_client::{AnalyticsClient, MetaActionSource, MetaUserData};
use gtm_invite::domain::ports::GtmInviteService;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use roles_and_permissions::domain::model::SubscriptionStatus as RoleStatus;
use roles_and_permissions::domain::port::UserRolesAndPermissionsService;
use serde::Serialize;
use stripe::{CustomerId, EventId, SubscriptionStatus};
use stripe_inbox::domain::customers::StripeCustomers;
use stripe_inbox::domain::model::{
    ApplyError, BillingInboxEvent, CheckoutFacts, Consumer, Delivery, InvoiceFacts,
    SubscriptionChange, SubscriptionFacts,
};
use stripe_inbox::domain::ports::{EventConsumers, InboxRepo, StripeReader};
use teams::domain::model::{SeatPrices, TeamError};
use teams::domain::team_repo::TeamService;

use crate::domain::computer_billing::ComputerBillingObserver;
use crate::domain::stripe_consumers::{
    Conversion, PersonalAccess, PersonalDecision, PersonalUpdate, TeamBinding, TeamState,
    TeamUpdate, UnknownPrice, analytics_conversion, decide_personal_invoice,
    decide_personal_subscription, decide_team_binding, decide_team_invoice,
    decide_team_subscription,
};
use crate::outbound::stripe_identity::PgStripeIdentity;

#[cfg(test)]
mod test;

/// The authentication service's inbox consumers.
pub struct StripeConsumers<Roles, Teams, Billing, Gtm, Repo, Reader> {
    pub prices: SeatPrices,
    pub identity: PgStripeIdentity,
    pub customers: StripeCustomers<Repo, Reader>,
    pub roles: Arc<Roles>,
    pub teams: Arc<Teams>,
    pub billing: Arc<Billing>,
    pub computers: Arc<dyn ComputerBillingObserver>,
    pub gtm: Arc<Gtm>,
    pub analytics: Arc<AnalyticsClient>,
    pub stripe: Arc<stripe::Client>,
}

fn retry(error: impl std::fmt::Debug) -> ApplyError {
    ApplyError::Retry(rootcause::report!("{error:?}").into_dynamic())
}

fn reject(error: UnknownPrice) -> ApplyError {
    ApplyError::Reject(rootcause::Report::new(error).into_dynamic())
}

/// The Stripe idempotency key for one write of one consumer's apply.
fn idempotency_key(consumer: Consumer, event_id: &EventId, action: &str) -> String {
    format!("{consumer}:{event_id}:{action}")
}

impl<Roles, Teams, Billing, Gtm, Repo, Reader> EventConsumers
    for StripeConsumers<Roles, Teams, Billing, Gtm, Repo, Reader>
where
    Roles: UserRolesAndPermissionsService,
    Teams: TeamService,
    Billing: BillingService,
    Gtm: GtmInviteService,
    Repo: InboxRepo,
    Reader: StripeReader,
{
    async fn apply(&self, consumer: Consumer, delivery: &Delivery) -> Result<(), ApplyError> {
        match (consumer, &delivery.event) {
            (
                Consumer::AiCredits,
                BillingInboxEvent::Invoice {
                    invoice,
                    subscription: None,
                },
            ) => self.ai_credit_invoice(invoice).await,
            (Consumer::AiCredits, BillingInboxEvent::Checkout(checkout)) => {
                self.credit_checkout(checkout).await
            }
            (Consumer::AiCredits, _) => Ok(()),
            (_, BillingInboxEvent::Checkout(_)) => Ok(()),
            (
                _,
                BillingInboxEvent::Invoice {
                    subscription: None, ..
                },
            ) => Ok(()),
            (consumer, BillingInboxEvent::Subscription(change)) => {
                if self.customer_deleted(&change.subscription.customer).await? {
                    return Ok(());
                }
                match consumer {
                    Consumer::PersonalPlan => self.personal_subscription(delivery, change).await,
                    Consumer::TeamSubscription => self.team_subscription(delivery, change).await,
                    Consumer::Computers => self.computers(delivery, change).await,
                    Consumer::Analytics => self.analytics(delivery, change).await,
                    Consumer::Gtm => self.gtm(change).await,
                    Consumer::AiCredits => Ok(()),
                }
            }
            (
                consumer,
                BillingInboxEvent::Invoice {
                    invoice,
                    subscription: Some(subscription),
                },
            ) => {
                if self.customer_deleted(&subscription.customer).await? {
                    return Ok(());
                }
                match consumer {
                    Consumer::PersonalPlan => {
                        self.personal_invoice(delivery, invoice, subscription).await
                    }
                    Consumer::TeamSubscription => {
                        match decide_team_invoice(
                            &delivery.event_id,
                            delivery.created_at,
                            invoice,
                            subscription,
                        ) {
                            Some(update) => self.apply_team(&subscription.customer, update).await,
                            None => Ok(()),
                        }
                    }
                    Consumer::Computers
                    | Consumer::Analytics
                    | Consumer::Gtm
                    | Consumer::AiCredits => Ok(()),
                }
            }
        }
    }
}

impl<Roles, Teams, Billing, Gtm, Repo, Reader>
    StripeConsumers<Roles, Teams, Billing, Gtm, Repo, Reader>
where
    Roles: UserRolesAndPermissionsService,
    Teams: TeamService,
    Billing: BillingService,
    Gtm: GtmInviteService,
    Repo: InboxRepo,
    Reader: StripeReader,
{
    /// Whether Stripe deleted the customer; its subscriptions change
    /// nothing in Macro.
    async fn customer_deleted(&self, customer: &CustomerId) -> Result<bool, ApplyError> {
        Ok(self
            .customers
            .held(customer)
            .await?
            .is_some_and(|customer| customer.deleted))
    }

    /// The Macro account of a Stripe customer: by its stored customer id;
    /// only a customer no account names is read from Stripe once and matched
    /// by its email.
    async fn customer_user(
        &self,
        customer: &CustomerId,
    ) -> Result<Option<MacroUserIdStr<'static>>, ApplyError> {
        if let Some(user) = self
            .identity
            .user_for_customer(customer)
            .await
            .map_err(retry)?
        {
            return Ok(Some(user));
        }
        let facts = self.customers.fetch(customer).await?;
        let Some(user) = facts
            .email
            .and_then(|email| MacroUserIdStr::try_from_email(&email.to_lowercase()).ok())
            .map(|user| user.into_owned())
        else {
            return Ok(None);
        };
        if !self.identity.user_exists(&user).await.map_err(retry)? {
            return Ok(None);
        }
        tracing::warn!(
            customer_id = %customer,
            "stripe customer is not stored on any account; matched by its email"
        );
        Ok(Some(user))
    }

    /// The account a personal event applies to; none fails for good.
    async fn subscriber(
        &self,
        customer: &CustomerId,
    ) -> Result<MacroUserIdStr<'static>, ApplyError> {
        self.customer_user(customer).await?.ok_or_else(|| {
            ApplyError::Reject(
                rootcause::report!("stripe customer {customer} belongs to no account")
                    .into_dynamic(),
            )
        })
    }

    #[tracing::instrument(skip_all, fields(subscription_id = %change.subscription.id, decision), err)]
    async fn personal_subscription(
        &self,
        delivery: &Delivery,
        change: &SubscriptionChange,
    ) -> Result<(), ApplyError> {
        let decision = decide_personal_subscription(
            &delivery.event_id,
            delivery.created_at,
            change,
            &delivery.customer_subscriptions,
            &self.prices,
        )
        .map_err(reject)?;
        self.apply_personal(delivery, &change.subscription, decision)
            .await
    }

    #[tracing::instrument(skip_all, fields(subscription_id = %subscription.id, invoice_id = %invoice.id, decision), err)]
    async fn personal_invoice(
        &self,
        delivery: &Delivery,
        invoice: &InvoiceFacts,
        subscription: &SubscriptionFacts,
    ) -> Result<(), ApplyError> {
        let decision = decide_personal_invoice(
            &delivery.event_id,
            delivery.created_at,
            invoice,
            subscription,
            &delivery.customer_subscriptions,
            &self.prices,
        )
        .map_err(reject)?;
        self.apply_personal(delivery, subscription, decision).await
    }

    async fn apply_personal(
        &self,
        delivery: &Delivery,
        subscription: &SubscriptionFacts,
        decision: PersonalDecision,
    ) -> Result<(), ApplyError> {
        let span = tracing::Span::current();
        match decision {
            PersonalDecision::Ignore => {
                span.record("decision", "ignore");
                Ok(())
            }
            PersonalDecision::KeepAccess => {
                span.record("decision", "keep_access");
                Ok(())
            }
            PersonalDecision::CancelDuplicate => {
                span.record("decision", "cancel_duplicate");
                tracing::warn!("canceling a duplicate personal subscription; keeping the oldest");
                let client =
                    (*self.stripe)
                        .clone()
                        .with_strategy(stripe::RequestStrategy::Idempotent(idempotency_key(
                            Consumer::PersonalPlan,
                            &delivery.event_id,
                            "cancel_duplicate",
                        )));
                stripe::Subscription::cancel(
                    &client,
                    &subscription.id,
                    stripe::CancelSubscription::default(),
                )
                .await
                .map_err(retry)?;
                Ok(())
            }
            PersonalDecision::Apply(update) => {
                span.record("decision", "apply");
                let user = self.subscriber(&subscription.customer).await?;
                self.apply_personal_update(delivery, &subscription.customer, &user, update)
                    .await
            }
        }
    }

    async fn apply_personal_update(
        &self,
        delivery: &Delivery,
        customer: &CustomerId,
        user: &MacroUserIdStr<'_>,
        update: PersonalUpdate,
    ) -> Result<(), ApplyError> {
        if update.started_trial {
            self.identity.mark_has_trialed(user).await.map_err(retry)?;
            let client = (*self.stripe)
                .clone()
                .with_strategy(stripe::RequestStrategy::Idempotent(idempotency_key(
                    Consumer::PersonalPlan,
                    &delivery.event_id,
                    "has_trialed",
                )));
            let params = stripe::UpdateCustomer {
                metadata: Some(HashMap::from([(
                    "has_trialed".to_owned(),
                    "true".to_owned(),
                )])),
                ..stripe::UpdateCustomer::new()
            };
            stripe::Customer::update(&client, customer, params)
                .await
                .map_err(retry)?;
        }

        match update.access {
            PersonalAccess::Grant(tier) => self
                .roles
                .update_user_roles_and_permissions_for_subscription(user, RoleStatus::Active, tier)
                .await
                .map_err(retry)?,
            PersonalAccess::Revoke { status, tier } => self
                .roles
                .update_user_roles_and_permissions_for_subscription(user, status, tier)
                .await
                .map_err(retry)?,
        }
        self.sync_periods(user, update.period, update.verified)
            .await?;
        if let Some(change) = update.plan_change {
            self.billing
                .change_plan(user, change)
                .await
                .map_err(retry)?;
        }
        Ok(())
    }

    async fn sync_periods(
        &self,
        payer: &MacroUserIdStr<'_>,
        period: Option<ai_billing::domain::BillingPeriod>,
        verified: Vec<ai_billing::domain::period::SubscriptionPeriod>,
    ) -> Result<(), ApplyError> {
        if let Some(period) = period {
            self.billing
                .sync_period(payer, period.start, period.end, None)
                .await
                .map_err(retry)?;
        }
        for facts in verified {
            self.billing
                .sync_period(payer, facts.period.start, facts.period.end, Some(facts))
                .await
                .map_err(retry)?;
        }
        Ok(())
    }

    #[tracing::instrument(skip_all, fields(subscription_id = %change.subscription.id), err)]
    async fn team_subscription(
        &self,
        delivery: &Delivery,
        change: &SubscriptionChange,
    ) -> Result<(), ApplyError> {
        match decide_team_subscription(&delivery.event_id, delivery.created_at, change) {
            Some(update) => self.apply_team(&change.subscription.customer, update).await,
            None => Ok(()),
        }
    }

    #[tracing::instrument(
        skip_all,
        fields(team_id = %update.team_id, subscription_id = %update.subscription_id, paying = update.paying),
        err
    )]
    async fn apply_team(
        &self,
        customer: &CustomerId,
        update: TeamUpdate,
    ) -> Result<(), ApplyError> {
        if update.started_trial {
            let trialist = match self.customer_user(customer).await? {
                Some(user) => Some(user),
                None => update.owner.clone(),
            };
            if let Some(trialist) = trialist {
                self.identity
                    .mark_has_trialed(&trialist)
                    .await
                    .map_err(retry)?;
            }
        }

        // A team that moved to another subscription ignores the old one's
        // lapse, so a late cancel or failed invoice cannot revoke seats the
        // new subscription pays for.
        let team = match self.teams.team_subscription_id(&update.team_id).await {
            Ok(bound) => TeamState::Bound(bound),
            Err(TeamError::TeamDoesNotExist) => TeamState::Missing,
            Err(error) => return Err(retry(error)),
        };
        let replaced = match decide_team_binding(&update, team) {
            TeamBinding::TeamGone => {
                tracing::warn!(
                    team_id = %update.team_id,
                    subscription_id = %update.subscription_id,
                    "team no longer exists; ignoring its subscription event"
                );
                return Ok(());
            }
            TeamBinding::IgnoreLapse => {
                tracing::info!("team is on another subscription; ignoring this one's lapse");
                return Ok(());
            }
            TeamBinding::Apply { replaced } => replaced,
        };

        // The usage policy checks the team's subscription binding as it was
        // before this event, so it runs before the binding is patched. Its
        // failure must not hold back the team's access: the base work still
        // runs, then the apply fails and retries.
        let policy = match update.owner.as_ref() {
            Some(owner) => {
                self.sync_periods(owner, None, update.verified.clone())
                    .await
            }
            None => Ok(()),
        };

        self.teams
            .patch_team_subscription_id(&update.team_id, &update.subscription_id)
            .await
            .map_err(retry)?;
        if update.paying {
            // Restore stamps every member (owner included) with the team
            // subscriber role and the tier role of their own seat's plan.
            self.teams
                .restore_permissions_for_team_members(&update.team_id, update.start)
                .await
                .map_err(retry)?;
        } else {
            self.teams
                .revoke_permissions_for_team_members(&update.team_id)
                .await
                .map_err(retry)?;
        }
        match update.owner.as_ref() {
            Some(owner) => self.sync_periods(owner, update.period, Vec::new()).await?,
            None => tracing::warn!("team subscription without owner; skipping period sync"),
        }
        self.teams
            .patch_team_payment_status(&update.team_id, update.paying)
            .await
            .map_err(retry)?;

        // Before the patch, a replacement subscription's periods were
        // checked against the old binding and left unverified; verify them
        // now that the team is bound to it.
        let policy = match (policy, update.owner.as_ref()) {
            (Ok(()), Some(owner)) if replaced => {
                self.sync_periods(owner, None, update.verified).await
            }
            (policy, _) => policy,
        };
        policy.inspect_err(|error| {
            tracing::warn!(error = %error, "usage policy sync failed; base team work is done");
        })
    }

    /// Reports the team subscription to the computer billing owner, which
    /// decides per computer. `observed_at` is the snapshot's time, so a
    /// computer billed after it is left alone.
    #[tracing::instrument(skip_all, fields(subscription_id = %change.subscription.id), err)]
    async fn computers(
        &self,
        delivery: &Delivery,
        change: &SubscriptionChange,
    ) -> Result<(), ApplyError> {
        let subscription = &change.subscription;
        let Some(team_id) = subscription.team_id else {
            return Ok(());
        };
        if subscription.status == SubscriptionStatus::Incomplete {
            return Ok(());
        }
        let Some(period) = subscription.items.iter().find_map(|item| item.period) else {
            return Err(ApplyError::Reject(
                rootcause::report!("team subscription has no current period").into_dynamic(),
            ));
        };
        use hosted_runtimes::domain::service::{
            ObservedItem, SubscriptionObserved, SubscriptionStatus as Observed,
        };
        let status = match subscription.status {
            SubscriptionStatus::Active => Observed::Active,
            SubscriptionStatus::Trialing => Observed::Trialing,
            SubscriptionStatus::PastDue => Observed::PastDue,
            SubscriptionStatus::Unpaid => Observed::Unpaid,
            SubscriptionStatus::Paused => Observed::Paused,
            SubscriptionStatus::Incomplete => Observed::Incomplete,
            SubscriptionStatus::IncompleteExpired => Observed::IncompleteExpired,
            SubscriptionStatus::Canceled => Observed::Canceled,
        };
        let observed = SubscriptionObserved {
            status,
            items: subscription
                .items
                .iter()
                .map(|item| ObservedItem {
                    subscription_item: item.id.clone(),
                    computer_id: item
                        .computer_id
                        .map(hosted_runtimes::domain::ids::ComputerId::new_from_uuid),
                })
                .collect(),
            current_period_end: period.end,
            observed_at: delivery.created_at,
        };
        self.computers
            .subscription_observed(team_id, observed)
            .await
            .map_err(ApplyError::Retry)
    }

    #[tracing::instrument(skip_all, fields(subscription_id = %change.subscription.id, conversion), err)]
    async fn analytics(
        &self,
        delivery: &Delivery,
        change: &SubscriptionChange,
    ) -> Result<(), ApplyError> {
        let subscription = &change.subscription;
        let Some(conversion) = analytics_conversion(
            &delivery.event_id,
            delivery.created_at,
            change,
            &delivery.customer_subscriptions,
            &self.prices,
        ) else {
            return Ok(());
        };
        tracing::Span::current().record("conversion", format!("{conversion:?}"));
        let (Some(value_cents), Some(currency)) =
            (subscription.value_cents(), subscription.currency.clone())
        else {
            tracing::warn!("skipping analytics tracking: no value or currency");
            return Ok(());
        };
        let user = match self.customer_user(&subscription.customer).await? {
            Some(user) => Some(user),
            None => subscription.owner_id.clone(),
        };
        let Some(user) = user else {
            tracing::warn!("skipping analytics tracking: no account for the customer");
            return Ok(());
        };

        let event = SubscriptionEvent {
            transaction_id: subscription.id.to_string(),
            value: value_cents as f64 / 100.0,
            currency: currency.to_uppercase(),
        };
        let posthog_event = PostHogSubscriptionEvent {
            event: &event,
            team_id: subscription.team_id,
            groups: subscription.team_id.map(|team| PostHogTeamGroup { team }),
        };
        let user_data = MetaUserData {
            email: Some(user.email_str().to_owned()),
            fbp: subscription.attribution.fbp.clone(),
            fbc: subscription.attribution.fbc.clone(),
            ..MetaUserData::default()
        };
        // Meta and GA dedupe on the subscription id, so a retried apply
        // never counts twice.
        let event_id = Some(subscription.id.as_str());
        let (ga_event, meta_event, posthog_name) = match conversion {
            Conversion::Purchase => ("purchase", "Purchase", "subscription_created"),
            Conversion::Cancel => ("refund", "CancelSubscription", "subscription_canceled"),
        };
        if let Some(ga_client_id) = &subscription.attribution.ga_client_id {
            let _ = self
                .analytics
                .track_ga(ga_client_id, ga_event, &event)
                .await
                .inspect_err(
                    |error| tracing::warn!(error = ?error, "failed to track GA subscription event"),
                );
        }
        let _ = self
            .analytics
            .track_meta(
                meta_event,
                &user_data,
                MetaActionSource::Website,
                event_id,
                &event,
            )
            .await
            .inspect_err(
                |error| tracing::warn!(error = ?error, "failed to track Meta subscription event"),
            );
        let _ = self
            .analytics
            .track_posthog(user.as_ref(), posthog_name, &posthog_event)
            .await
            .inspect_err(|error| tracing::warn!(error = ?error, "failed to track PostHog subscription event"));
        Ok(())
    }

    /// An account that signed up through a GTM invite link converted the
    /// moment its subscription, personal or team, is live.
    #[tracing::instrument(skip_all, fields(subscription_id = %change.subscription.id, converted), err)]
    async fn gtm(&self, change: &SubscriptionChange) -> Result<(), ApplyError> {
        let subscription = &change.subscription;
        if !subscription.is_live() {
            return Ok(());
        }
        let user = match self.customer_user(&subscription.customer).await? {
            Some(user) => Some(user),
            None => subscription.owner_id.clone(),
        };
        let Some(user) = user else {
            return Ok(());
        };
        let converted = self
            .gtm
            .mark_converted(&user, subscription.id.as_str())
            .await
            .map_err(retry)?;
        tracing::Span::current().record("converted", converted);
        Ok(())
    }

    /// Macro's own one-off invoices: AI overage chunks and automatic credit
    /// reloads. Their outcome decides whether the payer keeps overage or
    /// automatic reloads; they never touch plan roles.
    #[tracing::instrument(skip_all, fields(invoice_id = %invoice.id, paid = invoice.paid, purpose), err)]
    async fn ai_credit_invoice(&self, invoice: &InvoiceFacts) -> Result<(), ApplyError> {
        let purpose = invoice
            .metadata
            .get(PURPOSE_METADATA_KEY)
            .map(String::as_str);
        tracing::Span::current().record("purpose", purpose);
        match purpose {
            Some(PURPOSE_AI_OVERAGE) => self
                .billing
                .mark_overage_invoice(invoice.id.as_str(), invoice.paid)
                .await
                .map_err(retry),
            Some(PURPOSE_AI_CREDIT_RELOAD) => {
                // The reload id finds a paid invoice whose id never reached
                // its row.
                let reload_id = invoice
                    .metadata
                    .get(RELOAD_METADATA_KEY)
                    .and_then(|id| macro_uuid::string_to_uuid(id).ok());
                self.billing
                    .mark_credit_reload_invoice(invoice.id.as_str(), reload_id, invoice.paid)
                    .await
                    .map_err(retry)
            }
            _ => Ok(()),
        }
    }

    /// A credit pack checkout. One paid with a delayed method completes its
    /// session unpaid and reports the money later; both events book through
    /// the same path, idempotent on the session id.
    #[tracing::instrument(skip_all, fields(session_id = %checkout.id, paid = checkout.paid), err)]
    async fn credit_checkout(&self, checkout: &CheckoutFacts) -> Result<(), ApplyError> {
        if checkout
            .metadata
            .get(PURPOSE_METADATA_KEY)
            .map(String::as_str)
            != Some(PURPOSE_AI_CREDITS)
        {
            return Ok(());
        }
        if !checkout.paid {
            return Ok(());
        }
        let payer = checkout
            .metadata
            .get(PAYER_METADATA_KEY)
            .cloned()
            .and_then(|payer| MacroUserIdStr::try_from(payer).ok())
            .ok_or_else(|| {
                ApplyError::Reject(
                    rootcause::report!("credit checkout session has no valid payer").into_dynamic(),
                )
            })?;
        let amount_cents = checkout
            .amount_total
            .or_else(|| {
                checkout
                    .metadata
                    .get("amount_cents")
                    .and_then(|amount| amount.parse().ok())
            })
            .ok_or_else(|| {
                ApplyError::Reject(
                    rootcause::report!("credit checkout session has no amount").into_dynamic(),
                )
            })?;
        self.billing
            .apply_credit_purchase(&payer, amount_cents, checkout.id.as_str())
            .await
            .map_err(retry)
    }
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct SubscriptionEvent {
    transaction_id: String,
    value: f64,
    currency: String,
}

/// PostHog properties for a subscription event. GA and Meta get the bare
/// [`SubscriptionEvent`]; only PostHog receives the team and its group.
#[derive(Debug, Serialize)]
pub(crate) struct PostHogSubscriptionEvent<'a> {
    #[serde(flatten)]
    event: &'a SubscriptionEvent,
    #[serde(skip_serializing_if = "Option::is_none")]
    team_id: Option<uuid::Uuid>,
    #[serde(rename = "$groups", skip_serializing_if = "Option::is_none")]
    groups: Option<PostHogTeamGroup>,
}

/// Attributes the event to the team in PostHog group analytics.
#[derive(Debug, Serialize)]
pub(crate) struct PostHogTeamGroup {
    team: uuid::Uuid,
}
