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
    /// the invoice was one of ours.
    fn resolve_overage_invoice(
        &self,
        stripe_invoice_id: &str,
        status: OverageChargeStatus,
    ) -> impl Future<Output = Result<Option<MacroUserIdStr<'static>>>> + Send;
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

/// An overage chunk to collect.
#[derive(Debug, Clone)]
pub struct OverageChargeRequest {
    /// The payer's Stripe customer.
    pub customer_id: String,
    /// The reserved charge; doubles as the idempotency key.
    pub charge_id: Uuid,
    /// Amount, list-rate cents.
    pub amount_cents: i64,
    /// Line description shown on the invoice.
    pub description: String,
}

/// The result of collecting an overage chunk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OverageChargeReceipt {
    /// The Stripe invoice.
    pub invoice_id: String,
    /// Whether it was paid synchronously. When false the invoice stays open
    /// for Stripe's retries and the webhook reports the outcome.
    pub paid: bool,
}

/// The payment provider.
pub trait PaymentGateway: Send + Sync + 'static {
    /// Start a Checkout Session for a credit pack; returns the hosted URL.
    fn create_credit_checkout(
        &self,
        request: CreditCheckoutRequest,
    ) -> impl Future<Output = Result<String>> + Send;

    /// Invoice and collect an overage chunk.
    fn charge_overage(
        &self,
        request: OverageChargeRequest,
    ) -> impl Future<Output = Result<OverageChargeReceipt>> + Send;
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
