#![deny(missing_docs)]

//! AI billing — plan allowances, prepaid credits, and post-paid overage.
//!
//! # The pricing model
//!
//! Every paid seat includes a monthly AI allowance measured **at cost**: the
//! provider's public price for what was consumed. Usage past the allowance is
//! covered, in order, by prepaid credits (bought in one-off Stripe Checkout
//! payments) and then by opt-in overage, billed to the payer's Stripe customer
//! in chunks. Both are priced at cost plus a small markup:
//!
//! ```text
//! allowance = INCLUDED_ALLOWANCE_CENTS   ($20 of provider cost per seat per period)
//! extra     = cost x (100 + OVERAGE_MARKUP_PERCENT) / 100   (5% over cost)
//! ```
//!
//! Both numbers live in [`domain::pricing`]; change a constant and redeploy.
//! Usage and allowance are **cost cents**; credits, charges, caps and packs are
//! **customer cents**. The conversions in that module are the only place the
//! two units meet.
//!
//! # Layout
//!
//! - [`domain`] — plan catalog, pricing constants, the settlement ledger (pure),
//!   ports, and the service.
//! - [`outbound`] — Postgres repos over `ai_usage` and the billing tables, the
//!   Stripe gateway, the roles + teams entitlement resolver, and the recorder
//!   wrapper that triggers settlement after usage lands.
//! - [`inbound`] — the axum router (summary, overage settings, credit
//!   checkout, internal settle).
//! - [`config`] — the startup loader for `ENABLE_AI_USAGE_BILLING`, the
//!   default-off policy that gates settlement in every environment.
//!
//! The *payer* is the account that owns credits, overage settings, and the
//! Stripe customer: the personal subscriber, or the team owner for members
//! whose paid access comes through a team subscription. Each team seat uses
//! only its own plan allowance; credits and overage are shared by the payer.

pub mod composition;
pub mod config;
pub mod domain;
pub mod inbound;
pub mod outbound;

pub use ai_usage::{AiFeature, AiUsageEnforcement};
pub use domain::{
    AdmissionFuture, AiAdmissionError, AiAdmissionService, AiUsageBilling, AllowanceDecision,
    BillingAdmissionService, BillingError, BillingPeriod, BillingService, BillingSettings,
    CREDIT_PACKS_CENTS, DenyReason, DisabledAiAdmissionService, Entitlement,
    INCLUDED_ALLOWANCE_CENTS, OVERAGE_MARKUP_PERCENT, PayerScope, PlanTier, UsageSnapshot,
    cost_cents, cost_cents_covered_by, extra_customer_cents,
};
