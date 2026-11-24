//! Read-only HubSpot CRM inventory for the reviewed importer in `crates/import`.
#![deny(missing_docs)]

/// The portal's typed objects and the read port.
pub mod domain;
/// The fixed reads through a user's connected HubSpot.
pub mod outbound;
