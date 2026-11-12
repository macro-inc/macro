//! One inbox connected to a provider emulator (`crates/gmail_emulator`,
//! `crates/outlook_emulator`) and kept in sync by the production workers.
//!
//! The emulator plays the provider: mail arrives in it, and tests make it
//! fail the way the provider does. The real inbox sync workers, outbox
//! publisher and Outlook sync loops store that mail in Postgres, and
//! [`queues`] delivers what they queue the way SQS does, redrive policy
//! included. Specs then check what the owner would see.
//!
//! Real: Postgres, Redis (request gate, token cache), the provider clients
//! and the sync code. Emulated: the provider, its token service. Faked: SQS
//! and the other internal services the workers call ([`services`]).

mod gmail;
mod outlook;
mod queues;
mod services;
