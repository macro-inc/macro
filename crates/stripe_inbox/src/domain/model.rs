//! What the inbox stores, orders by, and hands to consumers.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use stripe::{
    CheckoutSessionId, CustomerId, EventId, InvoiceId, PriceId, ProductId, SubscriptionId,
    SubscriptionItemId, SubscriptionStatus,
};
use uuid::Uuid;

/// An in-process consumer of Stripe events. Each keeps its own cursor per
/// [`OrderingKey`], so one failing consumer never holds back another.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    strum::Display,
    strum::EnumString,
    strum::AsRefStr,
    strum::EnumIter,
)]
#[strum(serialize_all = "snake_case")]
pub enum Consumer {
    /// Personal plan roles and tier, `has_trialed`, billing period, AI plan
    /// changes and the duplicate-subscription guard.
    PersonalPlan,
    /// Team subscription id, member permissions, `paying`, billing period
    /// and usage policy.
    TeamSubscription,
    /// AI overage and credit reload invoices, and credit checkouts.
    AiCredits,
    /// Macro computers billed as team subscription items.
    Computers,
    /// GA, Meta and PostHog subscription conversions.
    Analytics,
    /// GTM invite link conversions.
    Gtm,
}

impl Consumer {
    /// The event types this consumer applies. Any other event leaves its
    /// cursor untouched.
    pub fn event_types(self) -> &'static [EventType] {
        match self {
            Self::PersonalPlan | Self::TeamSubscription => &SUBSCRIPTION_AND_INVOICE_EVENTS,
            Self::AiCredits => &INVOICE_AND_CHECKOUT_EVENTS,
            Self::Computers | Self::Analytics | Self::Gtm => &SUBSCRIPTION_EVENTS,
        }
    }

    /// Whether only the newest snapshot of a subscription matters to this
    /// consumer, so an older snapshot already superseded by a received one
    /// is skipped. Consumers that react to a change itself (an upgrade, a
    /// first activation) apply every snapshot in order instead.
    pub fn acts_on_latest_snapshot(self) -> bool {
        match self {
            Self::Computers | Self::Gtm => true,
            Self::PersonalPlan | Self::TeamSubscription | Self::AiCredits | Self::Analytics => {
                false
            }
        }
    }

    /// Whether this consumer reads every subscription of the event's
    /// customer, not only the one the event names.
    pub fn reads_customer_subscriptions(self) -> bool {
        match self {
            Self::PersonalPlan | Self::Analytics => true,
            Self::TeamSubscription | Self::AiCredits | Self::Computers | Self::Gtm => false,
        }
    }

    /// Whether this consumer acts on invoices of subscriptions, so it needs
    /// the invoice's subscription snapshot.
    pub fn reads_invoice_subscription(self) -> bool {
        match self {
            Self::PersonalPlan | Self::TeamSubscription => true,
            Self::AiCredits | Self::Computers | Self::Analytics | Self::Gtm => false,
        }
    }

    /// Whether this consumer needs every item of a subscription, paging
    /// past the ten a snapshot carries.
    pub fn needs_every_item(self) -> bool {
        match self {
            Self::Computers => true,
            Self::PersonalPlan
            | Self::TeamSubscription
            | Self::AiCredits
            | Self::Analytics
            | Self::Gtm => false,
        }
    }
}

const SUBSCRIPTION_EVENTS: [EventType; 5] = [
    EventType::CustomerSubscriptionCreated,
    EventType::CustomerSubscriptionUpdated,
    EventType::CustomerSubscriptionDeleted,
    EventType::CustomerSubscriptionPaused,
    EventType::CustomerSubscriptionResumed,
];

const SUBSCRIPTION_AND_INVOICE_EVENTS: [EventType; 8] = [
    EventType::CustomerSubscriptionCreated,
    EventType::CustomerSubscriptionUpdated,
    EventType::CustomerSubscriptionDeleted,
    EventType::CustomerSubscriptionPaused,
    EventType::CustomerSubscriptionResumed,
    EventType::InvoicePaid,
    EventType::InvoicePaymentSucceeded,
    EventType::InvoicePaymentFailed,
];

const INVOICE_AND_CHECKOUT_EVENTS: [EventType; 5] = [
    EventType::InvoicePaid,
    EventType::InvoicePaymentSucceeded,
    EventType::InvoicePaymentFailed,
    EventType::CheckoutSessionCompleted,
    EventType::CheckoutSessionAsyncPaymentSucceeded,
];

/// The Stripe event types the inbox understands. Every other type is still
/// stored (so the audit can see it) but has no consumer.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, strum::Display, strum::EnumString, strum::AsRefStr,
)]
pub enum EventType {
    /// `customer.subscription.created`
    #[strum(serialize = "customer.subscription.created")]
    CustomerSubscriptionCreated,
    /// `customer.subscription.updated`
    #[strum(serialize = "customer.subscription.updated")]
    CustomerSubscriptionUpdated,
    /// `customer.subscription.deleted`
    #[strum(serialize = "customer.subscription.deleted")]
    CustomerSubscriptionDeleted,
    /// `customer.subscription.paused`
    #[strum(serialize = "customer.subscription.paused")]
    CustomerSubscriptionPaused,
    /// `customer.subscription.resumed`
    #[strum(serialize = "customer.subscription.resumed")]
    CustomerSubscriptionResumed,
    /// `invoice.paid`
    #[strum(serialize = "invoice.paid")]
    InvoicePaid,
    /// `invoice.payment_succeeded`, the same fact as `invoice.paid`.
    #[strum(serialize = "invoice.payment_succeeded")]
    InvoicePaymentSucceeded,
    /// `invoice.payment_failed`
    #[strum(serialize = "invoice.payment_failed")]
    InvoicePaymentFailed,
    /// `checkout.session.completed`
    #[strum(serialize = "checkout.session.completed")]
    CheckoutSessionCompleted,
    /// `checkout.session.async_payment_succeeded`
    #[strum(serialize = "checkout.session.async_payment_succeeded")]
    CheckoutSessionAsyncPaymentSucceeded,
    /// `customer.updated`; projected only.
    #[strum(serialize = "customer.updated")]
    CustomerUpdated,
    /// `customer.deleted`; projected only.
    #[strum(serialize = "customer.deleted")]
    CustomerDeleted,
}

impl EventType {
    /// Whether this event reports an invoice as paid.
    pub fn is_invoice_paid(self) -> bool {
        matches!(self, Self::InvoicePaid | Self::InvoicePaymentSucceeded)
    }

    /// The consumers that apply this event type.
    pub fn consumers(self) -> Vec<Consumer> {
        <Consumer as strum::IntoEnumIterator>::iter()
            .filter(|consumer| consumer.event_types().contains(&self))
            .collect()
    }
}

/// What orders events: the Stripe customer, so all of one customer's
/// subscriptions, invoices and checkouts apply in order. An event naming no
/// customer is ordered by its own object id.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct OrderingKey(pub String);

impl std::fmt::Display for OrderingKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// A place in one ordering key's event sequence: `(created, id)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Position {
    /// The event's `created` time.
    pub at: DateTime<Utc>,
    /// Breaks ties inside one second.
    pub event_id: EventId,
}

/// The kind of Stripe object the inbox keeps a snapshot of.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::Display, strum::EnumString, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum ObjectKind {
    /// A subscription.
    Subscription,
    /// A customer.
    Customer,
}

/// The newest snapshot of one Stripe object, to store in the projection.
#[derive(Debug, Clone, PartialEq)]
pub struct ObjectSnapshot {
    /// `sub_…` or `cus_…`.
    pub id: String,
    /// Which kind of object.
    pub kind: ObjectKind,
    /// The customer that owns it (its own id for a customer).
    pub customer: Option<String>,
    /// The object as Stripe sent it.
    pub snapshot: serde_json::Value,
    /// Whether Stripe deleted the object.
    pub deleted: bool,
}

/// A verified event, parsed just enough to store and order it.
#[derive(Debug, Clone, PartialEq)]
pub struct ReceivedEvent {
    /// `evt_…`; the dedupe key.
    pub id: EventId,
    /// The raw type; [`EventType`] when the inbox understands it.
    pub type_name: String,
    /// The API version the payload is rendered in.
    pub api_version: String,
    /// Whether this is a live-mode event.
    pub livemode: bool,
    /// The event's `created` time.
    pub created_at: DateTime<Utc>,
    /// The ordering key.
    pub ordering_key: OrderingKey,
    /// The id of `data.object`.
    pub object_id: String,
    /// The snapshot to project, for subscription and customer events.
    pub projection: Option<ObjectSnapshot>,
    /// The verified body.
    pub payload: serde_json::Value,
}

impl ReceivedEvent {
    /// The event type, when the inbox understands it.
    pub fn event_type(&self) -> Option<EventType> {
        self.type_name.parse().ok()
    }
}

/// A stored event, as the worker loads it.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredEvent {
    /// `evt_…`.
    pub id: EventId,
    /// The event type.
    pub event_type: EventType,
    /// The event's `created` time.
    pub created_at: DateTime<Utc>,
    /// When the webhook stored it.
    pub received_at: DateTime<Utc>,
    /// The id of `data.object`.
    pub object_id: String,
    /// The verified body; `None` once retention cleared it.
    pub payload: Option<serde_json::Value>,
    /// The webhook span's W3C context.
    pub traceparent: Option<String>,
}

impl StoredEvent {
    /// Where this event sits in its key's sequence.
    pub fn position(&self) -> Position {
        Position {
            at: self.created_at,
            event_id: self.id.clone(),
        }
    }
}

/// A leased `(consumer, key)` cursor.
#[derive(Debug, Clone, PartialEq)]
pub struct ClaimedCursor {
    /// The consumer.
    pub consumer: Consumer,
    /// The ordering key.
    pub key: OrderingKey,
    /// The last applied event; `None` before the first.
    pub applied: Option<Position>,
    /// Failed attempts at the next event so far.
    pub attempts: u32,
    /// Bumped by every received event; release compares it to tell whether
    /// an event arrived during the lease.
    pub generation: i64,
    /// When the cursor became due.
    pub due_at: DateTime<Utc>,
}

/// A subscription's current billing period.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Period {
    /// Period start.
    pub start: DateTime<Utc>,
    /// Period end, after `start`.
    pub end: DateTime<Utc>,
}

/// Marketing attribution ids the checkout stamped on a subscription.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Attribution {
    /// GA client id.
    pub ga_client_id: Option<String>,
    /// Meta browser id.
    pub fbp: Option<String>,
    /// Meta click id.
    pub fbc: Option<String>,
}

/// One subscription item, in either API version's shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemFacts {
    /// The item.
    pub id: SubscriptionItemId,
    /// Its price.
    pub price: PriceId,
    /// The price's product.
    pub product: Option<ProductId>,
    /// Undiscounted price in the currency's smallest unit.
    pub unit_amount: Option<i64>,
    /// The price's currency.
    pub currency: Option<String>,
    /// Recurring monthly (interval month, count 1).
    pub monthly: bool,
    /// Seats or units.
    pub quantity: Option<u64>,
    /// The item's period, or the subscription's on older API versions.
    pub period: Option<Period>,
    /// The `computer_id` on the item's or its price's metadata.
    pub computer_id: Option<Uuid>,
}

/// One subscription, typed. Both the webhook payload and API reads become
/// this; nothing else reads a subscription's JSON.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubscriptionFacts {
    /// The subscription.
    pub id: SubscriptionId,
    /// Its customer.
    pub customer: CustomerId,
    /// Its status.
    pub status: SubscriptionStatus,
    /// When it was created.
    pub created: DateTime<Utc>,
    /// Its currency.
    pub currency: Option<String>,
    /// The `team_id` metadata: set for team subscriptions.
    pub team_id: Option<Uuid>,
    /// The `owner_id` metadata of a team subscription.
    pub owner_id: Option<macro_user_id::user_id::MacroUserIdStr<'static>>,
    /// The `macro_plan_change_at` metadata Macro stamps on an immediate plan change.
    pub plan_change_at: Option<DateTime<Utc>>,
    /// Marketing attribution.
    pub attribution: Attribution,
    /// Its items.
    pub items: Vec<ItemFacts>,
    /// Whether `items` holds every item.
    pub items_complete: bool,
}

impl SubscriptionFacts {
    /// Whether the subscription grants access.
    pub fn is_live(&self) -> bool {
        matches!(
            self.status,
            SubscriptionStatus::Active | SubscriptionStatus::Trialing
        )
    }

    /// The recurring value, in the currency's smallest unit, when positive.
    pub fn value_cents(&self) -> Option<i64> {
        let value: i64 = self
            .items
            .iter()
            .filter_map(|item| {
                let quantity = i64::try_from(item.quantity.unwrap_or(1)).ok()?;
                item.unit_amount?.checked_mul(quantity)
            })
            .sum();
        (value > 0).then_some(value)
    }
}

/// How a subscription event changed it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubscriptionEventKind {
    /// `customer.subscription.created`
    Created,
    /// `customer.subscription.updated`
    Updated,
    /// `customer.subscription.deleted`
    Deleted,
    /// `customer.subscription.paused`
    Paused,
    /// `customer.subscription.resumed`
    Resumed,
}

/// One item's values before an update.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviousItem {
    /// The item.
    pub id: SubscriptionItemId,
    /// Its price before the update.
    pub price: Option<PriceId>,
    /// Its period start before the update.
    pub period_start: Option<DateTime<Utc>>,
}

/// `previous_attributes` of a subscription update, typed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PreviousAttributes {
    /// The status before the update.
    pub status: Option<SubscriptionStatus>,
    /// Items before the update, when they changed.
    pub items: Option<Vec<PreviousItem>>,
    /// The subscription-level period start before the update.
    pub period_start: Option<DateTime<Utc>>,
    /// Whether the update set `macro_plan_change_at`.
    pub plan_change_stamped: bool,
}

/// A subscription snapshot event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubscriptionChange {
    /// Which event.
    pub kind: SubscriptionEventKind,
    /// The subscription as of the event.
    pub subscription: SubscriptionFacts,
    /// What the update changed.
    pub previous: PreviousAttributes,
}

impl SubscriptionChange {
    /// Whether this event is the subscription starting: its creation, or its
    /// first payment moving it out of `incomplete`.
    pub fn is_new(&self) -> bool {
        match self.kind {
            SubscriptionEventKind::Created => true,
            SubscriptionEventKind::Updated => {
                self.previous.status == Some(SubscriptionStatus::Incomplete)
                    && self.subscription.is_live()
            }
            SubscriptionEventKind::Deleted
            | SubscriptionEventKind::Paused
            | SubscriptionEventKind::Resumed => false,
        }
    }

    /// Whether the subscription entered `trialing` with this event.
    pub fn started_trial(&self) -> bool {
        if self.subscription.status != SubscriptionStatus::Trialing {
            return false;
        }
        match self.kind {
            SubscriptionEventKind::Created => true,
            SubscriptionEventKind::Updated
            | SubscriptionEventKind::Deleted
            | SubscriptionEventKind::Paused
            | SubscriptionEventKind::Resumed => self
                .previous
                .status
                .is_some_and(|status| status != SubscriptionStatus::Trialing),
        }
    }
}

/// One invoice line, in either API version's shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvoiceLine {
    /// The subscription item it bills.
    pub item: Option<SubscriptionItemId>,
    /// The price it bills.
    pub price: Option<PriceId>,
    /// Whether it is a proration.
    pub proration: Option<bool>,
    /// The period it bills.
    pub period: Option<Period>,
}

/// What a paid invoice proves about a subscription item's period.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PeriodProof {
    /// Nothing beyond the snapshot.
    Snapshot,
    /// The first paid period of a new subscription.
    Initial,
    /// A paid renewal of exactly this item and period.
    Renewal,
}

/// An invoice payment outcome. `invoice.paid` and
/// `invoice.payment_succeeded` are the same fact.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvoiceFacts {
    /// The invoice.
    pub id: InvoiceId,
    /// Its customer.
    pub customer: Option<CustomerId>,
    /// The subscription it bills, if any.
    pub subscription: Option<SubscriptionId>,
    /// Paid, or a payment attempt failed.
    pub paid: bool,
    /// The invoice status.
    pub status: Option<String>,
    /// Why it was created (`subscription_cycle`, ...).
    pub billing_reason: Option<String>,
    /// Its metadata (Macro's own invoices carry `macro_purpose`).
    pub metadata: HashMap<String, String>,
    /// Its lines.
    pub lines: Vec<InvoiceLine>,
    /// Whether `lines` holds every line.
    pub lines_complete: bool,
}

impl InvoiceFacts {
    /// What this invoice proves about `item`'s period on `subscription`:
    /// only a complete, paid create or cycle invoice whose single matching
    /// non-proration line bills exactly that item, price and period.
    pub fn period_proof(&self, subscription: &SubscriptionFacts, item: &ItemFacts) -> PeriodProof {
        let Some(period) = item.period else {
            return PeriodProof::Snapshot;
        };
        if self.subscription.as_ref() != Some(&subscription.id)
            || self.customer.as_ref() != Some(&subscription.customer)
            || self.status.as_deref() != Some("paid")
            || !self.lines_complete
        {
            return PeriodProof::Snapshot;
        }
        let proof = match self.billing_reason.as_deref() {
            Some("subscription_create") => PeriodProof::Initial,
            Some("subscription_cycle") => PeriodProof::Renewal,
            _ => return PeriodProof::Snapshot,
        };
        let matching = self
            .lines
            .iter()
            .filter(|line| {
                line.item.as_ref() == Some(&item.id)
                    && line.price.as_ref() == Some(&item.price)
                    && line.proration == Some(false)
                    && line.period == Some(period)
            })
            .count();
        if matching == 1 {
            proof
        } else {
            PeriodProof::Snapshot
        }
    }
}

/// A checkout session that completed or whose delayed payment arrived.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckoutFacts {
    /// The session.
    pub id: CheckoutSessionId,
    /// Whether the money arrived.
    pub paid: bool,
    /// The session's total.
    pub amount_total: Option<i64>,
    /// Its metadata (credit purchases carry `macro_purpose` and the payer).
    pub metadata: HashMap<String, String>,
}

/// A translated event, typed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BillingInboxEvent {
    /// A subscription snapshot.
    Subscription(SubscriptionChange),
    /// An invoice outcome, with the newest snapshot held of its
    /// subscription.
    Invoice {
        /// The invoice.
        invoice: InvoiceFacts,
        /// Its subscription's newest snapshot.
        subscription: Option<SubscriptionFacts>,
    },
    /// A paid checkout.
    Checkout(CheckoutFacts),
}

/// One event as a consumer receives it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Delivery {
    /// The event id; consumers key Stripe idempotency on it.
    pub event_id: EventId,
    /// The event's `created` time.
    pub created_at: DateTime<Utc>,
    /// The typed event.
    pub event: BillingInboxEvent,
    /// The newest snapshot of every subscription of the event's customer,
    /// for consumers that [read them](Consumer::reads_customer_subscriptions).
    pub customer_subscriptions: Vec<SubscriptionFacts>,
}

/// Why a consumer could not apply an event.
#[derive(Debug, thiserror::Error)]
pub enum ApplyError {
    /// Worth retrying: a dependency failed.
    #[error("transient failure: {0}")]
    Retry(rootcause::Report),
    /// Never going to succeed as is (an unknown price, a bad id): dead-letter
    /// at once and page.
    #[error("rejected: {0}")]
    Reject(rootcause::Report),
}

/// The outcome of one apply, recorded on its span.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum ApplyOutcome {
    /// Applied.
    Applied,
    /// Skipped: superseded by a newer snapshot, or an invoice already paid.
    Skipped,
    /// Failed; will retry.
    Failed,
    /// Failed for good.
    DeadLettered,
}

/// A Stripe customer, as far as Macro needs one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomerFacts {
    /// The customer.
    pub id: CustomerId,
    /// Its billing email; never used to find a Macro account unless the
    /// customer maps to none.
    pub email: Option<String>,
    /// Whether Stripe deleted it.
    pub deleted: bool,
}
