//! GTM invite links.
//!
//! Macro staff create personal, time-limited signup links for prospects. Opening
//! a link shows a personal welcome, signing up through it attributes the new
//! account to the staff member who created the link, and the redeemed link
//! carries a promotional first month of Premium that checkout applies.
//!
//! # Architecture
//!
//! - **domain**: Contains domain models, ports (traits), and the service implementation
//! - **outbound**: Contains adapters for external dependencies (PostgreSQL)
//! - **inbound**: Contains adapters for incoming requests (Axum handlers)

#![deny(missing_docs)]

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
