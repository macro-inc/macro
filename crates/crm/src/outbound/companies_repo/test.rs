//! Test suite for [`super::CompaniesRepositoryImpl`], split by the
//! function under test. Shared seeding / assertion helpers live in
//! [`helpers`]; each sibling module covers one repo method (or one
//! closely-related cluster of methods, e.g. all CRM comment operations
//! in [`comments`]).

pub(crate) mod helpers;

mod activity_property_edges;
mod blocked_domains;
mod company_domains;
mod contact_emails;
mod contact_filing;
mod contact_update;
mod create_company;
mod create_contact;
mod create_team_contact;
mod domain_directory;
mod email_policy;
mod email_privacy;
mod get_company_by_domain;
mod get_company_for_team;
mod get_contact_by_email_for_team;
mod get_contact_detail_for_team;
mod get_contact_for_team;
mod has_depopulate_target;
mod link_contact_pairs_with_sources;
mod list_companies_for_soup;
mod list_company_contacts_page;
mod list_contacts_for_company;
mod list_contacts_for_soup;
#[cfg(all(feature = "axum", feature = "search", feature = "ai_tools"))]
mod member_access;
mod personal_emails;
mod populate_contact;
mod population_lifecycle;
mod population_locks;
mod population_scans;
#[cfg(feature = "inbound")]
mod previews;
mod resolve_association;
mod search_contacts_for_team;
mod selected_email_policy;
mod set_company_hidden;
mod set_company_name;
mod set_contact_hidden;
mod set_contact_name;
mod set_email_sync;
mod team_crm_enabled;
mod team_settings;

/// Coordinates teardown after the source mutation without timing assumptions.
#[derive(Default)]
pub(super) struct ContactWriteGate {
    pub(super) entered: tokio::sync::Notify,
    pub(super) resume: tokio::sync::Notify,
}
