//! The CrmService trait and its default implementation.

use crate::domain::{
    comment::{CrmComment, CrmCommentEntityType, CrmCommentThread, DeleteCrmCommentResult},
    companies_repo::{CompaniesRepository, CrmCompanyListSort, CrmCompanySoupCursor},
    company_metadata_resolver::CompanyMetadataResolver,
    generic_email_domains::is_generic_email_domain,
    model::{CrmCompany, CrmCompanyForSoup, CrmContact, CrmError, CrmScopePrecheck},
};
use chrono::{DateTime, Utc};
use serde_json::Value;

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
    ///
    /// `first_at` / `last_at` are the contact's known activity range
    /// for this populate. Per-message paths pass the message's
    /// `internal_date_ts` as both (single message = single endpoint).
    /// The historical seed (`populate_crm_for_user`) pre-aggregates
    /// MIN/MAX over the contact's matching messages and passes the
    /// real range, so a single populate per contact stamps the CRM
    /// rows with the full span. Callers without a real timestamp pass
    /// `Utc::now()`. `created_at` / `updated_at` keep their
    /// row-lifecycle semantics (DEFAULT `now()` /
    /// `set_crm_updated_at` trigger).
    ///
    /// `is_sent` flags whether the populating message was sent by the
    /// user. The write matrix:
    ///
    /// | `is_sent` | No `crm_companies` row | Existing `crm_companies` row (`email_sync=true`) |
    /// |---|---|---|
    /// | `true`  | INSERT company + contact + source; `first_interaction = $first_at`, `last_interaction = $last_at`. | UPDATE company `first=LEAST(stored, $first_at), last=GREATEST(stored, $last_at)` + upsert contact (same merge) + upsert source. |
    /// | `false` | **No-op** — no domain-metadata resolve, no inserts. | UPDATE company `last=GREATEST(stored, $last_at)` only (do NOT touch `first_interaction`) + upsert contact (INSERT sets both endpoints; ON CONFLICT bumps `last` only) + upsert source. |
    ///
    /// The `email_sync=false` per-domain killswitch short-circuits in
    /// both directions.
    #[allow(clippy::too_many_arguments)]
    fn populate_contact(
        &self,
        team_id: &uuid::Uuid,
        link_id: &uuid::Uuid,
        user_email: &str,
        email: &str,
        name: Option<&str>,
        first_at: DateTime<Utc>,
        last_at: DateTime<Utc>,
        is_sent: bool,
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

    /// Batched authorization probe for a CRM-scoped email query. See
    /// [`CompaniesRepository::crm_scope_precheck`].
    fn crm_scope_precheck(
        &self,
        team_id: &uuid::Uuid,
        domains: &[String],
        addresses: &[String],
    ) -> impl Future<Output = Result<CrmScopePrecheck, CrmError>> + Send;

    /// List the team's CRM companies for the soup feed. See
    /// [`CompaniesRepository::list_companies_for_soup`].
    fn list_companies_for_soup(
        &self,
        team_id: &uuid::Uuid,
        company_ids: &[uuid::Uuid],
        sort: CrmCompanyListSort,
        cursor: Option<CrmCompanySoupCursor>,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<CrmCompanyForSoup>, CrmError>> + Send;

    /// List a company's non-hidden contacts, scoped to `team_id`. See
    /// [`CompaniesRepository::list_contacts_for_company`].
    fn list_contacts_for_company(
        &self,
        team_id: &uuid::Uuid,
        company_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<Vec<CrmContact>, CrmError>> + Send;

    /// Create a comment on a CRM company or contact, optionally as a reply
    /// to an existing thread. See
    /// [`CompaniesRepository::create_crm_comment`]. Authorization (team
    /// membership) is the caller's responsibility; the entity-ownership
    /// scoping is enforced in the repository.
    #[allow(clippy::too_many_arguments)]
    fn create_crm_comment(
        &self,
        team_id: &uuid::Uuid,
        entity_type: CrmCommentEntityType,
        entity_id: &uuid::Uuid,
        owner: &str,
        thread_id: Option<uuid::Uuid>,
        thread_metadata: Option<Value>,
        text: &str,
        metadata: Option<Value>,
    ) -> impl Future<Output = Result<CrmCommentThread, CrmError>> + Send;

    /// List a CRM entity's comment threads. See
    /// [`CompaniesRepository::get_crm_comment_threads`].
    fn get_crm_comment_threads(
        &self,
        team_id: &uuid::Uuid,
        entity_type: CrmCommentEntityType,
        entity_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<Vec<CrmCommentThread>, CrmError>> + Send;

    /// Edit a CRM comment's text, scoped to `team_id`. See
    /// [`CompaniesRepository::edit_crm_comment`].
    fn edit_crm_comment(
        &self,
        team_id: &uuid::Uuid,
        comment_id: &uuid::Uuid,
        text: &str,
    ) -> impl Future<Output = Result<CrmComment, CrmError>> + Send;

    /// Soft-delete a CRM comment, scoped to `team_id`. See
    /// [`CompaniesRepository::delete_crm_comment`].
    fn delete_crm_comment(
        &self,
        team_id: &uuid::Uuid,
        comment_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<DeleteCrmCommentResult, CrmError>> + Send;
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
    #[allow(clippy::too_many_arguments)]
    async fn populate_contact(
        &self,
        team_id: &uuid::Uuid,
        link_id: &uuid::Uuid,
        user_email: &str,
        email: &str,
        name: Option<&str>,
        first_at: DateTime<Utc>,
        last_at: DateTime<Utc>,
        is_sent: bool,
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
        //
        // Skip the resolve when `is_sent=false`: a received-direction
        // populate never inserts a new `crm_companies` row, so we don't
        // need to seed metadata. If the domain is already tracked the
        // directory entry was written when its first sent message
        // populated; if it isn't tracked, this call will no-op in the
        // repo anyway.
        if is_sent
            && self
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
            .populate_contact(
                team_id, link_id, domain, email, name, first_at, last_at, is_sent,
            )
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

    #[tracing::instrument(skip(self), err)]
    async fn crm_scope_precheck(
        &self,
        team_id: &uuid::Uuid,
        domains: &[String],
        addresses: &[String],
    ) -> Result<CrmScopePrecheck, CrmError> {
        self.companies_repository
            .crm_scope_precheck(team_id, domains, addresses)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn list_companies_for_soup(
        &self,
        team_id: &uuid::Uuid,
        company_ids: &[uuid::Uuid],
        sort: CrmCompanyListSort,
        cursor: Option<CrmCompanySoupCursor>,
        limit: i64,
    ) -> Result<Vec<CrmCompanyForSoup>, CrmError> {
        self.companies_repository
            .list_companies_for_soup(team_id, company_ids, sort, cursor, limit)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn list_contacts_for_company(
        &self,
        team_id: &uuid::Uuid,
        company_id: &uuid::Uuid,
    ) -> Result<Vec<CrmContact>, CrmError> {
        self.companies_repository
            .list_contacts_for_company(team_id, company_id)
            .await
    }

    #[tracing::instrument(skip(self, thread_metadata, text, metadata), err)]
    #[allow(clippy::too_many_arguments)]
    async fn create_crm_comment(
        &self,
        team_id: &uuid::Uuid,
        entity_type: CrmCommentEntityType,
        entity_id: &uuid::Uuid,
        owner: &str,
        thread_id: Option<uuid::Uuid>,
        thread_metadata: Option<Value>,
        text: &str,
        metadata: Option<Value>,
    ) -> Result<CrmCommentThread, CrmError> {
        self.companies_repository
            .create_crm_comment(
                team_id,
                entity_type,
                entity_id,
                owner,
                thread_id,
                thread_metadata,
                text,
                metadata,
            )
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_crm_comment_threads(
        &self,
        team_id: &uuid::Uuid,
        entity_type: CrmCommentEntityType,
        entity_id: &uuid::Uuid,
    ) -> Result<Vec<CrmCommentThread>, CrmError> {
        self.companies_repository
            .get_crm_comment_threads(team_id, entity_type, entity_id)
            .await
    }

    #[tracing::instrument(skip(self, text), err)]
    async fn edit_crm_comment(
        &self,
        team_id: &uuid::Uuid,
        comment_id: &uuid::Uuid,
        text: &str,
    ) -> Result<CrmComment, CrmError> {
        self.companies_repository
            .edit_crm_comment(team_id, comment_id, text)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_crm_comment(
        &self,
        team_id: &uuid::Uuid,
        comment_id: &uuid::Uuid,
    ) -> Result<DeleteCrmCommentResult, CrmError> {
        self.companies_repository
            .delete_crm_comment(team_id, comment_id)
            .await
    }
}

/// No-op [`CrmService`] for binaries that need to satisfy the bound
/// but never call CRM. `list_companies_for_soup` returns empty; every
/// other method panics — swap for [`CrmServiceImpl`] if you actually
/// need CRM functionality.
#[derive(Clone, Debug)]
pub struct NoOpCrmService;

impl CrmService for NoOpCrmService {
    async fn get_company_by_domain(
        &self,
        _team_id: &uuid::Uuid,
        _domain: &str,
    ) -> Result<Option<CrmCompany>, CrmError> {
        unimplemented!("NoOpCrmService.get_company_by_domain")
    }

    async fn populate_contact(
        &self,
        _team_id: &uuid::Uuid,
        _link_id: &uuid::Uuid,
        _user_email: &str,
        _email: &str,
        _name: Option<&str>,
        _first_at: DateTime<Utc>,
        _last_at: DateTime<Utc>,
        _is_sent: bool,
    ) -> Result<(), CrmError> {
        unimplemented!("NoOpCrmService.populate_contact")
    }

    async fn depopulate_contact(
        &self,
        _team_id: &uuid::Uuid,
        _link_id: &uuid::Uuid,
        _email: &str,
    ) -> Result<(), CrmError> {
        unimplemented!("NoOpCrmService.depopulate_contact")
    }

    async fn depopulate_link_in_team(
        &self,
        _team_id: &uuid::Uuid,
        _link_id: &uuid::Uuid,
    ) -> Result<(), CrmError> {
        unimplemented!("NoOpCrmService.depopulate_link_in_team")
    }

    async fn get_team_id_for_user(&self, _macro_id: &str) -> Result<Option<uuid::Uuid>, CrmError> {
        unimplemented!("NoOpCrmService.get_team_id_for_user")
    }

    async fn set_email_sync(
        &self,
        _team_id: &uuid::Uuid,
        _company_id: &uuid::Uuid,
        _email_sync: bool,
    ) -> Result<(), CrmError> {
        unimplemented!("NoOpCrmService.set_email_sync")
    }

    async fn set_company_hidden(
        &self,
        _team_id: &uuid::Uuid,
        _company_id: &uuid::Uuid,
        _hidden: bool,
    ) -> Result<(), CrmError> {
        unimplemented!("NoOpCrmService.set_company_hidden")
    }

    async fn set_contact_hidden(
        &self,
        _team_id: &uuid::Uuid,
        _contact_id: &uuid::Uuid,
        _hidden: bool,
    ) -> Result<(), CrmError> {
        unimplemented!("NoOpCrmService.set_contact_hidden")
    }

    async fn crm_scope_precheck(
        &self,
        _team_id: &uuid::Uuid,
        _domains: &[String],
        _addresses: &[String],
    ) -> Result<CrmScopePrecheck, CrmError> {
        unimplemented!("NoOpCrmService.crm_scope_precheck")
    }

    async fn list_companies_for_soup(
        &self,
        _team_id: &uuid::Uuid,
        _company_ids: &[uuid::Uuid],
        _sort: CrmCompanyListSort,
        _cursor: Option<CrmCompanySoupCursor>,
        _limit: i64,
    ) -> Result<Vec<CrmCompanyForSoup>, CrmError> {
        Ok(Vec::new())
    }

    async fn list_contacts_for_company(
        &self,
        _team_id: &uuid::Uuid,
        _company_id: &uuid::Uuid,
    ) -> Result<Vec<CrmContact>, CrmError> {
        Ok(Vec::new())
    }

    #[allow(clippy::too_many_arguments)]
    async fn create_crm_comment(
        &self,
        _team_id: &uuid::Uuid,
        _entity_type: CrmCommentEntityType,
        _entity_id: &uuid::Uuid,
        _owner: &str,
        _thread_id: Option<uuid::Uuid>,
        _thread_metadata: Option<Value>,
        _text: &str,
        _metadata: Option<Value>,
    ) -> Result<CrmCommentThread, CrmError> {
        unimplemented!("NoOpCrmService.create_crm_comment")
    }

    async fn get_crm_comment_threads(
        &self,
        _team_id: &uuid::Uuid,
        _entity_type: CrmCommentEntityType,
        _entity_id: &uuid::Uuid,
    ) -> Result<Vec<CrmCommentThread>, CrmError> {
        Ok(Vec::new())
    }

    async fn edit_crm_comment(
        &self,
        _team_id: &uuid::Uuid,
        _comment_id: &uuid::Uuid,
        _text: &str,
    ) -> Result<CrmComment, CrmError> {
        unimplemented!("NoOpCrmService.edit_crm_comment")
    }

    async fn delete_crm_comment(
        &self,
        _team_id: &uuid::Uuid,
        _comment_id: &uuid::Uuid,
    ) -> Result<DeleteCrmCommentResult, CrmError> {
        unimplemented!("NoOpCrmService.delete_crm_comment")
    }
}
