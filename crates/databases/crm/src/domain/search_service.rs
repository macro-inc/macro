//! The CrmSearchService trait and its default implementation.

use entity_access::domain::models::{MemberTeamRole, TeamRole};
use uuid::Uuid;

use crate::domain::{
    auth::CrmTeamReceipt,
    model::{CrmCompanyForSoup, CrmError},
    search_repo::{CrmCompanyNameMatch, CrmCompanySearchCursor, CrmSearchRepository},
};

/// Read-only search over CRM records, backed by a [`CrmSearchRepository`].
pub trait CrmSearchService: Clone + Send + Sync + 'static {
    /// Name/domain search over the CRM companies owned by the team in
    /// `access`. The team is derived from the capability-token receipt
    /// (minted from a verified team membership), so authorization is a
    /// compile-time precondition rather than a default-team lookup. See
    /// [`CrmSearchRepository::search_company_names`].
    fn search_company_names(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        term: &str,
        company_ids: &[Uuid],
        hidden: Option<bool>,
        limit: i64,
        cursor: Option<CrmCompanySearchCursor>,
    ) -> impl Future<Output = Result<Vec<CrmCompanyNameMatch>, CrmError>> + Send;

    /// Hydrate matched company ids into the full listing shape (name +
    /// description + domains), scoped to the team in `access`. The batch
    /// enrich step that follows a name match — see
    /// [`CrmSearchRepository::enrich_companies`].
    fn enrich_companies(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
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
    #[tracing::instrument(skip(self, access), err)]
    async fn search_company_names(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        term: &str,
        company_ids: &[Uuid],
        hidden: Option<bool>,
        limit: i64,
        cursor: Option<CrmCompanySearchCursor>,
    ) -> Result<Vec<CrmCompanyNameMatch>, CrmError> {
        let team_id = access.team_id();
        // Members see only visible companies; admins/owners may also reach
        // hidden ones. Derived from the receipt's actual team role, so the
        // service — not the caller — enforces the hidden gate.
        let include_hidden = access
            .receipt()
            .entity_permission()
            .allows_team_role(TeamRole::Admin);
        self.search_repository
            .search_company_names(
                &team_id,
                term,
                company_ids,
                hidden,
                include_hidden,
                limit,
                cursor,
            )
            .await
    }

    #[tracing::instrument(skip(self, access), err)]
    async fn enrich_companies(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        company_ids: &[Uuid],
    ) -> Result<Vec<CrmCompanyForSoup>, CrmError> {
        let team_id = access.team_id();
        let include_hidden = access
            .receipt()
            .entity_permission()
            .allows_team_role(TeamRole::Admin);
        self.search_repository
            .enrich_companies(&team_id, company_ids, include_hidden)
            .await
    }
}
