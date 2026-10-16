#![deny(missing_docs)]
// The end-to-end test's future, over the real databases service, is deep.
#![cfg_attr(test, recursion_limit = "256")]
//! Incoming webhooks for Macro databases: a secret URL that inserts rows into
//! one table. A POSTed JSON object names cells by column; the domain turns it
//! into the same row insert the grid sends, through the databases service.

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "postgres")]
pub mod outbound;

#[cfg(feature = "postgres")]
pub mod wiring;
