//! Files manual contacts that have no company under the company for their
//! email domain, the way creation files a new one. A contact email sync left
//! without a company is never filed: that was sync's decision. Neither is an
//! archived one: sync never creates a company for an archived contact. An operator runs it for
//! one team, a batch at a time; nothing runs it automatically.

use super::{
    companies_repo::CompaniesRepository, company_metadata_resolver::CompanyMetadataResolver,
    generic_email_domains::is_generic_email_domain, model::CrmError, service::CrmServiceImpl,
};
use chrono::{DateTime, Utc};
use std::{collections::HashSet, future::Future};
use uuid::Uuid;

/// Most contacts one batch examines.
pub const MAX_FILING_BATCH: u16 = 500;

/// A contact without a company, as a batch lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnfiledContact {
    /// The contact.
    pub id: Uuid,
    /// Its primary address, lowercased.
    pub email: String,
    /// Whether a person created or edited it, as opposed to email sync.
    pub manually_created: bool,
    /// Whether it is archived.
    pub hidden: bool,
}

/// What filing one contact did, or would do in a dry run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContactFiling {
    /// The contact joined the company for its email domain.
    Filed {
        /// Whether the team had no company for the domain until now.
        company_created: bool,
    },
    /// The team keeps the domain out of email sync.
    BlockedDomain,
    /// The domain's company is hidden.
    HiddenCompany,
    /// The contact is archived.
    Archived,
    /// Another contact of the team holds one of the contact's addresses.
    DuplicateAddress,
    /// The contact is gone, has a company, has no primary address, or is
    /// not `manually_created`.
    NotUnfiled,
}

/// One batch of [`ContactFilingService::file_unfiled_contacts`].
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ContactFilingBatch {
    /// Contacts the batch looked at.
    pub examined: u32,
    /// Contacts that joined a company.
    pub filed: u32,
    /// Companies created for them.
    pub companies_created: u32,
    /// Left alone: email sync filed it without a company.
    pub skipped_not_manual: u32,
    /// Left alone: the contact is archived.
    pub skipped_archived: u32,
    /// Left alone: the address is at a personal or generic provider.
    pub skipped_provider_domain: u32,
    /// Left alone: the team blocks the domain.
    pub skipped_blocked_domain: u32,
    /// Left alone: the domain's company is hidden.
    pub skipped_hidden_company: u32,
    /// Left alone: another contact of the team holds one of its addresses.
    pub skipped_duplicate_address: u32,
    /// Left alone: it changed since the batch listed it.
    pub skipped_changed: u32,
    /// Contacts whose filing failed; a later run retries them.
    pub failed: u32,
    /// Pass as `after` for the next batch; `None` once the team is done.
    /// It is the last examined contact's address.
    pub next_after: Option<String>,
}

/// Storage for [`ContactFilingService`].
pub trait ContactFilingRepository: Send + Sync + 'static {
    /// The team's contacts that have a primary address and no company,
    /// manual or not, in address
    /// order after the address `after`, at most
    /// `limit`. Address order is the one the index over contacts without a
    /// company keeps, so a page reads only its own rows.
    fn list_unfiled_manual_contacts(
        &self,
        team_id: &Uuid,
        after: Option<&str>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<UnfiledContact>, CrmError>> + Send;

    /// Files one contact under the team's company for its primary address's
    /// domain, by the rules of
    /// [`CompaniesRepository::create_contact_for_email_domain`]. Takes the
    /// locks of a contact edit in the same order and re-reads the contact
    /// under them, so a contact that gained a company meanwhile is left
    /// alone, and so is one that is not `manually_created` or is archived.
    /// Keeps the
    /// contact's id, addresses, archive state and sources.
    /// With `dry_run` nothing is written. A lock that is not free within
    /// five seconds returns [`CrmError::Contended`]. The caller rules out
    /// personal and generic provider domains.
    fn file_unfiled_contact(
        &self,
        team_id: &Uuid,
        contact_id: &Uuid,
        now: DateTime<Utc>,
        dry_run: bool,
    ) -> impl Future<Output = Result<ContactFiling, CrmError>> + Send;
}

/// The operator entry point. It carries no receipt: only an internal caller
/// may reach it.
pub trait ContactFilingService: Send + Sync + 'static {
    /// Examines one batch of `team_id`'s contacts that have no company and
    /// files the `manually_created` ones,
    /// starting after the address `after`. Safe to repeat: a filed contact
    /// is no longer listed, and one left alone is counted again. With
    /// `dry_run` the counts say what a real run would do and nothing is
    /// written.
    fn file_unfiled_contacts(
        &self,
        team_id: Uuid,
        after: Option<&str>,
        limit: u16,
        dry_run: bool,
    ) -> impl Future<Output = Result<ContactFilingBatch, CrmError>> + Send;
}

impl<CR, R> ContactFilingService for CrmServiceImpl<CR, R>
where
    CR: CompaniesRepository + ContactFilingRepository,
    R: CompanyMetadataResolver,
{
    #[tracing::instrument(
        name = "crm.file_unfiled_contacts",
        skip(self, after),
        fields(examined, filed, companies_created, failed),
        err
    )]
    async fn file_unfiled_contacts(
        &self,
        team_id: Uuid,
        after: Option<&str>,
        limit: u16,
        dry_run: bool,
    ) -> Result<ContactFilingBatch, CrmError> {
        let limit = limit.clamp(1, MAX_FILING_BATCH);
        let contacts = self
            .companies_repository
            .list_unfiled_manual_contacts(&team_id, after, limit)
            .await?;

        let mut batch = ContactFilingBatch {
            // A short page is the team's last.
            next_after: contacts
                .last()
                .filter(|_| contacts.len() == usize::from(limit))
                .map(|contact| contact.email.clone()),
            ..ContactFilingBatch::default()
        };

        // A dry run rolls each contact back, so a later contact at the same
        // domain reports the company as created again.
        let mut created_domains = HashSet::new();
        for contact in &contacts {
            batch.examined += 1;
            // One contact that fails is counted and retried by a later run;
            // it must not stop the rest of the batch.
            let filing = self
                .file_one(team_id, contact, dry_run)
                .await
                .inspect_err(|error| {
                    tracing::warn!(?error, contact_id = %contact.id, "failed to file crm contact")
                });
            match filing {
                Ok(Examined::NotManual) => batch.skipped_not_manual += 1,
                Ok(Examined::Decided(ContactFiling::Archived)) => batch.skipped_archived += 1,
                Ok(Examined::ProviderDomain) => batch.skipped_provider_domain += 1,
                Ok(Examined::Decided(ContactFiling::Filed { company_created })) => {
                    batch.filed += 1;
                    let domain = contact.email.split_once('@').map(|(_, domain)| domain);
                    if company_created && created_domains.insert(domain) {
                        batch.companies_created += 1;
                    }
                }
                Ok(Examined::Decided(ContactFiling::BlockedDomain)) => {
                    batch.skipped_blocked_domain += 1
                }
                Ok(Examined::Decided(ContactFiling::HiddenCompany)) => {
                    batch.skipped_hidden_company += 1
                }
                Ok(Examined::Decided(ContactFiling::DuplicateAddress)) => {
                    batch.skipped_duplicate_address += 1
                }
                Ok(Examined::Decided(ContactFiling::NotUnfiled)) => batch.skipped_changed += 1,
                Err(_) => batch.failed += 1,
            }
        }

        let span = tracing::Span::current();
        span.record("examined", batch.examined);
        span.record("filed", batch.filed);
        span.record("companies_created", batch.companies_created);
        span.record("failed", batch.failed);
        Ok(batch)
    }
}

impl<CR, R> CrmServiceImpl<CR, R>
where
    CR: CompaniesRepository + ContactFilingRepository,
    R: CompanyMetadataResolver,
{
    async fn file_one(
        &self,
        team_id: Uuid,
        contact: &UnfiledContact,
        dry_run: bool,
    ) -> Result<Examined, CrmError> {
        if !contact.manually_created {
            return Ok(Examined::NotManual);
        }
        if contact.hidden {
            return Ok(Examined::Decided(ContactFiling::Archived));
        }
        let Some((_, domain)) = contact.email.split_once('@') else {
            return Ok(Examined::ProviderDomain);
        };
        if is_generic_email_domain(domain) {
            return Ok(Examined::ProviderDomain);
        }

        if !dry_run {
            self.ensure_domain_directory_entry(domain).await?;
        }
        self.companies_repository
            .file_unfiled_contact(&team_id, &contact.id, Utc::now(), dry_run)
            .await
            .map(Examined::Decided)
    }
}

/// What the batch found for one listed contact.
enum Examined {
    /// Email sync filed it without a company; it stays as sync left it.
    NotManual,
    /// Its address is at a provider that keys no company.
    ProviderDomain,
    /// The repository decided under the contact's locks.
    Decided(ContactFiling),
}
