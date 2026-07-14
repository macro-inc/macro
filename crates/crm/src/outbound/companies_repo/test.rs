//! Test suite for [`super::CompaniesRepositoryImpl`], split by the
//! function under test. Shared seeding / assertion helpers live in
//! [`helpers`]; each sibling module covers one repo method (or one
//! closely-related cluster of methods, e.g. all CRM comment operations
//! in [`comments`]).

mod helpers;

mod comments;
mod get_company_for_team;
mod get_contact_for_team;
mod list_companies_for_soup;
mod list_contacts_for_company;
mod populate_contact;
mod set_company_hidden;
mod set_contact_hidden;
mod set_email_sync;
