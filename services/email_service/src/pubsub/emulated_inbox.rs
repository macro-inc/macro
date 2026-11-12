//! A Gmail inbox connected to `crates/gmail_emulator` and kept in sync by
//! the production inbox sync workers.
//!
//! This layer is for behavior that hinges on exactly how a failure is
//! retried: the emulator fails a Gmail call a set number of times, the real
//! inbox sync workers and outbox publisher handle it, and [`queues`]
//! redelivers what they queue the way SQS does, redrive policy included.
//! Specs then check what the owner would see. End-to-end behavior across
//! processes belongs in the end-to-end email suite instead.
//!
//! Real: Postgres, Redis (request gate, token cache), the Gmail client and
//! the sync code. Emulated: Gmail and its token service. Faked: SQS and the
//! other internal services the workers call ([`services`]).

mod gmail;
mod queues;
mod services;
