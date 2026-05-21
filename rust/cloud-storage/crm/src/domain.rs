/// Domain models for CRM records
pub mod model;

/// Persistence port for CRM companies
#[cfg(feature = "ports")]
pub mod companies_repo;
/// The CRM service trait and implementation
#[cfg(feature = "ports")]
pub mod service;
