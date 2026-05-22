//! The CrmService trait and its default implementation.

use crate::domain::{
    companies_repo::CompaniesRepository,
    company_metadata_resolver::CompanyMetadataResolver,
    generic_email_domains::is_generic_email_domain,
    model::{CrmCompany, CrmError},
};

/// The CrmService exposes operations over CRM records (companies, their
/// domains and contacts).
pub trait CrmService: Clone + Send + Sync + 'static {
    /// Fetches the company for the given team that has `domain` registered
    /// against it, hydrated with all of the company's domains. Returns
    /// `Ok(None)` when no company in the team has that domain.
    fn get_company_by_domain(
        &self,
        team_id: &uuid::Uuid,
        domain: &str,
    ) -> impl Future<Output = Result<Option<CrmCompany>, CrmError>> + Send;

    /// Idempotently records that `email` was seen from the mailbox
    /// identified by `link_id`, for the team `team_id`. Upserts
    /// `crm_companies` (+ `crm_domains`), `crm_contacts`, and
    /// `crm_contact_sources` in a single transaction. The call is a
    /// no-op when either killswitch is engaged: the team-level
    /// `team_crm_settings.crm_enabled = false`, or the per-domain
    /// `crm_companies.email_sync = false` for the contact's domain.
    ///
    /// `name` is the display name observed for `email` on this user's
    /// link — typically `email_contacts.name`, which the caller looks up
    /// before invoking. The first non-NULL name wins for the
    /// `crm_contacts` row; later populates from other team members can't
    /// overwrite it. Pass `None` when no display name is available.
    ///
    /// `user_email` is the email address registered against `link_id`
    /// (i.e. the user's own mailbox). When the contact's domain matches
    /// the user's, the call is a no-op: intra-company correspondence
    /// would just fill the team's CRM with the team itself.
    ///
    /// Before the populate transaction, this method ensures
    /// `crm_domain_directory` has an entry for the email's domain — if
    /// not, it invokes the
    /// [`crate::domain::company_metadata_resolver::CompanyMetadataResolver`]
    /// and inserts the result (which may be all-NULL on resolver
    /// failure — that's the negative cache). The directory write is its
    /// own transaction so the populate tx never holds locks across an
    /// HTTP fetch.
    fn populate_contact(
        &self,
        team_id: &uuid::Uuid,
        link_id: &uuid::Uuid,
        user_email: &str,
        email: &str,
        name: Option<&str>,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;

    /// Reverses [`populate_contact`] for one `(link_id, email)`. Drops the
    /// `crm_contact_sources` row, then cascades up to `crm_contacts` and
    /// `crm_companies` (with `crm_domains` cascading via FK) when no
    /// sibling rows remain — except that companies with `email_sync =
    /// false` are preserved so the team's opt-out configuration survives
    /// teardown. See
    /// [`crate::domain::companies_repo::CompaniesRepository::depopulate_contact`].
    ///
    /// Treats malformed emails (missing `@`, empty local-part, empty or
    /// multi-`@` domain) as a no-op rather than an error so that retries
    /// don't pile up on poisoned messages. This is stricter than
    /// [`populate_contact`], which errors on malformed input — depopulate
    /// is a teardown step and we'd rather drop a bad payload than churn
    /// it through the retry path. The caller is expected to gate this
    /// call on a prior check that the link has no other sent messages to
    /// `email`.
    fn depopulate_contact(
        &self,
        team_id: &uuid::Uuid,
        link_id: &uuid::Uuid,
        email: &str,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;

    /// Bulk teardown for one user's email link within one team: drops
    /// the team's `crm_contact_sources` rows owned by `link_id`, then
    /// cascades to `crm_contacts` and `crm_companies` for the rows
    /// orphaned as a result. Companies with `email_sync = false` are
    /// preserved. See
    /// [`crate::domain::companies_repo::CompaniesRepository::depopulate_link_in_team`].
    ///
    /// Used by the `DepopulateCrmForUser` backfill step. Unlike
    /// [`depopulate_contact`], this bypasses any per-message gate — the
    /// trigger here is "user is no longer on this team", which makes
    /// the presence of the user's sent messages in `email_messages`
    /// irrelevant.
    fn depopulate_link_in_team(
        &self,
        team_id: &uuid::Uuid,
        link_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;

    /// Returns the team id `macro_id` belongs to, or `None` when the user
    /// has no team membership. See
    /// [`crate::domain::companies_repo::CompaniesRepository::get_team_id_for_user`]
    /// for tie-breaking when the user is on multiple teams.
    fn get_team_id_for_user(
        &self,
        macro_id: &str,
    ) -> impl Future<Output = Result<Option<uuid::Uuid>, CrmError>> + Send;

    /// Toggle `email_sync` for `(company_id, team_id)`. Disable cascades
    /// to contacts and contact_sources; see
    /// [`crate::domain::companies_repo::CompaniesRepository::set_email_sync`].
    /// Authorization is the caller's responsibility.
    fn set_email_sync(
        &self,
        team_id: &uuid::Uuid,
        company_id: &uuid::Uuid,
        email_sync: bool,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;

    /// Toggle the `hidden` flag on a CRM company for `(company_id,
    /// team_id)`. Hiding (`true`) also forces `email_sync = false` and
    /// tears down contacts/sources atomically; see
    /// [`crate::domain::companies_repo::CompaniesRepository::set_company_hidden`].
    /// Un-hiding (`false`) leaves `email_sync` as-is — the team must
    /// re-enable sync explicitly. Authorization is the caller's
    /// responsibility.
    fn set_company_hidden(
        &self,
        team_id: &uuid::Uuid,
        company_id: &uuid::Uuid,
        hidden: bool,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;

    /// Toggle the `hidden` flag on a CRM contact, scoped to `team_id`
    /// via the contact's company. Hiding is a display-only opt-out and
    /// does not affect populate/depopulate. Authorization is the
    /// caller's responsibility.
    fn set_contact_hidden(
        &self,
        team_id: &uuid::Uuid,
        contact_id: &uuid::Uuid,
        hidden: bool,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;
}

/// Implementation of [`CrmService`] backed by a [`CompaniesRepository`]
/// and a [`CompanyMetadataResolver`].
#[derive(Debug)]
pub struct CrmServiceImpl<CR, R>
where
    CR: CompaniesRepository,
    R: CompanyMetadataResolver,
{
    /// The underlying companies repository
    companies_repository: CR,
    /// Resolver consulted only when `crm_domain_directory` has no entry
    /// for a given domain. The resolver itself is best-effort — its
    /// failures collapse to a negative-cache row in the directory.
    metadata_resolver: R,
}

impl<CR, R> Clone for CrmServiceImpl<CR, R>
where
    CR: CompaniesRepository,
    R: CompanyMetadataResolver,
{
    fn clone(&self) -> Self {
        Self {
            companies_repository: self.companies_repository.clone(),
            metadata_resolver: self.metadata_resolver.clone(),
        }
    }
}

impl<CR, R> CrmServiceImpl<CR, R>
where
    CR: CompaniesRepository,
    R: CompanyMetadataResolver,
{
    /// Creates a new CrmServiceImpl
    pub fn new(companies_repository: CR, metadata_resolver: R) -> Self {
        Self {
            companies_repository,
            metadata_resolver,
        }
    }
}

impl<CR, R> CrmService for CrmServiceImpl<CR, R>
where
    CR: CompaniesRepository,
    R: CompanyMetadataResolver,
{
    #[tracing::instrument(skip(self), err)]
    async fn get_company_by_domain(
        &self,
        team_id: &uuid::Uuid,
        domain: &str,
    ) -> Result<Option<CrmCompany>, CrmError> {
        self.companies_repository
            .get_company_by_domain(team_id, domain)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn populate_contact(
        &self,
        team_id: &uuid::Uuid,
        link_id: &uuid::Uuid,
        user_email: &str,
        email: &str,
        name: Option<&str>,
    ) -> Result<(), CrmError> {
        let email = email.trim();
        let Some((local_part, domain)) = email.split_once('@') else {
            return Err(CrmError::StorageLayerError(anyhow::anyhow!(
                "email {email} has no '@' separator"
            )));
        };
        if local_part.is_empty() {
            return Err(CrmError::StorageLayerError(anyhow::anyhow!(
                "email {email} has an empty local part"
            )));
        }
        if domain.is_empty() {
            return Err(CrmError::StorageLayerError(anyhow::anyhow!(
                "email {email} has an empty domain"
            )));
        }

        // Skip when the contact lives on the user's own domain —
        // colleagues at the user's company shouldn't show up in their
        // team's CRM. Malformed user emails fall through to the regular
        // populate path; the link's email is treated as the source of
        // truth elsewhere, so we don't want a bad value here to error
        // out an otherwise valid contact populate.
        if let Some((user_local_part, user_domain)) = user_email.trim().split_once('@')
            && !user_local_part.is_empty()
            && !user_domain.is_empty()
            && !user_domain.contains('@')
            && user_domain.eq_ignore_ascii_case(domain)
        {
            tracing::debug!(
                domain,
                "Skipping CRM populate for contact on the user's own domain"
            );
            return Ok(());
        }

        // Skip personal / free-mail-provider domains (gmail, yahoo,
        // hotmail, …). CRM rows are meant to represent companies
        if is_generic_email_domain(domain) {
            tracing::debug!(
                domain,
                "Skipping CRM populate for generic email provider domain"
            );
            return Ok(());
        }

        // Ensure `crm_domain_directory` has an entry for this domain
        // before the populate tx — the populate tx no longer carries any
        // name metadata of its own, and we don't want to hold its
        // advisory lock across an HTTP fetch. The directory upsert is
        // its own transaction, idempotent under concurrent populates
        // for the same domain (first-write-wins via the unique index
        // on `LOWER(domain)`).
        if self
            .companies_repository
            .lookup_domain_metadata(domain)
            .await?
            .is_none()
        {
            let metadata = self.metadata_resolver.resolve(domain).await;
            self.companies_repository
                .upsert_domain_metadata(domain, &metadata)
                .await?;
        }

        self.companies_repository
            .populate_contact(team_id, link_id, domain, email, name)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn depopulate_contact(
        &self,
        team_id: &uuid::Uuid,
        link_id: &uuid::Uuid,
        email: &str,
    ) -> Result<(), CrmError> {
        let email = email.trim();
        let Some((local_part, domain)) = email.split_once('@') else {
            tracing::debug!(
                email,
                "depopulate_contact: skipping malformed email (no '@')"
            );
            return Ok(());
        };
        if local_part.is_empty() || domain.is_empty() || domain.contains('@') {
            tracing::debug!(
                email,
                "depopulate_contact: skipping malformed email (empty part or multiple '@')"
            );
            return Ok(());
        }
        self.companies_repository
            .depopulate_contact(team_id, link_id, domain, email)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn depopulate_link_in_team(
        &self,
        team_id: &uuid::Uuid,
        link_id: &uuid::Uuid,
    ) -> Result<(), CrmError> {
        self.companies_repository
            .depopulate_link_in_team(team_id, link_id)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_team_id_for_user(&self, macro_id: &str) -> Result<Option<uuid::Uuid>, CrmError> {
        self.companies_repository
            .get_team_id_for_user(macro_id)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn set_email_sync(
        &self,
        team_id: &uuid::Uuid,
        company_id: &uuid::Uuid,
        email_sync: bool,
    ) -> Result<(), CrmError> {
        self.companies_repository
            .set_email_sync(team_id, company_id, email_sync)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn set_company_hidden(
        &self,
        team_id: &uuid::Uuid,
        company_id: &uuid::Uuid,
        hidden: bool,
    ) -> Result<(), CrmError> {
        self.companies_repository
            .set_company_hidden(team_id, company_id, hidden)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn set_contact_hidden(
        &self,
        team_id: &uuid::Uuid,
        contact_id: &uuid::Uuid,
        hidden: bool,
    ) -> Result<(), CrmError> {
        self.companies_repository
            .set_contact_hidden(team_id, contact_id, hidden)
            .await
    }
}
