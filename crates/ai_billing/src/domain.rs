//! Domain layer: plans and pricing constants, the settlement ledger, ports, and
//! the billing service.

pub mod admission;
pub mod financial;
pub mod ledger;
pub mod models;
pub mod period;
pub mod policy;
pub mod ports;
pub mod pricing;
pub mod service;

pub use admission::{
    AdmissionFuture, AiAdmissionError, AiAdmissionService, BillingAdmissionService,
    DisabledAiAdmissionService,
};
pub use ledger::{SettlementPlan, SettlementPolicy, SettlementState, plan_settlement};
pub use models::{
    AiUsageBilling, AllowanceDecision, AllowanceStore, BillingError, BillingPeriod,
    BillingSettings, CREDIT_PACKS_CENTS, DenyReason, Entitlement, MIN_STRIPE_CHARGE_CENTS,
    OVERAGE_CHARGE_THRESHOLD_CENTS, OVERAGE_LIMIT_MAX_CENTS, OVERAGE_LIMIT_MIN_CENTS,
    OpenPeriodStart, OverageChargeStatus, PayerScope, PeriodAllowance, PeriodLedger, PlanTier,
    Result, SeatAllowance, SeatGeneration, SeatUsage, SubscriptionScope, UsagePolicy,
    UsageSnapshot,
};
pub use ports::{
    BillingRepo, BillingService, CreditCheckoutRequest, EntitlementSource, OverageChargeRequest,
    PaymentGateway, PendingCharge, SettlementOutcome, SettlementTrigger, UsageReader,
};
pub use pricing::{
    INCLUDED_ALLOWANCE_CENTS, OVERAGE_MARKUP_PERCENT, cost_cents, cost_cents_covered_by,
    extra_customer_cents,
};
pub use service::BillingServiceImpl;
