//! Web search and page fetch for agents and the SDK, behind a vendor port.
//!
//! The domain admits each request against the caller's AI allowance and meters
//! the vendor's credits to them; [`outbound::tavily`] is the vendor adapter.
#![deny(missing_docs)]

pub mod domain;
pub mod inbound;
pub mod outbound;
