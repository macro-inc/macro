//! Stripe adapter: one-off Checkout for credit packs, and immediate invoices
//! for overage chunks.

#[cfg(test)]
mod test;

use crate::domain::{
    BillingError, CreditCheckoutRequest, OverageChargeRequest, PaymentGateway, Result,
    SubscriptionScope,
};
use chrono::Utc;
use macro_uuid::Uuid;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use stripe::{
    CheckoutSession, CheckoutSessionMode, CollectionMethod, CreateCheckoutSession,
    CreateCheckoutSessionLineItems, CreateCheckoutSessionLineItemsPriceData,
    CreateCheckoutSessionLineItemsPriceDataProductData, CreateCheckoutSessionPaymentIntentData,
    CreateInvoice, CreateInvoiceItem, Currency, Customer, CustomerId, Expandable,
    FinalizeInvoiceParams, Invoice, InvoiceId, InvoiceItem, InvoicePendingInvoiceItemsBehavior,
    InvoiceStatus, ListSubscriptions, PaymentMethodId, RequestStrategy, Subscription,
    SubscriptionStatus,
};

/// Metadata key stamped on every Stripe object this crate creates.
pub const PURPOSE_METADATA_KEY: &str = "macro_purpose";
/// [`PURPOSE_METADATA_KEY`] value for a credit-pack Checkout Session.
pub const PURPOSE_AI_CREDITS: &str = "ai_credits";
/// [`PURPOSE_METADATA_KEY`] value for an overage invoice.
pub const PURPOSE_AI_OVERAGE: &str = "ai_overage";
/// Metadata key carrying the payer's Macro user id.
pub const PAYER_METADATA_KEY: &str = "macro_user_id";
/// Metadata key carrying the `ai_overage_charge` id on overage invoices.
pub const CHARGE_METADATA_KEY: &str = "macro_charge_id";
const BILLING_SCOPE_METADATA_KEY: &str = "macro_billing_scope";
const PERSONAL_SCOPE_STAMP: &str = "personal";

/// [`PaymentGateway`] backed by Stripe.
#[derive(Clone)]
pub struct StripePaymentGateway {
    client: Arc<stripe::Client>,
}

impl StripePaymentGateway {
    /// Wrap a configured Stripe client.
    pub fn new(client: Arc<stripe::Client>) -> Self {
        Self { client }
    }

    /// A client that sends `key` as the idempotency key on its next request,
    /// so a retried settlement never creates a second invoice.
    fn idempotent(&self, key: String) -> stripe::Client {
        (*self.client)
            .clone()
            .with_strategy(RequestStrategy::Idempotent(key))
    }

    async fn resolve_charge_method(
        &self,
        customer_id: &CustomerId,
        scope: SubscriptionScope,
    ) -> Result<Option<ChargeMethod>> {
        let customer = Customer::retrieve(&self.client, customer_id, &[])
            .await
            .map_err(payment)?;
        let subscriptions = self.non_canceled_subscriptions(customer_id).await?;
        charge_method(customer_fallback(&customer), &subscriptions, scope)
    }

    /// Stripe omits `status` to mean every subscription that is not canceled.
    async fn non_canceled_subscriptions(
        &self,
        customer_id: &CustomerId,
    ) -> Result<Vec<Subscription>> {
        let mut params = ListSubscriptions::new();
        params.customer = Some(customer_id.clone());
        params.limit = Some(100);
        let mut subscriptions = Vec::new();
        let mut starting_after = None;
        loop {
            params.starting_after = starting_after.clone();
            let page = Subscription::list(&self.client, &params)
                .await
                .map_err(payment)?;
            let has_more = page.has_more;
            let next = page.data.last().map(|subscription| subscription.id.clone());
            subscriptions.extend(page.data);
            if !has_more {
                break;
            }
            let next = next.ok_or_else(|| {
                BillingError::Payment(anyhow::anyhow!(
                    "stripe returned an empty subscription page with more results"
                ))
            })?;
            if starting_after.as_ref() == Some(&next) {
                return Err(BillingError::Payment(anyhow::anyhow!(
                    "stripe repeated a subscription page"
                )));
            }
            starting_after = Some(next);
        }
        Ok(subscriptions)
    }
}

fn payment(e: stripe::StripeError) -> BillingError {
    BillingError::Payment(e.into())
}

fn no_matching_subscription() -> BillingError {
    BillingError::Payment(anyhow::anyhow!(
        "no active or trialing subscription matches the billing scope"
    ))
}

fn parse_customer(id: &str) -> Result<CustomerId> {
    id.parse::<CustomerId>()
        .map_err(|e| BillingError::Payment(anyhow::anyhow!("invalid stripe customer id: {e}")))
}

fn dollars(cents: i64) -> String {
    format!("${}.{:02}", cents / 100, cents % 100)
}

enum ChargeMethod {
    Subscription(PaymentMethodId),
    CustomerFallback(Option<PaymentMethodId>),
}

impl ChargeMethod {
    fn payment_method(&self) -> Option<&PaymentMethodId> {
        match self {
            Self::Subscription(method) => Some(method),
            Self::CustomerFallback(method) => method.as_ref(),
        }
    }
}

fn customer_fallback(customer: &Customer) -> Option<PaymentMethodId> {
    customer
        .invoice_settings
        .as_ref()
        .and_then(|settings| payment_method_id(&settings.default_payment_method))
}

fn payment_method_id(
    method: &Option<Expandable<stripe::PaymentMethod>>,
) -> Option<PaymentMethodId> {
    method.as_ref().map(Expandable::id)
}

fn in_scope(subscription: &Subscription, scope: SubscriptionScope) -> bool {
    let team_id = subscription.metadata.get("team_id");
    match scope {
        SubscriptionScope::Personal => team_id.is_none(),
        SubscriptionScope::Team { team_id: expected } => team_id
            .and_then(|raw| macro_uuid::string_to_uuid(raw).ok())
            .is_some_and(|parsed| parsed == expected),
    }
}

fn charge_method(
    fallback: Option<PaymentMethodId>,
    subscriptions: &[Subscription],
    scope: SubscriptionScope,
) -> Result<Option<ChargeMethod>> {
    let mut matched = false;
    let mut agreed = None;
    let mut explicit = None;
    for subscription in subscriptions {
        if !matches!(
            subscription.status,
            SubscriptionStatus::Active | SubscriptionStatus::Trialing
        ) || !in_scope(subscription, scope)
        {
            continue;
        }
        matched = true;
        let explicit_default = payment_method_id(&subscription.default_payment_method);
        let effective = explicit_default.clone().or_else(|| fallback.clone());
        if let Some(previous) = &agreed {
            if previous != &effective {
                return Err(BillingError::Payment(anyhow::anyhow!(
                    "active subscriptions do not share a payment method"
                )));
            }
        } else {
            agreed = Some(effective);
        }
        if explicit.is_none() {
            explicit = explicit_default;
        }
    }
    if !matched {
        return Ok(None);
    }
    Ok(Some(match explicit {
        Some(method) => ChargeMethod::Subscription(method),
        None => ChargeMethod::CustomerFallback(fallback),
    }))
}

fn scope_stamp(scope: SubscriptionScope) -> String {
    match scope {
        SubscriptionScope::Personal => PERSONAL_SCOPE_STAMP.to_string(),
        SubscriptionScope::Team { team_id } => team_id.to_string(),
    }
}

fn stamped_scope(invoice: &Invoice) -> Result<Option<SubscriptionScope>> {
    let Some(raw) = invoice
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get(BILLING_SCOPE_METADATA_KEY))
    else {
        return Ok(None);
    };
    if raw == PERSONAL_SCOPE_STAMP {
        return Ok(Some(SubscriptionScope::Personal));
    }
    match macro_uuid::string_to_uuid(raw) {
        Ok(team_id) => Ok(Some(SubscriptionScope::Team { team_id })),
        Err(_) => Err(BillingError::Payment(anyhow::anyhow!(
            "overage invoice has a malformed billing scope"
        ))),
    }
}

#[derive(Serialize)]
struct UpdateInvoice<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    default_payment_method: Option<&'a PaymentMethodId>,
    metadata: HashMap<String, String>,
}

impl<'a> UpdateInvoice<'a> {
    fn new(scope: SubscriptionScope, default_payment_method: Option<&'a PaymentMethodId>) -> Self {
        Self {
            default_payment_method,
            metadata: HashMap::from([(BILLING_SCOPE_METADATA_KEY.to_string(), scope_stamp(scope))]),
        }
    }
}

#[derive(Serialize)]
struct PayInvoice<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    payment_method: Option<&'a PaymentMethodId>,
}

impl PaymentGateway for StripePaymentGateway {
    #[tracing::instrument(skip(self, request), fields(payer = %request.payer, cents = request.amount_cents), err)]
    async fn create_credit_checkout(&self, request: CreditCheckoutRequest) -> Result<String> {
        let customer = parse_customer(&request.customer_id)?;
        let metadata: HashMap<String, String> = HashMap::from([
            (
                PURPOSE_METADATA_KEY.to_string(),
                PURPOSE_AI_CREDITS.to_string(),
            ),
            (PAYER_METADATA_KEY.to_string(), request.payer.to_string()),
            ("amount_cents".to_string(), request.amount_cents.to_string()),
        ]);

        let params = CreateCheckoutSession {
            customer: Some(customer),
            mode: Some(CheckoutSessionMode::Payment),
            success_url: Some(request.success_url.as_str()),
            cancel_url: Some(request.cancel_url.as_str()),
            line_items: Some(vec![CreateCheckoutSessionLineItems {
                quantity: Some(1),
                price_data: Some(CreateCheckoutSessionLineItemsPriceData {
                    currency: Currency::USD,
                    unit_amount: Some(request.amount_cents),
                    product_data: Some(CreateCheckoutSessionLineItemsPriceDataProductData {
                        name: format!("Macro AI credits ({})", dollars(request.amount_cents)),
                        description: Some(
                            "Prepaid AI usage, applied after your plan's included AI is used."
                                .to_string(),
                        ),
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
                ..Default::default()
            }]),
            metadata: Some(metadata.clone()),
            payment_intent_data: Some(CreateCheckoutSessionPaymentIntentData {
                description: Some("Macro AI credits".to_string()),
                metadata: Some(metadata),
                ..Default::default()
            }),
            ..Default::default()
        };

        let session = CheckoutSession::create(&self.client, params)
            .await
            .map_err(payment)?;
        session
            .url
            .ok_or_else(|| BillingError::Payment(anyhow::anyhow!("checkout session has no url")))
    }

    #[tracing::instrument(skip(self, request), fields(charge = %request.charge_id, cents = request.amount_cents), err)]
    async fn open_overage_invoice(&self, request: OverageChargeRequest) -> Result<String> {
        let customer = parse_customer(&request.customer_id)?;
        let live_method = self
            .resolve_charge_method(&customer, request.scope)
            .await?
            .ok_or_else(no_matching_subscription)?;
        let key = format!("ai_overage:{}", request.charge_id);
        let metadata: HashMap<String, String> = HashMap::from([
            (
                PURPOSE_METADATA_KEY.to_string(),
                PURPOSE_AI_OVERAGE.to_string(),
            ),
            (
                CHARGE_METADATA_KEY.to_string(),
                request.charge_id.to_string(),
            ),
        ]);

        // 1. An empty draft invoice that takes nothing else pending on the
        //    customer, so it can never bill more than this one charge.
        //    `auto_advance` keeps Stripe's retry schedule on a declined card;
        //    the outcome arrives via webhook.
        let mut invoice = CreateInvoice::new();
        invoice.customer = Some(customer.clone());
        invoice.auto_advance = Some(true);
        invoice.collection_method = Some(CollectionMethod::ChargeAutomatically);
        invoice.pending_invoice_items_behavior = Some(InvoicePendingInvoiceItemsBehavior::Exclude);
        invoice.description = Some("Macro AI usage beyond plan");
        invoice.metadata = Some(metadata.clone());
        let invoice = Invoice::create(&self.idempotent(format!("{key}:invoice")), invoice)
            .await
            .map_err(payment)?;
        // Stripe replays the original create response. Read the invoice again
        // to observe routing written by an earlier attempt.
        let invoice = Invoice::retrieve(&self.client, &invoice.id, &[])
            .await
            .map_err(payment)?;
        let invoice_scope = stamped_scope(&invoice)?;
        let scope = invoice_scope.unwrap_or(request.scope);
        let resolved = if invoice_scope.is_some() {
            self.resolve_charge_method(&customer, scope).await?
        } else {
            Some(live_method)
        };
        let stored_method = payment_method_id(&invoice.default_payment_method);
        if resolved.is_none() && stored_method.is_none() {
            return Err(no_matching_subscription());
        }
        let method = resolved
            .as_ref()
            .and_then(ChargeMethod::payment_method)
            .cloned()
            .or(stored_method);
        self.client
            .post_form::<Invoice, _>(
                &format!("/invoices/{}", invoice.id),
                &UpdateInvoice::new(scope, method.as_ref()),
            )
            .await
            .map_err(payment)?;

        // 2. The line item, attached to that invoice rather than left pending
        //    on the customer where another invoice could sweep it up.
        let mut item = CreateInvoiceItem::new(customer);
        item.invoice = Some(invoice.id.clone());
        item.amount = Some(request.amount_cents);
        item.currency = Some(Currency::USD);
        item.description = Some(request.description.as_str());
        item.metadata = Some(metadata);
        if let Err(e) = InvoiceItem::create(&self.idempotent(format!("{key}:item")), item).await {
            // Nothing is owed on a draft with no lines; drop it so nothing else
            // can finalize it. Best effort: a retry replays the same keys and
            // lands on the same draft either way.
            if let Err(delete_err) = Invoice::delete(&self.client, &invoice.id).await {
                tracing::warn!(
                    error = ?delete_err,
                    invoice = %invoice.id,
                    "could not delete an empty overage draft invoice"
                );
            }
            return Err(payment(e));
        }

        // 3. Finalize so it is collectable now rather than in an hour.
        Invoice::finalize(
            &self.idempotent(format!("{key}:finalize")),
            &invoice.id,
            FinalizeInvoiceParams {
                auto_advance: Some(true),
            },
        )
        .await
        .map_err(payment)?;

        Ok(invoice.id.to_string())
    }

    #[tracing::instrument(skip(self), fields(charge = %charge_id, invoice = %invoice_id), err)]
    async fn pay_overage_invoice(
        &self,
        charge_id: Uuid,
        invoice_id: &str,
        scope: SubscriptionScope,
    ) -> Result<bool> {
        let invoice_id: InvoiceId = invoice_id.parse().map_err(|e| {
            BillingError::Payment(anyhow::anyhow!("invalid stripe invoice id: {e}"))
        })?;
        let invoice = Invoice::retrieve(&self.client, &invoice_id, &[])
            .await
            .map_err(payment)?;
        if invoice.status == Some(InvoiceStatus::Paid) {
            return Ok(true);
        }
        let invoice_scope = stamped_scope(&invoice)?;
        let scope = invoice_scope.unwrap_or(scope);
        let customer_id = invoice
            .customer
            .as_ref()
            .map(Expandable::id)
            .ok_or_else(|| {
                BillingError::Payment(anyhow::anyhow!("overage invoice has no customer"))
            })?;
        let resolved = self.resolve_charge_method(&customer_id, scope).await?;
        let stored_method = payment_method_id(&invoice.default_payment_method);
        if resolved.is_none() && stored_method.is_none() {
            return Err(no_matching_subscription());
        }
        let matched_method = resolved
            .as_ref()
            .and_then(ChargeMethod::payment_method)
            .cloned();
        if invoice.status == Some(InvoiceStatus::Open)
            && resolved.is_some()
            && (invoice_scope.is_none()
                || matched_method
                    .as_ref()
                    .is_some_and(|method| stored_method.as_ref() != Some(method)))
        {
            // A repeated set converges. An idempotency key would replay the
            // previous card after the payer switches away and back.
            self.client
                .post_form::<Invoice, _>(
                    &format!("/invoices/{invoice_id}"),
                    &UpdateInvoice::new(scope, matched_method.as_ref()),
                )
                .await
                .map_err(payment)?;
        }
        let method = matched_method.or(stored_method);
        // Every attempt is its own request: replaying the first attempt's key
        // would replay its decline instead of trying the payer's (new) card.
        let key = format!(
            "ai_overage:{charge_id}:pay:{}",
            Utc::now().timestamp_millis()
        );
        let pay = PayInvoice {
            payment_method: method.as_ref(),
        };
        match self
            .idempotent(key)
            .post_form::<Invoice, _>(&format!("/invoices/{invoice_id}/pay"), &pay)
            .await
        {
            Ok(invoice) => Ok(invoice.status == Some(InvoiceStatus::Paid)),
            Err(e) => {
                // A decline is a failed collection, not a failed request: the
                // invoice stays open and Stripe retries it. The invoice's own
                // status also tells a retry that Stripe already collected it.
                let invoice = Invoice::retrieve(&self.client, &invoice_id, &[])
                    .await
                    .map_err(|retrieve_err| {
                        tracing::warn!(
                            error = ?e,
                            "overage invoice payment failed and the invoice could not be read"
                        );
                        payment(retrieve_err)
                    })?;
                match invoice.status {
                    Some(InvoiceStatus::Paid) => Ok(true),
                    Some(InvoiceStatus::Open) => {
                        tracing::warn!(
                            error = ?e,
                            "overage invoice payment did not succeed; left open for stripe retries"
                        );
                        Ok(false)
                    }
                    other => Err(BillingError::Payment(anyhow::anyhow!(
                        "overage invoice is {other:?} after a failed payment attempt: {e}"
                    ))),
                }
            }
        }
    }
}

/// A [`PaymentGateway`] for services that never settle (they only read
/// billing state and gate requests). Any attempt to pay is a bug.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoOpPaymentGateway;

impl PaymentGateway for NoOpPaymentGateway {
    async fn create_credit_checkout(&self, _request: CreditCheckoutRequest) -> Result<String> {
        Err(BillingError::Payment(anyhow::anyhow!(
            "payments are not configured in this service"
        )))
    }

    async fn open_overage_invoice(&self, _request: OverageChargeRequest) -> Result<String> {
        Err(BillingError::Payment(anyhow::anyhow!(
            "payments are not configured in this service"
        )))
    }

    async fn pay_overage_invoice(
        &self,
        _charge_id: Uuid,
        _invoice_id: &str,
        _scope: SubscriptionScope,
    ) -> Result<bool> {
        Err(BillingError::Payment(anyhow::anyhow!(
            "payments are not configured in this service"
        )))
    }
}
