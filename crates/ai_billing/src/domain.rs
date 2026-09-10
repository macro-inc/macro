//! Domain layer: plans and margin math, the settlement ledger, ports, and the
//! billing service.

pub mod ledger;
pub mod models;
pub mod ports;
pub mod service;

pub use ledger::{SettlementPlan, SettlementPolicy, SettlementState, plan_settlement};
pub use models::{
    AllowanceDecision, BillingError, BillingPeriod, BillingSettings, CREDIT_PACKS_CENTS,
    DenyReason, Entitlement, MIN_STRIPE_CHARGE_CENTS, OVERAGE_CHARGE_THRESHOLD_CENTS,
    OVERAGE_LIMIT_MAX_CENTS, OVERAGE_LIMIT_MIN_CENTS, OverageChargeStatus, PayerScope,
    PeriodLedger, PlanTier, Result, TARGET_GROSS_MARGIN_BPS, UsageSnapshot, list_rate_cents,
};
pub use ports::{
    BillingRepo, BillingService, CreditCheckoutRequest, EntitlementSource, OverageChargeReceipt,
    OverageChargeRequest, PaymentGateway, PendingCharge, SettlementOutcome, SettlementTrigger,
    UsageReader,
};
pub use service::BillingServiceImpl;
