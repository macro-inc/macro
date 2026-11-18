//! The Stripe event inbox: the webhook stores each verified event, and
//! per-consumer cursors apply them in order per customer, with retries and
//! dead-lettering, while a daily audit compares Stripe with what Macro
//! holds. See `docs/architecture/stripe-event-inbox.md`.
#![deny(missing_docs)]

pub mod domain;
pub mod inbound;
pub mod outbound;
pub mod telemetry;
