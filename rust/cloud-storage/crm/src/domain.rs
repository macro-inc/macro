/// Domain models for CRM records
pub mod model;

/// Domain and wire models for CRM comment threads
pub mod comment;

/// Static list of generic/personal email-provider domains to exclude
/// from CRM populate
#[cfg(feature = "ports")]
pub(crate) mod generic_email_domains;

/// Persistence port for CRM companies
#[cfg(feature = "ports")]
pub mod companies_repo;
/// Outbound port for resolving company metadata from a domain
#[cfg(feature = "ports")]
pub mod company_metadata_resolver;
/// The CRM service trait and implementation
#[cfg(feature = "ports")]
pub mod service;

/// Capability-token receipt wrappers gating per-entity CRM service calls
#[cfg(feature = "ports")]
pub mod auth;
