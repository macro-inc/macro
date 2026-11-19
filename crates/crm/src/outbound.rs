/// Postgres store linking archived call records to CRM records
#[cfg(feature = "call_link")]
pub mod call_link;
/// Postgres implementation of the companies repository
#[cfg(feature = "outbound")]
pub mod companies_repo;
/// Remote rollout gate for selective contribution authoring.
#[cfg(feature = "outbound")]
pub mod email_policy;
/// Postgres implementation of the message store's CRM parent reader
#[cfg(feature = "lookup")]
pub mod lookup;
#[cfg(any(feature = "outbound", feature = "search"))]
mod member_access;
/// Resolver stub for binaries that don't populate the CRM
#[cfg(feature = "outbound")]
pub mod no_op_resolver;
/// Postgres implementation of the CRM search repository
#[cfg(feature = "search")]
pub mod search_repo;
/// Properties-service implementation of the team stage definition store
#[cfg(feature = "outbound")]
pub mod stage_definitions;
/// Remote rollout gate for owner-managed thread-exclusion writes.
#[cfg(feature = "outbound")]
pub mod thread_exclusions;
/// Unfurl-backed implementation of the company metadata resolver
#[cfg(feature = "outbound")]
pub mod unfurl_resolver;

/// Atomic pipeline storage over the databases domain writer.
#[cfg(feature = "outbound")]
pub mod pipelines;

/// Bounded live rule discovery for readers and owner authoring.
#[cfg(any(feature = "outbound", feature = "email_discovery"))]
pub mod email_rule_discovery;
