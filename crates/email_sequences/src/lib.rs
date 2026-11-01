#![deny(missing_docs)]
//! Email sequences: multi-step outreach from a user's own Gmail inbox to their
//! team's CRM contacts, run by a server sweep through scheduled sends.

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
