//! Ports: what the billing service needs from the outside world, and what it
//! offers inbound adapters.

use super::ledger::SettlementPolicy;
use super::models::{
    AllowanceDecision, BillingPeriod, BillingSettings, Entitlement, OverageChargeStatus,
    PeriodLedger, Result, UsageSnapshot,
};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

/// Resolves who a user is billed as.
pub trait EntitlementSource: Send + Sync + 'static {
    /// The user's plan, payer, and pooled seats.
    fn entitlement(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Entitlement>> + Send;

    /// The Stripe customer id on file for a user, if any.
    fn stripe_customer_id(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<String>>> + Send;
}

/// Reads recorded AI usage at Macro's list rate.
pub trait UsageReader: Send + Sync + 'static {
    /// Total list-rate cents used by `users` within `period`.
    fn list_rate_usage_cents(
        &self,
        users: &[MacroUserIdStr<'static>],
        period: BillingPeriod,
    ) -> impl Future<Output = Result<i64>> + Send;
}

/// A charge reserved in the ledger that still has to be collected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingCharge {
    /// The `ai_overage_charge` row.
    pub id: Uuid,
    /// Amount to collect, list-rate cents.
    pub amount_cents: i64,
    /// The Stripe invoice an earlier attempt opened for this charge, if any.
    /// A retry pays that invoice instead of opening a second one.
    pub stripe_invoice_id: Option<String>,
}

/// What a settlement booked.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SettlementOutcome {
    /// Credits consumed against the period.
    pub consumed_credits_cents: i64,
    /// An overage charge reserved for collection, if any.
    pub pending_charge: Option<PendingCharge>,
}

/// The billing tables.
pub trait BillingRepo: Send + Sync + 'static {
    /// The payer's settings (defaults when no row exists).
    fn settings(
        &self,
        payer: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<BillingSettings>> + Send;

    /// Set overage on/off and the cap. Clears any suspension.
    fn update_overage(
        &self,
        payer: &MacroUserIdStr<'_>,
        enabled: bool,
        limit_cents: i64,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Record the subscription period synced from Stripe.
    fn set_period(
        &self,
        payer: &MacroUserIdStr<'_>,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Pause overage after a failed collection.
    fn suspend_overage(
        &self,
        payer: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Lift a suspension (a later charge collected).
    fn clear_overage_suspension(
        &self,
        payer: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Current prepaid balance, list-rate cents.
    fn credit_balance_cents(
        &self,
        payer: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<i64>> + Send;

    /// What has been booked against a period.
    fn period_ledger(
        &self,
        payer: &MacroUserIdStr<'_>,
        period_start: DateTime<Utc>,
    ) -> impl Future<Output = Result<PeriodLedger>> + Send;

    /// Book a credit purchase. Returns `false` when `stripe_reference` was
    /// already booked (webhook retry).
    fn record_credit_purchase(
        &self,
        payer: &MacroUserIdStr<'_>,
        amount_cents: i64,
        stripe_reference: &str,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// Atomically settle a period: under the payer's row lock, re-read the
    /// ledger, run [`plan_settlement`](super::ledger::plan_settlement) with the
    /// stored overage settings, book credit consumption, and reserve a
    /// pending overage charge. `used_cents`/`included_cents` come from the
    /// caller; the overage policy is read inside the lock, with
    /// `charge_threshold_cents` and `period_ended` taken from `policy`.
    ///
    /// A charge that was reserved earlier but never collected is handed back
    /// before anything new is reserved, so retries reuse its id (and so its
    /// Stripe idempotency keys and invoice) rather than billing the same
    /// usage twice:
    ///
    /// - a `pending` charge with no invoice whose collection never finished
    ///   (the process died between reserving and opening the invoice);
    /// - a `failed` charge, once overage is active again and the plan would
    ///   charge at least its amount anyway. It flips back to `pending`. A
    ///   failed charge whose usage has since been covered another way (say
    ///   by a credit purchase) stays failed and is never retried.
    fn apply_settlement(
        &self,
        payer: &MacroUserIdStr<'_>,
        period_start: DateTime<Utc>,
        used_cents: i64,
        included_cents: i64,
        policy: SettlementPolicy,
    ) -> impl Future<Output = Result<SettlementOutcome>> + Send;

    /// Record the result of collecting a reserved charge.
    fn finish_overage_charge(
        &self,
        charge_id: Uuid,
        stripe_invoice_id: Option<&str>,
        status: OverageChargeStatus,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Update a charge by its Stripe invoice (webhook). Returns the payer when
    /// the invoice was one of ours *and* the status changed. `Paid` is
    /// terminal: a late or duplicate failure event never un-pays a charge, and
    /// re-reporting the current status is a no-op.
    fn resolve_overage_invoice(
        &self,
        stripe_invoice_id: &str,
        status: OverageChargeStatus,
    ) -> impl Future<Output = Result<Option<MacroUserIdStr<'static>>>> + Send;

    /// The status of the payer's most recently reserved charge, if any. The
    /// newest outcome is what decides whether overage stays suspended; older
    /// invoices' webhooks may arrive out of order.
    fn latest_charge_status(
        &self,
        payer: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<OverageChargeStatus>>> + Send;
}

/// A one-off credit purchase to start.
#[derive(Debug, Clone)]
pub struct CreditCheckoutRequest {
    /// The payer's Stripe customer.
    pub customer_id: String,
    /// The payer, stamped on the session so the webhook can book it.
    pub payer: MacroUserIdStr<'static>,
    /// Pack size, list-rate cents.
    pub amount_cents: i64,
    /// Where Stripe returns the user after paying.
    pub success_url: String,
    /// Where Stripe returns the user on cancel.
    pub cancel_url: String,
}

/// An overage chunk to invoice.
#[derive(Debug, Clone)]
pub struct OverageChargeRequest {
    /// The payer's Stripe customer.
    pub customer_id: String,
    /// The reserved charge; doubles as the idempotency key, so opening the
    /// same charge twice yields the same invoice.
    pub charge_id: Uuid,
    /// Amount, list-rate cents.
    pub amount_cents: i64,
    /// Line description shown on the invoice.
    pub description: String,
}

/// The payment provider.
pub trait PaymentGateway: Send + Sync + 'static {
    /// Start a Checkout Session for a credit pack; returns the hosted URL.
    fn create_credit_checkout(
        &self,
        request: CreditCheckoutRequest,
    ) -> impl Future<Output = Result<String>> + Send;

    /// Open a finalized invoice for exactly this overage chunk (and nothing
    /// else pending on the customer). Returns the invoice id. Idempotent on
    /// `charge_id`.
    fn open_overage_invoice(
        &self,
        request: OverageChargeRequest,
    ) -> impl Future<Output = Result<String>> + Send;

    /// Attempt to collect an open overage invoice now. `Ok(true)` when it is
    /// paid, `Ok(false)` when the card was declined and the invoice stays
    /// open for Stripe's own retries (the webhook reports the outcome), `Err`
    /// when the provider could not be reached or rejected the request.
    fn pay_overage_invoice(
        &self,
        charge_id: Uuid,
        invoice_id: &str,
    ) -> impl Future<Output = Result<bool>> + Send;
}

/// Asks whoever owns Stripe to settle a payer. Fire-and-forget: services that
/// only read billing state (the gate in DCS) use this instead of settling.
pub trait SettlementTrigger: Send + Sync + 'static {
    /// Request settlement for `payer`.
    fn request_settlement(&self, payer: MacroUserIdStr<'static>);
}

/// A [`SettlementTrigger`] that does nothing, for services that settle
/// in-process or never need to.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoOpSettlementTrigger;

impl SettlementTrigger for NoOpSettlementTrigger {
    fn request_settlement(&self, _payer: MacroUserIdStr<'static>) {}
}

/// The use cases offered to inbound adapters and other services.
pub trait BillingService: Send + Sync + 'static {
    /// May `user` start another AI request?
    ///
    /// Admission is a read of the position at this instant; usage is
    /// metered after the completion, so requests that are in flight together
    /// can each be admitted against the same headroom. The overshoot is
    /// bounded by one completion per concurrent request, is billed at list
    /// rate like everything else, and can only exceed the payer's overage cap
    /// by that much. Reserving capacity per request would need a second
    /// ledger write on every completion; the gate deliberately does not.
    fn check_allowance(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<AllowanceDecision>> + Send;

    /// The user's current-period position.
    fn snapshot(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<UsageSnapshot>> + Send;

    /// Book uncovered usage for the payer of `user` (previous and current
    /// period) from credits and then overage, collecting overage via the
    /// payment gateway.
    fn settle(&self, user: &MacroUserIdStr<'_>) -> impl Future<Output = Result<()>> + Send;

    /// Turn overage on/off with a per-period cap. Payer only. Re-enabling
    /// retries collection.
    fn update_overage(
        &self,
        user: &MacroUserIdStr<'_>,
        enabled: bool,
        limit_cents: i64,
    ) -> impl Future<Output = Result<UsageSnapshot>> + Send;

    /// Start a credit-pack purchase. Payer only. Returns the Checkout URL.
    fn create_credit_checkout(
        &self,
        user: &MacroUserIdStr<'_>,
        amount_cents: i64,
        success_url: String,
        cancel_url: String,
    ) -> impl Future<Output = Result<String>> + Send;

    /// Book a completed credit purchase (webhook). Idempotent on
    /// `stripe_reference`.
    fn apply_credit_purchase(
        &self,
        payer: &MacroUserIdStr<'_>,
        amount_cents: i64,
        stripe_reference: &str,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Record the payer's subscription period (webhook).
    fn sync_period(
        &self,
        payer: &MacroUserIdStr<'_>,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Record the outcome of an overage invoice (webhook). Unknown invoices
    /// are ignored.
    fn mark_overage_invoice(
        &self,
        stripe_invoice_id: &str,
        paid: bool,
    ) -> impl Future<Output = Result<()>> + Send;
}
