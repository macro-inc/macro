/// Domain models for CRM records
pub mod model;

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
/// Team deal stages: the role-gated write path over the team's stage definition
#[cfg(feature = "ports")]
pub mod stages;

/// Capability-token receipt wrappers gating per-entity CRM service calls
#[cfg(feature = "ports")]
pub mod auth;

/// Links archived calls to the CRM records of the people on them
#[cfg(feature = "call_link")]
pub mod call_links;

/// Port + domain types for CRM company search (name/domain)
#[cfg(feature = "search")]
pub mod search_repo;
/// The CRM search service trait and implementation
#[cfg(feature = "search")]
pub mod search_service;

/// The CRM records an associated-items query matches against.
#[cfg(feature = "ports")]
pub mod association;
/// Contact listing models shared by Soup and the CRM service.
#[cfg(feature = "ports")]
pub mod contact_listing;
/// CRM CSV files: parsing companies and pipeline entries, and writing exports.
#[cfg(feature = "ports")]
pub mod crm_csv;
/// CSV imports and exports of companies and pipelines, for agents.
#[cfg(feature = "ports")]
pub mod crm_transfer;
/// Pipeline use cases addressed by record, field name and stage label.
#[cfg(feature = "ports")]
pub mod pipeline_workflows;
/// CRM pipelines and their lifecycle.
#[cfg(feature = "ports")]
pub mod pipelines;
