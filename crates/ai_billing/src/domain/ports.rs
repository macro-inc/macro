//! Ports: what the billing service needs from the outside world, and what it
//! offers inbound adapters.

use super::financial::FundingPeriod;
use super::ledger::SettlementPolicy;
use super::models::{
    AllowanceDecision, AllowanceStore, AutoReloadThresholds, BillingPeriod, BillingSettings,
    CreditReloadStatus, Entitlement, InvoiceOutcome, OpenPeriodStart, OverageChargeStatus,
    PaymentAction, PaymentActionKind, PeriodAllowance, PeriodLedger, Result, SeatAllowance,
    SeatGeneration, SeatUsage, SubscriptionScope, UsageSnapshot,
};
use super::policy::UsageAllocation;
use ai_usage::domain::financial::{
    BeginInvocation, FundingAuthorization, InvocationId, InvocationRecord, PendingInvocations,
    RateSnapshot,
};
use ai_usage::domain::ports::FinancialFuture;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

/// Durable V1 funding transactions. All mutations serialize on the existing payer
/// account row, including legacy settlement, settings and credit purchases. Replays
/// compare immutable request/rate/authorization/evidence facts before returning success.
pub trait FundingRepo: Send + Sync + 'static {
    /// Resolve the recorded seat policy at occurrence time, never today's role/catalog.
    fn period(
        &self,
        seat: MacroUserIdStr<'static>,
        at: DateTime<Utc>,
    ) -> FinancialFuture<'_, Option<FundingPeriod>>;
    /// Insert immutable verified facts. Reject overlapping or contradictory bindings.
    fn record_period(&self, period: FundingPeriod) -> FinancialFuture<'_, ()>;
    /// Reserve the entire execution ceiling before acknowledging authorization.
    /// Funding denials are durable for this identity: later purchases/settings require
    /// a new attempt ID, never retroactive authorization of blocked history.
    fn authorize(
        &self,
        request: BeginInvocation,
        rate: RateSnapshot,
    ) -> FinancialFuture<'_, FundingAuthorization>;
    /// Persist handoff once, then allocate in payer sequence, not completion order.
    fn finalize(&self, record: InvocationRecord) -> FinancialFuture<'_, ()>;
    /// Read recorded source consumption, never recalculate from current settings.
    fn allocation(&self, id: InvocationId) -> FinancialFuture<'_, Option<UsageAllocation>>;
    /// Discover unresolved and ready-but-unallocated work, including old periods.
    fn pending(&self, query: PendingInvocations) -> FinancialFuture<'_, Vec<InvocationId>>;
    /// Process a bounded prefix at the allocation watermark; unresolved work retains holds.
    fn reconcile(&self, payer: MacroUserIdStr<'static>) -> FinancialFuture<'_, ()>;
}

/// Resolves who a user is billed as.
pub trait EntitlementSource: Send + Sync + 'static {
    /// The user's plan, payer, and billed seats.
    fn entitlement(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Entitlement>> + Send;

    /// The Stripe customer id on file for a user, if any.
    fn stripe_customer_id(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<String>>> + Send;

    /// The payer for `team_id`, if the team exists.
    ///
    /// Missing teams are `Ok(None)`. The payer is the team owner.
    fn team_payer(
        &self,
        team_id: Uuid,
    ) -> impl Future<Output = Result<Option<MacroUserIdStr<'static>>>> + Send;
}

/// Reads recorded, metered AI usage at provider cost.
pub trait UsageReader: Send + Sync + 'static {
    /// Usage in cost cents for each of `users` within `period`.
    ///
    /// Only rows with the persisted `count_usage = TRUE` decision consume a user's
    /// allowance, credits, or overage. Historical and uncounted rows remain available
    /// for cost tracking. The period is inclusive at the start and exclusive at the end;
    /// users with no counted rows are omitted, and an empty user list returns no rows.
    fn usage_cost_cents_by_user(
        &self,
        users: &[MacroUserIdStr<'static>],
        period: BillingPeriod,
    ) -> impl Future<Output = Result<Vec<SeatUsage>>> + Send;
}

/// A charge reserved in the ledger that still has to be collected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingCharge {
    /// The `ai_overage_charge` row.
    pub id: Uuid,
    /// Amount to collect, customer cents.
    pub amount_cents: i64,
    /// The Stripe invoice an earlier attempt opened for this charge, if any.
    /// A retry pays that invoice instead of opening a second one.
    pub stripe_invoice_id: Option<String>,
}

/// An automatic credit reload reserved in the ledger that still has to be
/// collected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingReload {
    /// The `ai_credit_reload` row.
    pub id: Uuid,
    /// Amount to collect and then book as credits, customer cents.
    pub amount_cents: i64,
    /// The Stripe invoice an earlier attempt opened for this reload, if any.
    /// A retry pays that invoice instead of opening a second one.
    pub stripe_invoice_id: Option<String>,
}

/// A credit reload whose Stripe invoice outcome just changed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedReload {
    /// Who the credits belong to.
    pub payer: MacroUserIdStr<'static>,
    /// Amount collected (or not), customer cents.
    pub amount_cents: i64,
}

/// One of this crate's invoices that Stripe has not conclusively reported on
/// for a while: a webhook may have been lost or ignored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaleInvoice {
    /// Which table the row lives in.
    pub kind: PaymentActionKind,
    /// The Stripe invoice to read.
    pub stripe_invoice_id: String,
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
    /// Exclude recorded V1 seats from legacy analytics/settlement for this period.
    /// A mixed-policy payer must retain only its legacy seats on this path.
    fn legacy_seats(
        &self,
        payer: &MacroUserIdStr<'_>,
        period: BillingPeriod,
        seats: Vec<SeatAllowance>,
    ) -> impl Future<Output = Result<Vec<SeatAllowance>>> + Send;

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

    /// Record the legacy subscription anchor synced from Stripe. A correction
    /// to the current start's end is allowed; older/overlapping starts cannot
    /// replace it. This does not rewrite allowance or financial period history.
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

    /// Current prepaid balance, customer cents.
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

    /// The allowance last observed for this payer while `period_start` was
    /// the open period, if any.
    fn period_allowance(
        &self,
        payer: &MacroUserIdStr<'_>,
        period_start: DateTime<Utc>,
    ) -> impl Future<Output = Result<Option<PeriodAllowance>>> + Send;

    /// Starts of the periods frozen for this payer that began at or after
    /// `since` and before `before`, oldest first.
    ///
    /// A frozen period is one that was observed while open, so it is keyed
    /// exactly as the ledger entries and charges booked against it. These are
    /// the closed periods settlement can still reconcile without inventing a
    /// period start.
    fn frozen_period_starts(
        &self,
        payer: &MacroUserIdStr<'_>,
        since: DateTime<Utc>,
        before: DateTime<Utc>,
    ) -> impl Future<Output = Result<Vec<DateTime<Utc>>>> + Send;

    /// Record each seat's allowance for the open period when `observed` is still
    /// the payer's seat generation.
    ///
    /// Returns [`AllowanceStore::Conflict`] when the generation moved, without
    /// writing the arrays. An unchanged roster does not touch `updated_at`.
    fn store_open_allowance(
        &self,
        payer: &MacroUserIdStr<'_>,
        period: OpenPeriodStart,
        seats: &[SeatAllowance],
        observed: SeatGeneration,
    ) -> impl Future<Output = Result<AllowanceStore>> + Send;

    /// Remove `member` and the paired included cents from the payer's open period.
    ///
    /// A missing allowance row, or a row that does not contain `member`, is
    /// success and does not change that row. The payer's seat generation still
    /// moves forward, including when no allowance row exists.
    fn release_open_seat(
        &self,
        payer: &MacroUserIdStr<'_>,
        period: OpenPeriodStart,
        member: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<()>> + Send;

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
    /// pending overage charge. `chargeable_customer_cents` is the period's
    /// cumulative usage beyond each seat's own allowance, already converted to
    /// customer cents at the overage markup
    /// ([`extra_customer_cents`](super::pricing::extra_customer_cents)). The
    /// overage policy is read inside the lock, with `charge_threshold_cents` and
    /// `period_ended` taken from `policy`.
    ///
    /// When `policy.overage_active` is false, neither new nor historical charges
    /// are returned. The service always selects this credit-only policy.
    /// A legacy charge that was reserved earlier but never collected is handed back
    /// before anything new is reserved, so retries reuse its id (and so its
    /// Stripe idempotency keys and invoice) rather than billing the same
    /// usage twice:
    ///
    /// - a `pending` charge with no invoice whose collection never finished
    ///   (the process died between reserving and opening the invoice);
    /// - a `failed` charge with a Stripe invoice, once overage is active
    ///   again. It remains ledger coverage because Stripe may still collect
    ///   it, so later credits do not replace it with a smaller charge;
    /// - a `failed` charge without a Stripe invoice, once overage is active
    ///   and the plan would charge at least its amount anyway. A charge whose
    ///   usage has since been covered another way stays failed.
    fn apply_settlement(
        &self,
        payer: &MacroUserIdStr<'_>,
        period_start: DateTime<Utc>,
        chargeable_customer_cents: i64,
        policy: SettlementPolicy,
    ) -> impl Future<Output = Result<SettlementOutcome>> + Send;

    /// Record the result of collecting a reserved charge.
    fn finish_overage_charge(
        &self,
        charge_id: Uuid,
        stripe_invoice_id: Option<&str>,
        status: OverageChargeStatus,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Update a charge by its Stripe invoice (webhook, collector, or
    /// reconciliation). Returns the payer when the invoice was one of ours
    /// *and* [`OverageChargeStatus::accepts`] let the status move: a late or
    /// duplicate failure never un-pays a charge or revives a write-off, and
    /// re-reporting the current status is a no-op. An action-required report
    /// also stores the hosted invoice page.
    fn resolve_overage_invoice(
        &self,
        stripe_invoice_id: &str,
        outcome: &InvoiceOutcome,
    ) -> impl Future<Output = Result<Option<MacroUserIdStr<'static>>>> + Send;

    /// The status of the payer's most recently reserved charge, if any. The
    /// newest outcome is what decides whether overage stays suspended; older
    /// invoices' webhooks may arrive out of order.
    fn latest_charge_status(
        &self,
        payer: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<OverageChargeStatus>>> + Send;

    /// Set the stored reload opt-in and optionally its thresholds. The service
    /// supplies zero for the retired direct-charge cap.
    /// `None` thresholds keep the stored ones. Clears both the overage and the
    /// reload suspension.
    fn update_auto_reload(
        &self,
        payer: &MacroUserIdStr<'_>,
        enabled: bool,
        overage_limit_cents: i64,
        thresholds: Option<&AutoReloadThresholds>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Atomically decide whether to reload credits: under the payer's row
    /// lock, read the balance and the period ledger, run
    /// [`plan_reload`](super::ledger::plan_reload) with the stored thresholds
    /// against the usage `chargeable_customer_cents` that credits or charges
    /// have not yet covered, and reserve a pending reload. Reloads in the UTC
    /// calendar month containing `now` that Stripe may still collect (pending,
    /// paid, or failed with an invoice) count against the monthly limit.
    ///
    /// `None` unless [`BillingSettings::auto_reload_active`] holds. A reload
    /// reserved earlier whose collection never finished is handed back so the
    /// retry reuses its id, Stripe idempotency keys, and invoice: a pending
    /// reload with no invoice that went stale, or a failed or action-required
    /// reload whose invoice is still open (returned as pending again). Any
    /// other pending reload blocks a new one until Stripe resolves it; voided
    /// and uncollectible reloads never block or count.
    fn reserve_credit_reload(
        &self,
        payer: &MacroUserIdStr<'_>,
        period_start: DateTime<Utc>,
        chargeable_customer_cents: i64,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<Option<PendingReload>>> + Send;

    /// Record the result of collecting a reserved reload.
    fn finish_credit_reload(
        &self,
        reload_id: Uuid,
        stripe_invoice_id: Option<&str>,
        status: CreditReloadStatus,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Book a collected reload as purchased credits. Returns `false` when
    /// `stripe_invoice_id` was already booked (collector and webhook both
    /// reported it).
    fn record_credit_reload(
        &self,
        payer: &MacroUserIdStr<'_>,
        amount_cents: i64,
        stripe_invoice_id: &str,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// Update a reload by its Stripe invoice (webhook, collector, or
    /// reconciliation). Returns the payer and amount when the invoice was one
    /// of ours *and* [`CreditReloadStatus::accepts`] let the status move: a
    /// late or duplicate failure never un-pays a reload or revives a
    /// write-off, and re-reporting the current status is a no-op. A
    /// transition to `Paid` atomically books the purchased credits,
    /// deduplicated by invoice, so a failed credit write leaves the status
    /// retryable. An action-required report also stores the hosted invoice
    /// page.
    fn resolve_credit_reload_invoice(
        &self,
        stripe_invoice_id: &str,
        outcome: &InvoiceOutcome,
    ) -> impl Future<Output = Result<Option<ResolvedReload>>> + Send;

    /// Pause automatic reloads after a failed collection. Overage itself
    /// stays as it was.
    fn suspend_auto_reload(
        &self,
        payer: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Lift a reload suspension (a later reload collected). Overage itself
    /// stays as it was.
    fn clear_auto_reload_suspension(
        &self,
        payer: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// The status of the payer's most recently reserved reload, if any. Like
    /// [`latest_charge_status`](Self::latest_charge_status), the newest
    /// outcome decides whether reloads stay suspended.
    fn latest_reload_status(
        &self,
        payer: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<CreditReloadStatus>>> + Send;

    /// The payer's invoiced charges and reloads that Stripe may still collect
    /// (`pending`, `requires_action`, or `failed` with an invoice) and that
    /// have not changed since `before`. The webhook normally resolves these
    /// within seconds; one this old is read back from the provider.
    fn stale_invoices(
        &self,
        payer: &MacroUserIdStr<'_>,
        before: DateTime<Utc>,
    ) -> impl Future<Output = Result<Vec<StaleInvoice>>> + Send;

    /// The payer's newest charge or reload whose payment is waiting on them to
    /// authenticate it, if any.
    fn payment_action(
        &self,
        payer: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<PaymentAction>>> + Send;
}

/// A one-off credit purchase to start.
#[derive(Debug, Clone)]
pub struct CreditCheckoutRequest {
    /// The payer's Stripe customer.
    pub customer_id: String,
    /// The payer, stamped on the session so the webhook can book it.
    pub payer: MacroUserIdStr<'static>,
    /// Pack size, customer cents.
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
    /// Amount, customer cents.
    pub amount_cents: i64,
    /// Line description shown on the invoice.
    pub description: String,
    /// Which subscription pays this charge.
    pub scope: SubscriptionScope,
}

/// An automatic credit reload to invoice.
#[derive(Debug, Clone)]
pub struct CreditReloadRequest {
    /// The payer's Stripe customer.
    pub customer_id: String,
    /// The payer, stamped on the invoice so the webhook can book the credits.
    pub payer: MacroUserIdStr<'static>,
    /// The reserved reload; doubles as the idempotency key, so opening the
    /// same reload twice yields the same invoice.
    pub reload_id: Uuid,
    /// Amount, customer cents.
    pub amount_cents: i64,
    /// Line description shown on the invoice.
    pub description: String,
    /// Which subscription pays this reload.
    pub scope: SubscriptionScope,
}

/// The payment provider.
pub trait PaymentGateway: Send + Sync + 'static {
    /// Start a Checkout Session for a credit pack; returns the hosted URL.
    fn create_credit_checkout(
        &self,
        request: CreditCheckoutRequest,
    ) -> impl Future<Output = Result<String>> + Send;

    /// Retired direct usage billing capability. Adapters must reject opening
    /// these invoices without creating payment-provider objects.
    fn open_overage_invoice(
        &self,
        request: OverageChargeRequest,
    ) -> impl Future<Output = Result<String>> + Send;

    /// Open a finalized invoice for exactly this credit reload, excluding other
    /// pending items. [`CreditReloadRequest::scope`] selects the active or trialing
    /// subscription. Ambiguous routing fails. Missing subscription routing fails
    /// unless a retry finds an invoice with a stored payment method. Returns the invoice id;
    /// idempotent on `reload_id`.
    fn open_credit_reload_invoice(
        &self,
        request: CreditReloadRequest,
    ) -> impl Future<Output = Result<String>> + Send;

    /// Collect an automatic credit reload invoice. Historical direct usage
    /// invoices must be rejected. `charge_id` is the reload id and only keeps
    /// the idempotency key unique. `scope` is the
    /// payer's current subscription scope. A scope stamped on the invoice
    /// overrides it. Invoices without that stamp use `scope`. Distinct
    /// effective methods in the chosen scope fail with
    /// [`BillingError::Payment`](super::BillingError::Payment).
    /// If no active or trialing subscription matches, an invoice-stored
    /// payment method may still collect the existing debt.
    ///
    /// Reports what the invoice is after the attempt:
    /// [`Paid`](InvoiceOutcome::Paid); [`PaymentFailed`](InvoiceOutcome::PaymentFailed)
    /// when the card was declined and the invoice stays open for the
    /// provider's own retries (the webhook reports the outcome);
    /// [`ActionRequired`](InvoiceOutcome::ActionRequired) when the customer
    /// must authenticate; [`Voided`](InvoiceOutcome::Voided) or
    /// [`Uncollectible`](InvoiceOutcome::Uncollectible) when the provider
    /// had already closed it. `Err` when the provider could not be reached
    /// or rejected the request.
    fn pay_overage_invoice(
        &self,
        charge_id: Uuid,
        invoice_id: &str,
        scope: SubscriptionScope,
    ) -> impl Future<Output = Result<InvoiceOutcome>> + Send;

    /// Read back what became of an invoice this crate opened, for rows whose
    /// webhook never arrived. `Ok(None)` when nothing conclusive can be said
    /// yet: the invoice is still a draft, or open with a payment that was
    /// never attempted or is still processing.
    fn invoice_outcome(
        &self,
        invoice_id: &str,
    ) -> impl Future<Output = Result<Option<InvoiceOutcome>>> + Send;

    /// The current period of the customer's subscription in `scope`. Active or
    /// trialing subscriptions win over past-due or unpaid ones. `Ok(None)` when
    /// no non-canceled subscription exists or the gateway cannot read
    /// subscriptions. Chosen subscriptions that disagree on the period are a
    /// [`BillingError::Payment`](super::BillingError::Payment).
    fn subscription_period(
        &self,
        customer_id: &str,
        scope: SubscriptionScope,
    ) -> impl Future<Output = Result<Option<BillingPeriod>>> + Send;
}

/// Finds whose settlement may be outstanding, for the periodic sweep in the
/// service that owns Stripe ([`SettlementSweep`](super::sweep::SettlementSweep)).
pub trait SettlementCandidates: Send + Sync + 'static {
    /// Users and payers worth settling: anyone who recorded counted usage at
    /// or after `since`, payers holding a credit reload that was reserved but
    /// never collected, and payers whose anchored subscription period began
    /// or ended at or after `since` (so a period that just closed is booked
    /// even when nobody uses AI afterwards). Deduplicated; the order is
    /// unspecified.
    fn candidates(
        &self,
        since: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>>> + Send;
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

/// Existing billing use cases offered to inbound adapters and other services.
///
/// Admission and aggregate settlement here retain legacy semantics. Activated
/// public-allowance traffic must instead use the awaited financial funding port
/// (`ai_usage::domain::ports::InvocationFunding`) backed by the reservation and
/// allocation rules in [`super::policy`]. It must never also enter legacy settlement.
pub trait BillingService: Send + Sync + 'static {
    /// May `user` start another AI request?
    ///
    /// Admission is a read of the position at this instant; usage is
    /// metered after the completion, so requests that are in flight together
    /// can each be admitted against the same headroom. The overshoot is
    /// bounded by one completion per concurrent request, is priced at the
    /// same markup as everything else, and can only exceed the payer's overage
    /// cap by that much. Reserving capacity per request would need a second
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

    /// Book each seat's usage beyond its own allowance for the payer of `user`
    /// from shared prepaid credits. Settles the current period and, before
    /// it, every closed period still inside the reconciliation window
    /// ([`RECONCILED_CLOSED_PERIODS`](super::service::RECONCILED_CLOSED_PERIODS)),
    /// so usage that ran past a period boundary is booked without a customer
    /// action. Only the current period may trigger an automatic credit
    /// reload. A closed period is settled against the per-seat allowances
    /// frozen while it was open, not the live plan or seat list.
    fn settle(&self, user: &MacroUserIdStr<'_>) -> impl Future<Output = Result<()>> + Send;

    /// Retired direct usage opt-in. Enabling is rejected; disabling remains
    /// supported for older clients. Payer only.
    fn update_overage(
        &self,
        user: &MacroUserIdStr<'_>,
        enabled: bool,
        limit_cents: i64,
    ) -> impl Future<Output = Result<UsageSnapshot>> + Send;

    /// Turn automatic credit reloads on with
    /// `thresholds` or off. Payer only. Enabling validates the thresholds,
    /// clears the retired direct-charge cap and both
    /// suspensions, and settles right away, so a balance already under the
    /// minimum reloads immediately. Disabling keeps the stored thresholds.
    fn update_auto_reload(
        &self,
        user: &MacroUserIdStr<'_>,
        enabled: bool,
        thresholds: AutoReloadThresholds,
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

    /// Record the payer's explicit subscription interval. Optional verified item
    /// facts feed the gated renewal use case; bare anchors remain legacy-only.
    fn sync_period(
        &self,
        payer: &MacroUserIdStr<'_>,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        verified: Option<super::period::SubscriptionPeriod>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Record what the provider reports about an overage invoice (webhook).
    /// Unknown invoices are ignored. The newest charge's outcome decides
    /// whether overage is suspended: paid lifts it; a decline, a payment
    /// awaiting the payer's authentication, a void, or a write-off pauses it.
    fn mark_overage_invoice(
        &self,
        stripe_invoice_id: &str,
        outcome: &InvoiceOutcome,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Record what the provider reports about a credit reload invoice
    /// (webhook). Unknown invoices are ignored. A paid invoice books its
    /// credits once, even when the collector already did, and settles; a
    /// decline, a payment awaiting the payer's authentication, a void, or a
    /// write-off pauses automatic reloads.
    fn mark_credit_reload_invoice(
        &self,
        stripe_invoice_id: &str,
        outcome: &InvoiceOutcome,
    ) -> impl Future<Output = Result<()>> + Send;
}
