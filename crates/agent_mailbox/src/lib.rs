#![deny(missing_docs)]
//! Agent mailboxes: an email inbox and address of its own for each agent
//! teammate, which the agent reads, sends and replies from through tools
//! restricted to that inbox.
//!
//! Mail is hosted by a provider behind provider-neutral ports
//! ([`domain::ports::MailboxProvisioner`], [`domain::ports::MailboxClient`]).
//! The provisioning credential stays on the server; each mailbox gets its own
//! narrowly scoped credential, stored only as KMS ciphertext.
//!
//! # Architecture
//!
//! - **domain**: models, ports, and the service.
//! - **inbound**: the Axum routes (feature `inbound`).
//! - **outbound**: Postgres, KMS and provider adapters (feature `outbound`).

pub mod domain;
