/// Persistence port for CRM companies
pub mod companies_repo;
/// Outbound port for resolving company metadata from a domain
pub mod company_metadata_resolver;
/// Static list of generic/personal email-provider domains to exclude
/// from CRM populate
pub(crate) mod generic_email_domains;
/// Domain models for CRM records
pub mod model;
/// The CRM service trait and implementation
pub mod service;
