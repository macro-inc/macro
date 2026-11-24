/// Domain models for CRM records
pub mod model;

/// Individual mailbox consent and domain exclusions for CRM contributions.
#[cfg(feature = "ports")]
pub mod email_privacy;

/// Bounded rule definitions and audit vocabulary for selected contribution.
#[cfg(feature = "ports")]
pub mod email_rules;

/// Bounded live-rule discovery shared by authoring and email reads.
#[cfg(feature = "ports")]
pub mod email_rule_discovery;

/// Consent-generation storage for policy APIs and background work.
#[cfg(feature = "ports")]
pub mod email_policy;
/// Own-member rule authoring, consent CAS and verified provenance.
#[cfg(feature = "ports")]
pub mod email_policy_api;
/// Bounded asynchronous own-mailbox count previews.
#[cfg(feature = "ports")]
pub mod email_policy_preview;

/// Generation-bound history and live-source reconciliation contracts.
#[cfg(feature = "ports")]
pub mod email_policy_work;

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

/// Operator-run filing of manual contacts under their email domain's company
#[cfg(feature = "ports")]
pub mod contact_filing;

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
/// Company and contact chip titles, read many at a time.
#[cfg(feature = "ports")]
pub mod previews;

/// Pipeline outcome and per-amount currency fields.
#[cfg(feature = "ports")]
pub mod pipeline_commercial;

/// Explicit contact field edits.
#[cfg(feature = "ports")]
pub mod contact_update;

/// Adding and removing a company's domains.
#[cfg(feature = "ports")]
pub mod company_domains;
