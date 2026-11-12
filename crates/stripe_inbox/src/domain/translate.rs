//! The only code that reads Stripe JSON. Webhook payloads arrive in the
//! endpoint's API version and API reads in the client's; both become the
//! same typed facts here. Anything malformed or in an unknown version fails
//! loudly instead of being half-read.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;
use stripe::{
    CheckoutSessionId, CustomerId, EventId, InvoiceId, PriceId, ProductId, SubscriptionId,
    SubscriptionItemId, SubscriptionStatus,
};
use uuid::Uuid;

use super::model::{
    Attribution, CheckoutFacts, CustomerFacts, EventType, InvoiceFacts, InvoiceLine, ItemFacts,
    ObjectKind, ObjectSnapshot, OrderingKey, Period, PreviousAttributes, PreviousItem,
    ReceivedEvent, SubscriptionChange, SubscriptionEventKind, SubscriptionFacts,
};

#[cfg(test)]
mod test;

/// Webhook payload versions the translator reads: the dev endpoint's and the
/// prod endpoint's. A new endpoint version needs a fixture per event type
/// before it is added here.
pub const SUPPORTED_API_VERSIONS: [&str; 2] = ["2019-12-03", "2025-09-30.clover"];

/// The metadata key a team subscription carries its team in.
pub const TEAM_ID_METADATA_KEY: &str = "team_id";
/// The metadata key a team subscription carries its owner in.
pub const OWNER_ID_METADATA_KEY: &str = "owner_id";
/// The metadata key Macro stamps on an immediate plan change.
pub const PLAN_CHANGE_AT_METADATA_KEY: &str = "macro_plan_change_at";
/// The metadata key a computer's subscription item (or its price) carries.
pub const COMPUTER_ID_METADATA_KEY: &str = "computer_id";

/// Why a payload could not be translated.
#[derive(Debug, thiserror::Error)]
pub enum TranslateError {
    /// Not valid JSON, or a field had the wrong shape.
    #[error("malformed {what}: {source}")]
    Malformed {
        /// What was being read.
        what: &'static str,
        /// The parse error.
        source: serde_json::Error,
    },
    /// A required value is missing or invalid.
    #[error("invalid {0}")]
    Invalid(&'static str),
    /// Rendered in an API version the translator does not read.
    #[error("unsupported api version {0}")]
    UnsupportedApiVersion(String),
}

fn malformed(what: &'static str) -> impl FnOnce(serde_json::Error) -> TranslateError {
    move |source| TranslateError::Malformed { what, source }
}

/// An id, or the expanded object carrying it.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum IdOrObject {
    Id(String),
    Object { id: String },
}

impl IdOrObject {
    fn id(&self) -> &str {
        match self {
            Self::Id(id) | Self::Object { id } => id,
        }
    }
}

#[derive(Deserialize)]
struct RawEnvelope {
    id: EventId,
    #[serde(rename = "type")]
    type_name: String,
    api_version: Option<String>,
    livemode: bool,
    created: i64,
    data: RawEnvelopeData,
}

#[derive(Deserialize)]
struct RawEnvelopeData {
    object: Value,
    #[serde(default)]
    previous_attributes: Option<Value>,
}

#[derive(Deserialize)]
struct RawObjectHead {
    id: String,
    object: String,
    customer: Option<IdOrObject>,
    #[serde(default)]
    deleted: bool,
}

fn timestamp(seconds: i64) -> Result<DateTime<Utc>, TranslateError> {
    DateTime::from_timestamp(seconds, 0).ok_or(TranslateError::Invalid("timestamp"))
}

/// Parses a verified webhook body just enough to store and order it.
pub fn received_event(payload: &str) -> Result<ReceivedEvent, TranslateError> {
    let payload: Value = serde_json::from_str(payload).map_err(malformed("event"))?;
    let envelope = RawEnvelope::deserialize(&payload).map_err(malformed("event"))?;
    let head = RawObjectHead::deserialize(&envelope.data.object).map_err(malformed("object"))?;
    let api_version = envelope
        .api_version
        .ok_or(TranslateError::Invalid("api version"))?;

    let customer = match head.object.as_str() {
        "customer" => Some(head.id.clone()),
        _ => head
            .customer
            .as_ref()
            .map(|customer| customer.id().to_owned()),
    };
    let projection = match head.object.as_str() {
        "subscription" => Some(ObjectSnapshot {
            id: head.id.clone(),
            kind: ObjectKind::Subscription,
            customer: customer.clone(),
            snapshot: envelope.data.object.clone(),
            deleted: false,
        }),
        "customer" => Some(ObjectSnapshot {
            id: head.id.clone(),
            kind: ObjectKind::Customer,
            customer: customer.clone(),
            snapshot: envelope.data.object.clone(),
            deleted: head.deleted || envelope.type_name == EventType::CustomerDeleted.as_ref(),
        }),
        _ => None,
    };
    let ordering_key = OrderingKey(customer.unwrap_or_else(|| head.id.clone()));

    Ok(ReceivedEvent {
        id: envelope.id,
        type_name: envelope.type_name,
        api_version,
        livemode: envelope.livemode,
        created_at: timestamp(envelope.created)?,
        ordering_key,
        object_id: head.id,
        projection,
        payload,
    })
}

/// A translated stored event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Translated {
    /// A subscription snapshot.
    Subscription(SubscriptionChange),
    /// An invoice outcome.
    Invoice(InvoiceFacts),
    /// A checkout session.
    Checkout(CheckoutFacts),
    /// A customer change; projected only.
    Customer,
}

/// Translates a stored event of a known type.
pub fn translate(event_type: EventType, payload: &Value) -> Result<Translated, TranslateError> {
    let envelope = RawEnvelope::deserialize(payload).map_err(malformed("event"))?;
    let api_version = envelope.api_version.unwrap_or_default();
    if !SUPPORTED_API_VERSIONS.contains(&api_version.as_str()) {
        return Err(TranslateError::UnsupportedApiVersion(api_version));
    }
    let object = &envelope.data.object;
    let subscription_change = |kind| -> Result<Translated, TranslateError> {
        Ok(Translated::Subscription(SubscriptionChange {
            kind,
            subscription: subscription_facts(object)?,
            previous: previous_attributes(envelope.data.previous_attributes.as_ref())?,
        }))
    };

    match event_type {
        EventType::CustomerSubscriptionCreated => {
            subscription_change(SubscriptionEventKind::Created)
        }
        EventType::CustomerSubscriptionUpdated => {
            subscription_change(SubscriptionEventKind::Updated)
        }
        EventType::CustomerSubscriptionDeleted => {
            subscription_change(SubscriptionEventKind::Deleted)
        }
        EventType::CustomerSubscriptionPaused => subscription_change(SubscriptionEventKind::Paused),
        EventType::CustomerSubscriptionResumed => {
            subscription_change(SubscriptionEventKind::Resumed)
        }
        EventType::InvoicePaid | EventType::InvoicePaymentSucceeded => {
            Ok(Translated::Invoice(invoice_facts(object, true)?))
        }
        EventType::InvoicePaymentFailed => Ok(Translated::Invoice(invoice_facts(object, false)?)),
        EventType::CheckoutSessionCompleted | EventType::CheckoutSessionAsyncPaymentSucceeded => {
            Ok(Translated::Checkout(checkout_facts(object)?))
        }
        EventType::CustomerUpdated | EventType::CustomerDeleted => Ok(Translated::Customer),
    }
}

#[derive(Deserialize)]
struct RawList<T> {
    #[serde(default = "Vec::new")]
    data: Vec<T>,
    has_more: Option<bool>,
}

#[derive(Deserialize)]
struct RawSubscription {
    id: SubscriptionId,
    customer: IdOrObject,
    status: SubscriptionStatus,
    created: i64,
    currency: Option<String>,
    #[serde(default)]
    metadata: HashMap<String, String>,
    current_period_start: Option<i64>,
    current_period_end: Option<i64>,
    items: RawList<RawItem>,
}

#[derive(Deserialize)]
struct RawItem {
    id: SubscriptionItemId,
    price: RawPrice,
    quantity: Option<u64>,
    #[serde(default)]
    metadata: HashMap<String, String>,
    current_period_start: Option<i64>,
    current_period_end: Option<i64>,
}

#[derive(Deserialize)]
struct RawPrice {
    id: PriceId,
    product: Option<IdOrObject>,
    unit_amount: Option<i64>,
    currency: Option<String>,
    #[serde(rename = "type")]
    price_type: Option<String>,
    recurring: Option<RawRecurring>,
    #[serde(default)]
    metadata: HashMap<String, String>,
}

#[derive(Deserialize)]
struct RawRecurring {
    interval: String,
    interval_count: u64,
}

/// A period from two timestamps; `None` unless both exist and `start < end`.
fn period(start: Option<i64>, end: Option<i64>) -> Option<Period> {
    let (start, end) = (start?, end?);
    if start >= end {
        return None;
    }
    Some(Period {
        start: DateTime::from_timestamp(start, 0)?,
        end: DateTime::from_timestamp(end, 0)?,
    })
}

fn non_empty(metadata: &HashMap<String, String>, key: &str) -> Option<String> {
    metadata.get(key).filter(|value| !value.is_empty()).cloned()
}

/// Translates one subscription, from an event payload or an API read.
pub fn subscription_facts(object: &Value) -> Result<SubscriptionFacts, TranslateError> {
    let raw = RawSubscription::deserialize(object).map_err(malformed("subscription"))?;
    let customer: CustomerId = raw
        .customer
        .id()
        .parse()
        .map_err(|_| TranslateError::Invalid("subscription customer"))?;
    let team_id = non_empty(&raw.metadata, TEAM_ID_METADATA_KEY)
        .map(|team| Uuid::parse_str(&team))
        .transpose()
        .map_err(|_| TranslateError::Invalid("subscription team_id metadata"))?;
    let owner_id = non_empty(&raw.metadata, OWNER_ID_METADATA_KEY).and_then(|owner| {
        macro_user_id::user_id::MacroUserIdStr::try_from(owner)
            .inspect_err(|_| {
                tracing::warn!(subscription_id = %raw.id, "subscription has an invalid owner_id");
            })
            .ok()
    });
    let plan_change_at = non_empty(&raw.metadata, PLAN_CHANGE_AT_METADATA_KEY)
        .and_then(|stamp| DateTime::parse_from_rfc3339(&stamp).ok())
        .map(|stamp| stamp.with_timezone(&Utc));
    let subscription_period = period(raw.current_period_start, raw.current_period_end);

    let items = item_facts(raw.items.data, subscription_period)?;

    Ok(SubscriptionFacts {
        id: raw.id,
        customer,
        status: raw.status,
        created: timestamp(raw.created)?,
        currency: raw.currency,
        team_id,
        owner_id,
        plan_change_at,
        attribution: Attribution {
            ga_client_id: non_empty(&raw.metadata, "ga_client_id"),
            fbp: non_empty(&raw.metadata, "fbp"),
            fbc: non_empty(&raw.metadata, "fbc"),
        },
        items,
        items_complete: raw.items.has_more == Some(false),
    })
}

/// Translates a subscription's items read page by page from the API. Those
/// reads carry no item period on older API versions, so `subscription_period`
/// fills it in.
pub fn subscription_items(
    items: &[Value],
    subscription_period: Option<Period>,
) -> Result<Vec<ItemFacts>, TranslateError> {
    let raw = Vec::<RawItem>::deserialize(Value::Array(items.to_vec()))
        .map_err(malformed("subscription items"))?;
    item_facts(raw, subscription_period)
}

fn item_facts(
    items: Vec<RawItem>,
    subscription_period: Option<Period>,
) -> Result<Vec<ItemFacts>, TranslateError> {
    items
        .into_iter()
        .map(|item| {
            // Newer API versions carry the period on each item; if an item
            // has either boundary, it must have both. Older ones carry it on
            // the subscription.
            let item_has_period =
                item.current_period_start.is_some() || item.current_period_end.is_some();
            let item_period = if item_has_period {
                period(item.current_period_start, item.current_period_end)
            } else {
                subscription_period
            };
            let computer_id = item
                .metadata
                .get(COMPUTER_ID_METADATA_KEY)
                .or_else(|| item.price.metadata.get(COMPUTER_ID_METADATA_KEY))
                .and_then(|id| {
                    Uuid::parse_str(id)
                        .inspect_err(|_| {
                            tracing::warn!(subscription_item = %item.id, "subscription item has an invalid computer id");
                        })
                        .ok()
                });
            let product = item
                .price
                .product
                .as_ref()
                .map(|product| product.id().parse::<ProductId>())
                .transpose()
                .map_err(|_| TranslateError::Invalid("price product"))?;
            let monthly = item.price.price_type.as_deref() == Some("recurring")
                && item.price.recurring.as_ref().is_some_and(|recurring| {
                    recurring.interval == "month" && recurring.interval_count == 1
                });
            Ok(ItemFacts {
                id: item.id,
                price: item.price.id,
                product,
                unit_amount: item.price.unit_amount,
                currency: item.price.currency,
                monthly,
                quantity: item.quantity,
                period: item_period,
                computer_id,
            })
        })
        .collect()
}

#[derive(Deserialize, Default)]
struct RawPrevious {
    status: Option<SubscriptionStatus>,
    items: Option<RawList<RawPreviousItem>>,
    current_period_start: Option<i64>,
    metadata: Option<HashMap<String, Option<String>>>,
}

#[derive(Deserialize)]
struct RawPreviousItem {
    id: SubscriptionItemId,
    price: Option<IdOrObject>,
    current_period_start: Option<i64>,
}

fn previous_attributes(previous: Option<&Value>) -> Result<PreviousAttributes, TranslateError> {
    let raw = match previous {
        None | Some(Value::Null) => RawPrevious::default(),
        Some(previous) => {
            RawPrevious::deserialize(previous).map_err(malformed("previous attributes"))?
        }
    };
    let items = raw
        .items
        .map(|items| {
            items
                .data
                .into_iter()
                .map(|item| {
                    let price = item
                        .price
                        .map(|price| price.id().parse::<PriceId>())
                        .transpose()
                        .map_err(|_| TranslateError::Invalid("previous item price"))?;
                    Ok(PreviousItem {
                        id: item.id,
                        price,
                        period_start: item
                            .current_period_start
                            .and_then(|start| DateTime::from_timestamp(start, 0)),
                    })
                })
                .collect::<Result<Vec<_>, TranslateError>>()
        })
        .transpose()?;
    Ok(PreviousAttributes {
        status: raw.status,
        items,
        period_start: raw
            .current_period_start
            .and_then(|start| DateTime::from_timestamp(start, 0)),
        plan_change_stamped: raw
            .metadata
            .is_some_and(|metadata| metadata.contains_key(PLAN_CHANGE_AT_METADATA_KEY)),
    })
}

#[derive(Deserialize)]
struct RawInvoice {
    id: InvoiceId,
    customer: Option<IdOrObject>,
    subscription: Option<IdOrObject>,
    parent: Option<RawInvoiceParent>,
    status: Option<String>,
    billing_reason: Option<String>,
    #[serde(default)]
    metadata: Option<HashMap<String, String>>,
    lines: RawList<RawInvoiceLine>,
}

#[derive(Deserialize)]
struct RawInvoiceParent {
    subscription_details: Option<RawSubscriptionDetails>,
}

#[derive(Deserialize)]
struct RawSubscriptionDetails {
    subscription: Option<IdOrObject>,
}

#[derive(Deserialize)]
struct RawInvoiceLine {
    subscription_item: Option<IdOrObject>,
    price: Option<IdOrObject>,
    proration: Option<bool>,
    parent: Option<RawLineParent>,
    pricing: Option<RawLinePricing>,
    period: Option<RawLinePeriod>,
}

#[derive(Deserialize)]
struct RawLineParent {
    subscription_item_details: Option<RawSubscriptionItemDetails>,
}

#[derive(Deserialize)]
struct RawSubscriptionItemDetails {
    subscription_item: Option<IdOrObject>,
    proration: Option<bool>,
}

#[derive(Deserialize)]
struct RawLinePricing {
    price_details: Option<RawPriceDetails>,
}

#[derive(Deserialize)]
struct RawPriceDetails {
    price: Option<IdOrObject>,
}

#[derive(Deserialize)]
struct RawLinePeriod {
    start: Option<i64>,
    end: Option<i64>,
}

fn invoice_facts(object: &Value, paid: bool) -> Result<InvoiceFacts, TranslateError> {
    let raw = RawInvoice::deserialize(object).map_err(malformed("invoice"))?;
    let customer = raw
        .customer
        .map(|customer| customer.id().parse::<CustomerId>())
        .transpose()
        .map_err(|_| TranslateError::Invalid("invoice customer"))?;
    // Newer API versions moved the subscription under `parent`.
    let subscription = raw
        .subscription
        .or_else(|| raw.parent?.subscription_details?.subscription)
        .map(|subscription| subscription.id().parse::<SubscriptionId>())
        .transpose()
        .map_err(|_| TranslateError::Invalid("invoice subscription"))?;
    let lines = raw
        .lines
        .data
        .into_iter()
        .map(|line| {
            let details = line
                .parent
                .and_then(|parent| parent.subscription_item_details);
            let (detail_item, detail_proration) = match details {
                Some(details) => (details.subscription_item, details.proration),
                None => (None, None),
            };
            let item = line
                .subscription_item
                .or(detail_item)
                .map(|item| item.id().parse::<SubscriptionItemId>())
                .transpose()
                .map_err(|_| TranslateError::Invalid("invoice line item"))?;
            let price = line
                .price
                .or_else(|| line.pricing?.price_details?.price)
                .map(|price| price.id().parse::<PriceId>())
                .transpose()
                .map_err(|_| TranslateError::Invalid("invoice line price"))?;
            Ok(InvoiceLine {
                item,
                price,
                proration: line.proration.or(detail_proration),
                period: line
                    .period
                    .and_then(|line_period| period(line_period.start, line_period.end)),
            })
        })
        .collect::<Result<Vec<_>, TranslateError>>()?;

    Ok(InvoiceFacts {
        id: raw.id,
        customer,
        subscription,
        paid,
        status: raw.status,
        billing_reason: raw.billing_reason,
        metadata: raw.metadata.unwrap_or_default(),
        lines,
        lines_complete: raw.lines.has_more == Some(false),
    })
}

#[derive(Deserialize)]
struct RawCheckout {
    id: CheckoutSessionId,
    payment_status: Option<String>,
    amount_total: Option<i64>,
    #[serde(default)]
    metadata: Option<HashMap<String, String>>,
}

fn checkout_facts(object: &Value) -> Result<CheckoutFacts, TranslateError> {
    let raw = RawCheckout::deserialize(object).map_err(malformed("checkout session"))?;
    Ok(CheckoutFacts {
        id: raw.id,
        paid: raw.payment_status.as_deref() == Some("paid"),
        amount_total: raw.amount_total,
        metadata: raw.metadata.unwrap_or_default(),
    })
}

/// An event as Stripe's event list returns it, read only for the audit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListedEvent {
    /// The event.
    pub id: EventId,
    /// Its raw type.
    pub type_name: String,
    /// Its `created` time.
    pub created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct RawListedEvent {
    id: EventId,
    #[serde(rename = "type")]
    type_name: String,
    created: i64,
}

/// Reads one entry of Stripe's event list.
pub fn listed_event(event: &Value) -> Result<ListedEvent, TranslateError> {
    let raw = RawListedEvent::deserialize(event).map_err(malformed("listed event"))?;
    Ok(ListedEvent {
        id: raw.id,
        type_name: raw.type_name,
        created_at: timestamp(raw.created)?,
    })
}

#[derive(Deserialize)]
struct RawCustomer {
    id: CustomerId,
    email: Option<String>,
    #[serde(default)]
    deleted: bool,
}

/// Translates one customer, from an event payload or an API read.
pub fn customer_facts(object: &Value, deleted: bool) -> Result<CustomerFacts, TranslateError> {
    let raw = RawCustomer::deserialize(object).map_err(malformed("customer"))?;
    Ok(CustomerFacts {
        id: raw.id,
        email: raw.email.filter(|email| !email.is_empty()),
        deleted: deleted || raw.deleted,
    })
}
