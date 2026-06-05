//! The CrmSearchService trait and its default implementation.

use uuid::Uuid;

use crate::domain::{
    model::{CrmCompanyForSoup, CrmError},
    search_repo::{CrmCompanyNameMatch, CrmCompanySearchCursor, CrmSearchRepository},
};

/// Read-only search over CRM records, backed by a [`CrmSearchRepository`].
pub trait CrmSearchService: Clone + Send + Sync + 'static {
    /// Name/domain search over the CRM companies visible to `user_id`'s
    /// team. Resolves the user's team first and returns an empty vec when
    /// the user has no team membership (so callers can treat "no CRM" the
    /// same as "no matches"). See
    /// [`CrmSearchRepository::search_company_names`].
    fn search_company_names_for_user(
        &self,
        user_id: &str,
        term: &str,
        company_ids: &[Uuid],
        hidden: Option<bool>,
        limit: i64,
        cursor: Option<CrmCompanySearchCursor>,
    ) -> impl Future<Output = Result<Vec<CrmCompanyNameMatch>, CrmError>> + Send;

    /// Hydrate matched company ids into the full listing shape (name +
    /// description + domains), scoped to `user_id`'s team. The batch
    /// enrich step that follows a name match — see
    /// [`CrmSearchRepository::enrich_companies`]. Returns an empty vec
    /// when the user has no team.
    fn enrich_companies_for_user(
        &self,
        user_id: &str,
        company_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<CrmCompanyForSoup>, CrmError>> + Send;
}

/// [`CrmSearchService`] backed by a [`CrmSearchRepository`].
#[derive(Debug)]
pub struct CrmSearchServiceImpl<SR>
where
    SR: CrmSearchRepository,
{
    /// The underlying search repository.
    search_repository: SR,
}

impl<SR> Clone for CrmSearchServiceImpl<SR>
where
    SR: CrmSearchRepository,
{
    fn clone(&self) -> Self {
        Self {
            search_repository: self.search_repository.clone(),
        }
    }
}

impl<SR> CrmSearchServiceImpl<SR>
where
    SR: CrmSearchRepository,
{
    /// Creates a new CrmSearchServiceImpl.
    pub fn new(search_repository: SR) -> Self {
        Self { search_repository }
    }
}

impl<SR> CrmSearchService for CrmSearchServiceImpl<SR>
where
    SR: CrmSearchRepository,
{
    #[tracing::instrument(skip(self), err)]
    async fn search_company_names_for_user(
        &self,
        user_id: &str,
        term: &str,
        company_ids: &[Uuid],
        hidden: Option<bool>,
        limit: i64,
        cursor: Option<CrmCompanySearchCursor>,
    ) -> Result<Vec<CrmCompanyNameMatch>, CrmError> {
        let Some(team_id) = self.search_repository.get_team_id_for_user(user_id).await? else {
            return Ok(Vec::new());
        };
        self.search_repository
            .search_company_names(&team_id, term, company_ids, hidden, limit, cursor)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn enrich_companies_for_user(
        &self,
        user_id: &str,
        company_ids: &[Uuid],
    ) -> Result<Vec<CrmCompanyForSoup>, CrmError> {
        let Some(team_id) = self.search_repository.get_team_id_for_user(user_id).await? else {
            return Ok(Vec::new());
        };
        self.search_repository
            .enrich_companies(&team_id, company_ids)
            .await
    }
}
