//! Read-only Salesforce CRM inventory for the reviewed importer in `crates/import`.
#![deny(missing_docs)]

/// The org's typed records and the read port.
pub mod domain;
/// The fixed reads through a user's connected Salesforce.
pub mod outbound;
