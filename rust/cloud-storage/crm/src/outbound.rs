/// Apollo.io-backed implementation of the company metadata resolver
#[cfg(feature = "outbound")]
pub mod apollo_resolver;
/// Postgres implementation of the companies repository
#[cfg(feature = "outbound")]
pub mod companies_repo;
/// Resolver stub for binaries that don't populate the CRM
#[cfg(feature = "outbound")]
pub mod no_op_resolver;
/// Postgres implementation of the CRM search repository
#[cfg(feature = "search")]
pub mod search_repo;
/// Unfurl-backed implementation of the company metadata resolver
#[cfg(feature = "outbound")]
pub mod unfurl_resolver;
