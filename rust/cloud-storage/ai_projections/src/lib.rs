#![deny(missing_docs)]
//! AI projections hexagonal architecture crate.
//!
//! An AI projection is a materialized, cached AI-generated view of a user's
//! underlying data, keyed by a frontend-defined text id (e.g.
//! `notification_important_widget`). The high-level definition lives in the
//! `ai_projection` table, while each user's cached instance lives in the
//! `user_ai_projection` table.
//!
//! # Architecture
//!
//! - **domain**: Domain models, ports (traits), and the service implementation
//! - **outbound**: Adapters for external dependencies (PostgreSQL)
//! - **inbound**: Adapters for incoming requests (Axum handlers)

/// The domain module contains the domain logic for ai projections
pub mod domain;

/// The inbound module contains the inbound adapters for ai projections
#[cfg(feature = "inbound")]
pub mod inbound;

/// The outbound module contains the outbound adapters for ai projections
#[cfg(feature = "outbound")]
pub mod outbound;
