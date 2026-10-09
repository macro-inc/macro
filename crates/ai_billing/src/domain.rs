//! Domain layer: plans and the configured pricing, the settlement ledger, ports,
//! the billing service, and the reconciliation sweep.

pub mod admission;
pub mod financial;
pub mod ledger;
pub mod models;
pub mod period;
pub mod policy;
pub mod ports;
pub mod pricing;
pub mod service;
pub mod sweep;

pub use admission::{
    AdmissionFuture, AiAdmissionError, AiAdmissionService, BillingAdmissionService,
    DisabledAiAdmissionService,
};
pub use ledger::{
    ReloadState, SettlementPlan, SettlementPolicy, SettlementState, plan_reload, plan_settlement,
};
pub use models::{
    AUTO_RELOAD_DEFAULT_MINIMUM_CENTS, AUTO_RELOAD_DEFAULT_TARGET_CENTS,
    AUTO_RELOAD_TARGET_MAX_CENTS, AiUsageBilling, AllowanceDecision, AllowanceStore,
    AutoReloadSnapshot, AutoReloadThresholds, BillingError, BillingPeriod, BillingSettings,
    CREDIT_PACKS_CENTS, CreditReloadStatus, DenyReason, Entitlement, MIN_STRIPE_CHARGE_CENTS,
    OVERAGE_CHARGE_THRESHOLD_CENTS, OVERAGE_LIMIT_MAX_CENTS, OVERAGE_LIMIT_MIN_CENTS,
    OpenPeriodStart, OverageChargeStatus, PayerScope, PeriodAllowance, PeriodLedger, PlanTier,
    Result, SeatAllowance, SeatGeneration, SeatUsage, SubscriptionScope, UsagePolicy,
    UsageSnapshot,
};
pub use ports::{
    BillingRepo, BillingService, CreditCheckoutRequest, CreditReloadRequest, EntitlementSource,
    OverageChargeRequest, PaymentGateway, PendingCharge, PendingReload, ResolvedReload,
    SettlementCandidates, SettlementOutcome, SettlementTrigger, UsageReader,
};
pub use pricing::{
    AiPricing, IncludedAllowanceCents, OverageMarkupPercent, PlanAllowances, PricingError,
    cost_cents,
};
pub use service::{BillingServiceImpl, RECONCILED_CLOSED_PERIODS};
pub use sweep::{RECONCILIATION_LOOKBACK, SettlementSweep, SweepReport};
