//! Port + domain types for CRM company search (name / domain).

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::domain::model::{CrmCompanyForSoup, CrmError};

/// A single CRM company name/domain match.
#[derive(Debug, Clone)]
pub struct CrmCompanyNameMatch {
    /// The company id.
    pub id: Uuid,
    /// The company's display name.
    pub name: String,
    /// `name` with matched spans wrapped in `<macro_em>…</macro_em>`.
    pub name_highlighted: String,
    /// The company's last-interaction time (its "updated_at"), used as the
    /// sort + keyset-pagination key.
    pub updated_at: DateTime<Utc>,
}

/// Keyset cursor for company-name search. Seeks strictly past the last
/// row of the previous page under the `(updated_at DESC, id DESC)` sort.
/// `None` = first page.
#[derive(Debug, Clone, Copy)]
pub struct CrmCompanySearchCursor {
    /// `updated_at` of the previous page's last row.
    pub last_updated_at: DateTime<Utc>,
    /// Id of the previous page's last row; tiebreaks equal timestamps.
    pub last_id: Uuid,
}

/// Persistence port for CRM company search.
pub trait CrmSearchRepository: Clone + Send + Sync + 'static {
    /// Returns the team `macro_id` belongs to (highest `team_role` wins),
    /// or `None` when the user has no team membership.
    fn get_team_id_for_user(
        &self,
        macro_id: &str,
    ) -> impl Future<Output = Result<Option<Uuid>, CrmError>> + Send;

    /// Searches a team's CRM companies by `term` over the company name and
    /// its domains (`crm_domains.domain`), case-insensitive substring
    /// match. `company_ids` restricts to those ids when non-empty;
    /// `hidden` defaults to visible-only when `None` (`Some(true)` =
    /// hidden only, requires admin/owner — enforced by the caller).
    /// Results are ordered `(updated_at DESC, id DESC)` and capped at
    /// `limit`; pass `cursor` to seek past a previous page.
    fn search_company_names(
        &self,
        team_id: &Uuid,
        term: &str,
        company_ids: &[Uuid],
        hidden: Option<bool>,
        limit: i64,
        cursor: Option<CrmCompanySearchCursor>,
    ) -> impl Future<Output = Result<Vec<CrmCompanyNameMatch>, CrmError>> + Send;

    /// Hydrate a set of matched company ids (scoped to `team_id`) into the
    /// full listing shape — directory display name/description from the
    /// primary (earliest-created) domain plus the company's domains. This
    /// is the batch enrich step: same join shape as the single-company
    /// `get_company_for_team`, minus contacts. Companies not owned by the
    /// team are silently dropped. Result order is unspecified — callers
    /// re-order by the match results.
    fn enrich_companies(
        &self,
        team_id: &Uuid,
        company_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<CrmCompanyForSoup>, CrmError>> + Send;
}
