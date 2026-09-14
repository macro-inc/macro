#![deny(missing_docs)]

//! AI billing — plan allowances, prepaid credits, and post-paid overage.
//!
//! # The margin model
//!
//! Every paid plan includes a monthly AI allowance equal to its list price,
//! measured at Macro's **list rate**. The list rate is provider cost marked up
//! so that a fully consumed allowance yields the target gross margin:
//!
//! ```text
//! list = cost / (1 - margin)       margin = 60%  =>  list = 2.5 x cost
//! Premium: $40/mo includes $40 of AI at list  ( = $16 of provider cost)
//! Max:     $200/mo includes $200 of AI at list ( = $80 of provider cost)
//! ```
//!
//! Usage past the allowance is covered, in order, by prepaid credits (bought
//! in one-off Stripe Checkout payments) and then by opt-in overage, billed to
//! the payer's Stripe customer in chunks at the same list rate. Both keep the
//! same margin as the plan itself.
//!
//! # Layout
//!
//! - [`domain`] — plan catalog, the margin math, the settlement ledger (pure),
//!   ports, and the service.
//! - [`outbound`] — Postgres repos over `ai_usage` and the billing tables, the
//!   Stripe gateway, the roles + teams entitlement resolver, and the recorder
//!   wrapper that triggers settlement after usage lands.
//! - [`inbound`] — the axum router (summary, overage settings, credit
//!   checkout, internal settle).
//!
//! The *payer* is the account that owns credits, overage settings, and the
//! Stripe customer: the personal subscriber, or the team owner for members
//! whose paid access comes through a team subscription. Team usage pools
//! against `seats x included` on the owner.

pub mod domain;
pub mod inbound;
pub mod outbound;

pub use domain::{
    AllowanceDecision, BillingError, BillingPeriod, BillingService, BillingSettings,
    CREDIT_PACKS_CENTS, DenyReason, Entitlement, PayerScope, PlanTier, TARGET_GROSS_MARGIN_BPS,
    UsageSnapshot, list_rate_cents,
};
