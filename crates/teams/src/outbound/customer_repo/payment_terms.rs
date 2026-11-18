//! What the buy dialog shows before a purchase: the subscription's terms and
//! card from one read, and what adding items would invoice now from one
//! invoice preview. Nothing here runs on the purchase itself.

use serde::Serialize;

use super::*;
use crate::domain::model::{CardBrand, PaymentCard, PaymentTerms, ProratedCharge};

/// Lines asked for in one preview: one proration per added price, far fewer.
const PREVIEW_LINES: u64 = 100;

/// `GET /v1/invoices/upcoming/lines` for the subscription with one more item
/// of each price, invoiced now as a purchase is. async-stripe's
/// `RetrieveUpcomingInvoice` has no `subscription_proration_behavior`.
#[derive(Serialize)]
struct UpcomingLines<'a> {
    subscription: &'a str,
    subscription_items: Vec<AddedItem<'a>>,
    subscription_proration_behavior: &'static str,
    limit: u64,
}

#[derive(Serialize)]
struct AddedItem<'a> {
    price: &'a str,
    quantity: u64,
}

/// Period end, interval, currency and trial of a subscription.
pub(super) fn terms_of(
    subscription: &stripe::Subscription,
) -> Result<SubscriptionTerms, CustomerError> {
    let interval = subscription
        .items
        .data
        .iter()
        .find_map(|item| item.price.as_ref()?.recurring.as_ref())
        .map(|recurring| cadence(recurring.interval))
        .ok_or(SubscriptionDataError::MissingRecurringItem)?;
    let current_period_end = chrono::DateTime::from_timestamp(subscription.current_period_end, 0)
        .ok_or(SubscriptionDataError::InvalidPeriodEnd)?;
    Ok(SubscriptionTerms {
        current_period_end,
        interval,
        currency: subscription.currency.to_string(),
        trialing: subscription.status == stripe::SubscriptionStatus::Trialing,
    })
}

/// The card the subscription charges: its own default method, else the
/// customer's invoice default. `None` when neither is set or the method is
/// not a card. Both must be expanded.
fn card_of(subscription: &stripe::Subscription) -> Option<PaymentCard> {
    let method = match &subscription.default_payment_method {
        Some(method) => method,
        None => match &subscription.customer {
            stripe::Expandable::Object(customer) => customer
                .invoice_settings
                .as_ref()?
                .default_payment_method
                .as_ref()?,
            stripe::Expandable::Id(_) => return None,
        },
    };
    let stripe::Expandable::Object(method) = method else {
        return None;
    };
    let card = method.card.as_ref()?;
    let brand = card.brand.parse().unwrap_or_else(|_| {
        tracing::warn!(brand = %card.brand, "card brand not known here");
        CardBrand::Unknown
    });
    Some(PaymentCard {
        brand,
        last4: card.last4.clone(),
    })
}

/// The customer's credit balance (Stripe keeps credit as a negative
/// balance). The customer must be expanded.
fn credit_of(subscription: &stripe::Subscription) -> i64 {
    match &subscription.customer {
        stripe::Expandable::Object(customer) => (-customer.balance.unwrap_or(0)).max(0),
        stripe::Expandable::Id(_) => 0,
    }
}

/// What a proration line invoices: its amount, less discounts, plus tax not
/// included in it.
fn invoiced(line: &stripe::InvoiceLineItem) -> i64 {
    let discounts: i64 = line
        .discount_amounts
        .iter()
        .flatten()
        .map(|discount| discount.amount)
        .sum();
    let exclusive_tax: i64 = line
        .tax_amounts
        .iter()
        .flatten()
        .filter(|tax| !tax.inclusive)
        .map(|tax| tax.amount)
        .sum();
    line.amount - discounts + exclusive_tax
}

impl CustomerRepositoryImpl {
    pub(super) async fn read_payment_terms(
        &self,
        subscription_id: &stripe::SubscriptionId,
    ) -> Result<PaymentTerms, CustomerError> {
        let subscription = traced(
            stripe_span!("stripe.subscription.retrieve", subscription_id = %subscription_id),
            stripe::Subscription::retrieve(
                &self.client,
                subscription_id,
                &[
                    "default_payment_method",
                    "customer.invoice_settings.default_payment_method",
                ],
            ),
        )
        .await
        .map_err(storage)?;
        let card = card_of(&subscription);
        tracing::Span::current().record("card", card.is_some());
        Ok(PaymentTerms {
            terms: terms_of(&subscription)?,
            card,
            credit: credit_of(&subscription),
        })
    }

    pub(super) async fn read_prorations(
        &self,
        subscription_id: &stripe::SubscriptionId,
        prices: &[stripe::PriceId],
    ) -> Result<Vec<ProratedCharge>, CustomerError> {
        if prices.is_empty() {
            return Ok(Vec::new());
        }
        let params = UpcomingLines {
            subscription: subscription_id.as_str(),
            subscription_items: prices
                .iter()
                .map(|price| AddedItem {
                    price: price.as_str(),
                    quantity: 1,
                })
                .collect(),
            subscription_proration_behavior: "always_invoice",
            limit: PREVIEW_LINES,
        };
        let lines: stripe::List<stripe::InvoiceLineItem> = traced(
            stripe_span!(
                "stripe.invoice.upcoming_lines",
                subscription_id = %subscription_id,
                prices = prices.len(),
            ),
            self.client.get_query("/invoices/upcoming/lines", &params),
        )
        .await
        .map_err(storage)?;
        if lines.has_more {
            return Err(SubscriptionDataError::Internal(rootcause::report!(
                "the invoice preview has more than {PREVIEW_LINES} lines"
            ))
            .into());
        }
        prices
            .iter()
            .map(|price_id| {
                let mut matching = lines
                    .data
                    .iter()
                    .filter(|line| {
                        line.proration
                            && line
                                .price
                                .as_ref()
                                .is_some_and(|price| &price.id == price_id)
                    })
                    .peekable();
                // A price with no proration line would read as free.
                if matching.peek().is_none() {
                    return Err(SubscriptionDataError::Internal(rootcause::report!(
                        "the invoice preview has no proration for {price_id}"
                    ))
                    .into());
                }
                let amount = matching.map(invoiced).sum();
                Ok(ProratedCharge {
                    price_id: price_id.clone(),
                    amount,
                })
            })
            .collect()
    }
}
