#![deny(missing_docs)]

//! AI billing — plan allowances, prepaid credits, and post-paid overage.
//!
//! # The pricing model
//!
//! Every seat includes a monthly AI allowance measured **at cost**: the
//! provider's public price for what was consumed. Each plan has its own
//! allowance. Paid usage past the allowance is covered, in order, by prepaid
//! credits (bought in one-off Stripe Checkout payments) and then by opt-in
//! overage, billed to the payer's Stripe customer in chunks. Both are priced
//! at cost plus a small markup. The free plan is a hard cap: once its
//! allowance is used, only an upgrade (or the next calendar month) helps.
//!
//! ```text
//! free cap  = AI_USAGE_FREE_INCLUDED_ALLOWANCE_CENTS  (provider cost per user per month)
//! premium   = AI_USAGE_INCLUDED_ALLOWANCE_CENTS       (provider cost per seat per period)
//! max       = AI_USAGE_MAX_INCLUDED_ALLOWANCE_CENTS   (provider cost per seat per period)
//! extra     = cost x (100 + AI_USAGE_OVERAGE_MARKUP_PERCENT) / 100
//! ```
//!
//! None of the numbers live in code. All are mandatory Doppler values that
//! every host loads at startup ([`config`]) into one [`AiPricing`] and injects
//! into each billing component it composes ([`domain::pricing`]). Change them
//! in Doppler and redeploy. Usage and allowances are **cost cents**; credits,
//! charges, caps and packs are **customer cents**. The conversions on
//! [`AiPricing`] are the only place the two units meet.
//!
//! # Layout
//!
//! - [`domain`] — plan catalog, the configured pricing, the settlement ledger
//!   (pure), ports, the service, and the reconciliation sweep that settles
//!   whoever nobody asked to settle.
//! - [`outbound`] — Postgres repos over `ai_usage` and the billing tables, the
//!   Stripe gateway, the roles + teams entitlement resolver, the sweep's
//!   candidate finder, and the recorder wrapper that triggers settlement after
//!   usage lands.
//! - [`inbound`] — the axum router (summary, overage settings, credit
//!   checkout, internal settle) and the scheduled sweep worker.
//! - [`composition`] — how a host that does not own Stripe composes admission
//!   and the settling recorder.
//! - [`config`] — startup configuration: the mandatory pricing values and the
//!   `ENABLE_AI_USAGE_BILLING` loader, the default-off policy that gates
//!   settlement in every environment.
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
    AdmissionFuture, AiAdmissionError, AiAdmissionService, AiPricing, AiUsageBilling,
    AllowanceDecision, AutoReloadSnapshot, AutoReloadThresholds, BillingAdmissionService,
    BillingError, BillingPeriod, BillingService, BillingSettings, CREDIT_PACKS_CENTS, DenyReason,
    DisabledAiAdmissionService, Entitlement, IncludedAllowanceCents, OverageMarkupPercent,
    PayerScope, PlanAllowances, PlanTier, PricingError, UsageSnapshot, cost_cents,
};
