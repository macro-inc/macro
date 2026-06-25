#![deny(missing_docs)]
//! Webhooks hexagonal architecture crate.
//!
//! Lets users (and, later, internal teams and bots) configure outbound
//! **webhooks** that subscribe to Macro domain events. This V1 crate covers
//! webhook + rule **configuration** only — creating a webhook with its single
//! rule, validating the configuration, and patching it. Event ingestion, rule
//! evaluation, and delivery are separate, later phases (see `webhooks_plan.md`).
//!
//! # Architecture
//!
//! - **domain**: domain models, ports (traits), and the service implementation.
//!   Compiles with only the `ports` feature, so the business logic can be
//!   unit-tested with in-memory fakes and no database or HTTP stack.
//! - **outbound**: adapters for external dependencies (PostgreSQL repository,
//!   AES-256-GCM secret encryption, DNS-based endpoint validation).
//! - **inbound**: adapters for incoming requests (Axum handlers).
//!
//! A webhook rule may filter on resources the requesting user must be allowed
//! to see (for example specific channels). The service enforces this by calling
//! [`entity_access::domain::ports::EntityAccessService`] for every resource a
//! rule references before the webhook is persisted.

/// Domain models, ports, and the webhook service implementation.
pub mod domain;

/// Inbound adapters (Axum handlers) for webhook configuration endpoints.
#[cfg(feature = "inbound")]
pub mod inbound;

/// Outbound adapters (PostgreSQL, encryption, endpoint validation).
#[cfg(feature = "outbound")]
pub mod outbound;
