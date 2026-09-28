//! Stripe adapter: one-off Checkout for credit packs, and immediate invoices
//! for overage chunks.

use crate::domain::{
    BillingError, CreditCheckoutRequest, OverageChargeRequest, PaymentGateway, Result,
};
use chrono::Utc;
use macro_uuid::Uuid;
use std::collections::HashMap;
use std::sync::Arc;
use stripe::{
    CheckoutSession, CheckoutSessionMode, CollectionMethod, CreateCheckoutSession,
    CreateCheckoutSessionLineItems, CreateCheckoutSessionLineItemsPriceData,
    CreateCheckoutSessionLineItemsPriceDataProductData, CreateCheckoutSessionPaymentIntentData,
    CreateInvoice, CreateInvoiceItem, Currency, CustomerId, FinalizeInvoiceParams, Invoice,
    InvoiceId, InvoiceItem, InvoicePendingInvoiceItemsBehavior, InvoiceStatus, RequestStrategy,
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
}

fn payment(e: stripe::StripeError) -> BillingError {
    BillingError::Payment(e.into())
}

fn parse_customer(id: &str) -> Result<CustomerId> {
    id.parse::<CustomerId>()
        .map_err(|e| BillingError::Payment(anyhow::anyhow!("invalid stripe customer id: {e}")))
}

fn dollars(cents: i64) -> String {
    format!("${}.{:02}", cents / 100, cents % 100)
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
    async fn pay_overage_invoice(&self, charge_id: Uuid, invoice_id: &str) -> Result<bool> {
        let invoice_id: InvoiceId = invoice_id.parse().map_err(|e| {
            BillingError::Payment(anyhow::anyhow!("invalid stripe invoice id: {e}"))
        })?;
        // Every attempt is its own request: replaying the first attempt's key
        // would replay its decline instead of trying the payer's (new) card.
        let key = format!(
            "ai_overage:{charge_id}:pay:{}",
            Utc::now().timestamp_millis()
        );
        match Invoice::pay(&self.idempotent(key), &invoice_id).await {
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

    async fn pay_overage_invoice(&self, _charge_id: Uuid, _invoice_id: &str) -> Result<bool> {
        Err(BillingError::Payment(anyhow::anyhow!(
            "payments are not configured in this service"
        )))
    }
}
