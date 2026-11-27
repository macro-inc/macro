#![deny(missing_docs)]
//! Team credential vault: policy in domain, metadata in Postgres, values in OpenBao.
pub mod domain;
pub mod inbound;
pub mod outbound;

#[cfg(all(test, unix))]
mod signed_storage_test;
