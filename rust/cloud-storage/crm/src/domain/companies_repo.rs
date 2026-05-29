//! Port for persistence operations on CRM companies.

use crate::domain::comment::{
    CrmComment, CrmCommentEntityType, CrmCommentThread, DeleteCrmCommentResult,
};
use crate::domain::model::{
    CrmCompany, CrmCompanyForSoup, CrmContact, CrmError, CrmScopePrecheck, DomainMetadata,
};
use chrono::{DateTime, Utc};
use serde_json::Value;

/// Sort order for [`CompaniesRepository::list_companies_for_soup`].
/// Both variants tiebreak on `id DESC` for deterministic pagination.
#[derive(Debug, Clone, Copy)]
pub enum CrmCompanyListSort {
    /// Sort by `crm_companies.last_interaction` DESC.
    UpdatedAt,
    /// Sort by `crm_companies.first_interaction` DESC.
    CreatedAt,
}

/// Keyset cursor for [`CompaniesRepository::list_companies_for_soup`].
/// Carries the sort timestamp + id of the previous soup page's last row
/// so the next page seeks strictly past it. `None` = first page.
#[derive(Debug, Clone, Copy)]
pub struct CrmCompanySoupCursor {
    /// Sort timestamp of the previous page's last row —
    /// `first_interaction`/`last_interaction` per [`CrmCompanyListSort`].
    pub last_sort_ts: DateTime<Utc>,
    /// Id of the previous page's last row; tiebreaks equal timestamps.
    pub last_id: uuid::Uuid,
}

/// The CompaniesRepository defines persistence operations for CRM
/// companies and their associated domains.
pub trait CompaniesRepository: Clone + Send + Sync + 'static {
    /// Fetches the company for the given team that has `domain` registered
    /// against it, hydrated with the full list of domains belonging to that
    /// company. Returns `Ok(None)` when no company in the team has the
    /// domain registered. Domain matching is case-insensitive.
    fn get_company_by_domain(
        &self,
        team_id: &uuid::Uuid,
        domain: &str,
    ) -> impl Future<Output = Result<Option<CrmCompany>, CrmError>> + Send;

    /// Idempotently records that `email` (which lives on `domain`) was seen
    /// from the mailbox identified by `link_id`, for the team `team_id`.
    /// Performs the company/domain/contact/contact_source upserts in a single
    /// transaction:
    ///
    /// 0. Read `team_crm_settings.crm_enabled` for `team_id`. If missing
    ///    or `false`, the team has CRM turned off team-wide: no rows
    ///    are written and the method returns `Ok(())` so the caller
    ///    can ack the job. The read happens inside this tx (after the
    ///    advisory lock) so a concurrent `PATCH /team/crm`
    ///    disable — which flips the flag and purges `crm_companies` in
    ///    one tx — can't race past us and leave an orphan row.
    /// 1. Look up the company for `(team_id, domain)`.
    ///    - If a row exists with `email_sync = false` the team has opted
    ///      this domain out (the per-domain killswitch): no rows are
    ///      written and the method returns `Ok(())` so the caller can
    ///      ack the job.
    ///    - If a row exists with `email_sync = true` it is reused and its
    ///      `updated_at` is refreshed.
    ///    - Otherwise a new `crm_companies` row and a matching
    ///      `crm_domains` row are inserted. The company name itself
    ///      lives in `crm_domain_directory` keyed by `domain`, not on
    ///      `crm_companies` — see [`lookup_domain_metadata`] /
    ///      [`upsert_domain_metadata`].
    /// 2. Upsert `crm_contacts (company_id, email, name)`, refreshing
    ///    `updated_at` on existing contacts while preserving the first
    ///    non-NULL name with `name = COALESCE(crm_contacts.name, EXCLUDED.name)`.
    /// 3. Upsert `crm_contact_sources (contact_id, link_id)` with
    ///    `ON CONFLICT DO NOTHING`.
    ///
    /// `domain` and `email` are both normalized to lowercase before storage
    /// and comparison. `name` is the display name observed for `email` on
    /// this user's link (sourced from `email_contacts.name` by the
    /// caller); pass `None` when no display name is available.
    ///
    /// `first_at` / `last_at` are the contact's known interaction
    /// range. Per-message callers set both to the message's
    /// `internal_date_ts`; the historical seed pre-aggregates MIN/MAX
    /// across the contact's messages. Written to `first_interaction` /
    /// `last_interaction` (not `created_at` / `updated_at`, which keep
    /// their row-lifecycle semantics — DEFAULT `now()` on INSERT and
    /// the `set_crm_updated_at` trigger on UPDATE).
    ///
    /// `is_sent` flags whether the populating message was sent by the
    /// user. Insert semantics:
    ///
    /// - **`is_sent=true`**: full populate. INSERT a new
    ///   `crm_companies` row when none exists; on existing, refresh
    ///   `first_interaction = LEAST(stored, $first_at)` and
    ///   `last_interaction = GREATEST(stored, $last_at)`. Upsert
    ///   `crm_contacts` with the same merge. Upsert
    ///   `crm_contact_sources`.
    /// - **`is_sent=false`**: no-op when no `crm_companies` row exists
    ///   for `(team, domain)`. When one exists, refresh only the
    ///   company's `last_interaction = GREATEST(stored, $last_at)`
    ///   (do NOT touch `first_interaction`). Upsert `crm_contacts` —
    ///   new contacts INSERT with both endpoints; existing contacts
    ///   get `last_interaction = GREATEST(...)` only. Upsert
    ///   `crm_contact_sources`.
    ///
    /// The `email_sync=false` per-domain killswitch short-circuits in
    /// both directions. Source rows track all interactions (sent or
    /// received), not just sent — see also
    /// [`CompaniesRepository::depopulate_contact`].
    ///
    /// The caller is expected to have ensured a `crm_domain_directory`
    /// entry exists for `domain` (via [`upsert_domain_metadata`]) before
    /// invoking when `is_sent=true` — this method writes no metadata of
    /// its own. `is_sent=false` doesn't need it.
    ///
    /// [`lookup_domain_metadata`]: CompaniesRepository::lookup_domain_metadata
    /// [`upsert_domain_metadata`]: CompaniesRepository::upsert_domain_metadata
    #[allow(clippy::too_many_arguments)]
    fn populate_contact(
        &self,
        team_id: &uuid::Uuid,
        link_id: &uuid::Uuid,
        domain: &str,
        email: &str,
        name: Option<&str>,
        first_at: DateTime<Utc>,
        last_at: DateTime<Utc>,
        is_sent: bool,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;

    /// Read the cached [`DomainMetadata`] for `domain` from
    /// `crm_domain_directory`, if any. `domain` is matched
    /// case-insensitively. Returns `Ok(None)` when no row exists for
    /// the domain — the caller is expected to resolve via
    /// [`crate::domain::company_metadata_resolver::CompanyMetadataResolver`]
    /// and then [`upsert_domain_metadata`] before retrying.
    ///
    /// `Some(DomainMetadata { name: None, ... })` is distinct from
    /// `None`: it means the domain has been looked up before and the
    /// resolver returned nothing useful — the negative-cache entry
    /// suppresses further resolver calls.
    ///
    /// [`upsert_domain_metadata`]: CompaniesRepository::upsert_domain_metadata
    fn lookup_domain_metadata(
        &self,
        domain: &str,
    ) -> impl Future<Output = Result<Option<DomainMetadata>, CrmError>> + Send;

    /// Insert `metadata` for `domain` into `crm_domain_directory` with
    /// `ON CONFLICT (LOWER(domain)) DO NOTHING`. The directory is a
    /// global, first-write-wins cache: a row for `domain` (whether
    /// populated or all-NULL) is preserved as-is for the lifetime of
    /// the table. `domain` is lower-cased before storage.
    ///
    /// Idempotent under concurrent calls — racing producers can both
    /// resolve the same domain and both call this method; the second
    /// is a no-op.
    fn upsert_domain_metadata(
        &self,
        domain: &str,
        metadata: &DomainMetadata,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;

    /// Reverses [`populate_contact`] for one `(link_id, email)`: drops the
    /// matching `crm_contact_sources` row, then `crm_contacts` if no other
    /// source rows remain for that contact, then `crm_companies` (cascading
    /// to `crm_domains`) if no other contact rows remain for that company
    /// **and** the company has `email_sync = true`. Companies with
    /// `email_sync = false` (the killswitch opt-out) are kept so the
    /// team's configuration survives teardown — a future populate will
    /// re-discover the row and short-circuit on the same flag.
    ///
    /// Source and contact rows are derived data and are always cleaned
    /// up regardless of the killswitch.
    ///
    /// The whole cascade runs in a single transaction that begins by
    /// acquiring the same advisory lock [`populate_contact`] takes (key
    /// `"{team_id}:{lower(domain)}"`) **before** observing any state, so
    /// a concurrent in-flight populate for the same `(team_id, domain)`
    /// can't slip an uncommitted insert past the existence check.
    ///
    /// No-op (returns `Ok(())`) when the contact / company / domain is
    /// not found for `(team_id, domain, email)`. `domain` and `email` are
    /// matched case-insensitively.
    fn depopulate_contact(
        &self,
        team_id: &uuid::Uuid,
        link_id: &uuid::Uuid,
        domain: &str,
        email: &str,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;

    /// Bulk counterpart to [`depopulate_contact`]: removes everything
    /// the link contributed to a single team's CRM rows. In one
    /// transaction:
    ///   1. Delete every `crm_contact_sources` row whose `link_id`
    ///      matches AND whose contact lives under `team_id`.
    ///   2. Delete every `crm_contacts` row in `team_id` that has no
    ///      remaining `crm_contact_sources` (orphaned by step 1 or by
    ///      any earlier cleanup race).
    ///   3. Delete every `crm_companies` row in `team_id` that has no
    ///      remaining `crm_contacts` AND `email_sync = true`. Companies
    ///      with `email_sync = false` are preserved so the team's
    ///      killswitch configuration survives teardown. `crm_domains`
    ///      falls out via FK cascade.
    ///
    /// Scoping every query to `team_id` keeps the blast radius bounded
    /// — sources the link contributed to a *different* team (from a
    /// prior membership) are untouched — and lets the orphan cleanup
    /// run as a single SQL pass per layer instead of snapshotting
    /// candidate ids into memory first.
    ///
    /// Does NOT take per-`(team, domain)` advisory locks. A link can
    /// span many domains within a team, and a concurrent populate on
    /// the same team won't see the user as a member once the team
    /// membership change has propagated, so the race window is benign.
    ///
    /// Used by the `DepopulateCrmForUser` backfill step (fired when a
    /// user is removed from a team).
    fn depopulate_link_in_team(
        &self,
        team_id: &uuid::Uuid,
        link_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;

    /// Returns the team id that `macro_id` belongs to. When the user is on
    /// multiple teams the highest-privileged role wins (Postgres orders the
    /// `team_role` enum as `member < admin < owner`), matching the
    /// behavior of `entity_access::ports::get_user_team`. Returns
    /// `Ok(None)` when the user has no team membership.
    fn get_team_id_for_user(
        &self,
        macro_id: &str,
    ) -> impl Future<Output = Result<Option<uuid::Uuid>, CrmError>> + Send;

    /// Toggle `crm_companies.email_sync` for `(company_id, team_id)`.
    /// On disable, the same tx also deletes the company's
    /// `crm_contacts` and `crm_contact_sources`. Returns
    /// [`CrmError::CompanyNotFoundForTeam`] on a non-matching pair.
    /// Refuses to set `email_sync = true` when the company has
    /// `hidden = true` (returns [`CrmError::CompanyHidden`]) — a hidden
    /// company would otherwise have populate re-create contacts under
    /// it. Un-hide first if you really want sync back on.
    fn set_email_sync(
        &self,
        team_id: &uuid::Uuid,
        company_id: &uuid::Uuid,
        email_sync: bool,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;

    /// Toggle `crm_companies.hidden` for `(company_id, team_id)`. When
    /// `hidden = true` this also sets `email_sync = false` and tears
    /// down the company's `crm_contacts` and `crm_contact_sources` in
    /// the **same transaction**, holding the same per-`(team, domain)`
    /// advisory locks [`set_email_sync`] takes. Un-hide (`hidden =
    /// false`) only flips the flag; `email_sync` is left as-is.
    /// Returns [`CrmError::CompanyNotFoundForTeam`] on a non-matching
    /// pair.
    ///
    /// [`set_email_sync`]: CompaniesRepository::set_email_sync
    fn set_company_hidden(
        &self,
        team_id: &uuid::Uuid,
        company_id: &uuid::Uuid,
        hidden: bool,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;

    /// Toggle `crm_contacts.hidden` for `contact_id`, scoped to
    /// `team_id` via the contact's company. Returns
    /// [`CrmError::ContactNotFoundForTeam`] when the contact does not
    /// exist or belongs to another team.
    fn set_contact_hidden(
        &self,
        team_id: &uuid::Uuid,
        contact_id: &uuid::Uuid,
        hidden: bool,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;

    /// Batched authorization probe for a CRM-scoped email query. Returns
    /// per-input status the email service maps into typed `EmailErr`
    /// variants (`CrmDomainNotFound`, `CrmDomainNotPermitted`,
    /// `CrmAddressNotFound`, `CrmAddressNotPermitted`,
    /// `CrmDisabledForTeam`).
    ///
    /// `domains` and `addresses` are expected to be lowercased by the
    /// caller. Either may be empty; both may be non-empty but the
    /// service-layer caller enforces mutual exclusivity.
    ///
    /// Read-only and not transactional — the dynamic query that follows
    /// re-checks the team-level killswitch via JOIN to close the race.
    fn crm_scope_precheck(
        &self,
        team_id: &uuid::Uuid,
        domains: &[String],
        addresses: &[String],
    ) -> impl Future<Output = Result<CrmScopePrecheck, CrmError>> + Send;

    /// Lists a team's CRM companies for the soup feed, hydrated with
    /// domains and primary-domain directory metadata. Honors the
    /// team-level killswitch (missing or `crm_enabled = false` →
    /// empty) and excludes `hidden = true` rows. Empty `company_ids`
    /// = all non-hidden companies; non-empty = whitelist. Both sort
    /// orders tiebreak on `id DESC`. `cursor` seeks strictly past the
    /// previous soup page's last row (`None` = first page).
    fn list_companies_for_soup(
        &self,
        team_id: &uuid::Uuid,
        company_ids: &[uuid::Uuid],
        sort: CrmCompanyListSort,
        cursor: Option<CrmCompanySoupCursor>,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<CrmCompanyForSoup>, CrmError>> + Send;

    /// Lists the non-hidden contacts of `company_id`, scoped to
    /// `team_id` via the contact's company. Returns
    /// [`CrmError::CompanyNotFoundForTeam`] when the company doesn't
    /// exist or isn't owned by the team (so existence doesn't leak
    /// across teams); an owned company with no visible contacts
    /// returns `Ok(vec![])`. Ordered alphabetically (case-insensitive)
    /// by display name, falling back to email when the contact has no
    /// name; ties break on `id DESC`.
    fn list_contacts_for_company(
        &self,
        team_id: &uuid::Uuid,
        company_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<Vec<CrmContact>, CrmError>> + Send;

    /// Create a CRM comment. With `thread_id = None` a new thread is opened
    /// on `(entity_type, entity_id)` and the comment becomes its root; with
    /// `Some`, the comment is appended to that existing thread (whose
    /// `updated_at` is bumped). Scoped to `team_id` via the entity's
    /// company: returns [`CrmError::CompanyNotFoundForTeam`] /
    /// [`CrmError::ContactNotFoundForTeam`] when the entity isn't owned by
    /// the team, or [`CrmError::ThreadNotFound`] when a supplied `thread_id`
    /// is deleted or doesn't belong to that entity. Returns the full thread
    /// (with all its comments) after the insert.
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

    /// List the non-deleted comment threads on `(entity_type, entity_id)`,
    /// each with its comments nested oldest-first; threads are ordered
    /// oldest-first by creation. Scoped to `team_id` via the entity's
    /// company — returns [`CrmError::CompanyNotFoundForTeam`] /
    /// [`CrmError::ContactNotFoundForTeam`] when the entity isn't owned by
    /// the team (so existence doesn't leak across teams); an owned entity
    /// with no threads returns `Ok(vec![])`.
    fn get_crm_comment_threads(
        &self,
        team_id: &uuid::Uuid,
        entity_type: CrmCommentEntityType,
        entity_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<Vec<CrmCommentThread>, CrmError>> + Send;

    /// Edit a CRM comment's `text`, scoped to `team_id` via the comment's
    /// thread → entity → company. Returns the updated comment, or
    /// [`CrmError::CommentNotFound`] when it doesn't exist or isn't owned by
    /// the team.
    fn edit_crm_comment(
        &self,
        team_id: &uuid::Uuid,
        comment_id: &uuid::Uuid,
        text: &str,
    ) -> impl Future<Output = Result<CrmComment, CrmError>> + Send;

    /// Soft-delete a CRM comment (sets `deleted_at`), scoped to `team_id`.
    /// When it was the thread's last live comment, the thread is
    /// soft-deleted too (reported via
    /// [`DeleteCrmCommentResult::thread_deleted`]). Returns
    /// [`CrmError::CommentNotFound`] when the comment doesn't exist, is
    /// already deleted, or isn't owned by the team.
    fn delete_crm_comment(
        &self,
        team_id: &uuid::Uuid,
        comment_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<DeleteCrmCommentResult, CrmError>> + Send;
}
