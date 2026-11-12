#![deny(missing_docs)]

//! Macro computers: team-owned hosted VMs that run macrod.
//!
//! The pure lifecycle in [`domain::lifecycle`] decides what a computer does
//! next; ports in [`domain::ports`] carry those decisions to Postgres, the
//! fleet (Incus or Docker) and Stripe.

pub mod domain;
#[cfg(feature = "inbound")]
pub mod inbound;
#[cfg(feature = "outbound")]
pub mod outbound;
