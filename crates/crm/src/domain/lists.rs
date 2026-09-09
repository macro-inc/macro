//! CRM lists: curated collections over a team's companies or contacts whose
//! entries carry their own properties through the `CrmListEntry` entity type.
//! Slice 3 spike of the lists RFD; the built-in Deals list, entry deletion
//! and inline properties are not here yet.

use chrono::{DateTime, Utc};
use entity_access::domain::models::MemberTeamRole;
use uuid::Uuid;

use crate::domain::{auth::CrmTeamReceipt, model::CrmError};

#[cfg(test)]
mod test;

/// Maximum list name length.
pub const MAX_LIST_NAME_CHARS: usize = 100;

/// The record type a list collects.
#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type)]
#[sqlx(type_name = "crm_list_parent_type", rename_all = "lowercase")]
pub enum CrmListParentType {
    /// Entries point at `crm_companies` rows.
    Company,
    /// Entries point at `crm_contacts` rows.
    Contact,
}

impl CrmListParentType {
    /// The enum label as stored in Postgres.
    pub fn as_db_str(self) -> &'static str {
        match self {
            Self::Company => "company",
            Self::Contact => "contact",
        }
    }
}

/// A team's list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CrmList {
    /// List id.
    pub id: Uuid,
    /// Owning team.
    pub team_id: Uuid,
    /// Display name, unique within the team.
    pub name: String,
    /// What the entries point at.
    pub parent_type: CrmListParentType,
    /// The seeded Deals list; cannot be deleted.
    pub builtin: bool,
    /// When the list was created.
    pub created_at: DateTime<Utc>,
    /// When the list was last updated.
    pub updated_at: DateTime<Utc>,
}

/// One record's membership in a list. Properties attach to `id` under the
/// `CrmListEntry` entity type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CrmListEntry {
    /// Entry id.
    pub id: Uuid,
    /// The list.
    pub list_id: Uuid,
    /// The company or contact, per the list's parent type.
    pub parent_id: Uuid,
    /// When the entry was created.
    pub created_at: DateTime<Utc>,
    /// When the entry was last updated.
    pub updated_at: DateTime<Utc>,
}

/// Outbound port over `crm_lists` and `crm_list_entries`.
pub trait ListStore: Send + Sync + 'static {
    /// The team's lists, by name.
    fn list_lists(
        &self,
        team_id: &Uuid,
    ) -> impl Future<Output = Result<Vec<CrmList>, CrmError>> + Send;

    /// Create a list; `Err(InvalidRequest)` when the name is taken.
    fn create_list(
        &self,
        team_id: &Uuid,
        name: &str,
        parent_type: CrmListParentType,
    ) -> impl Future<Output = Result<CrmList, CrmError>> + Send;

    /// A list owned by the team, `None` otherwise.
    fn get_list(
        &self,
        team_id: &Uuid,
        list_id: &Uuid,
    ) -> impl Future<Output = Result<Option<CrmList>, CrmError>> + Send;

    /// A list's entries, oldest first, dropping those whose parent record is
    /// hidden unless `include_hidden`.
    fn list_entries(
        &self,
        list_id: &Uuid,
        include_hidden: bool,
    ) -> impl Future<Output = Result<Vec<CrmListEntry>, CrmError>> + Send;

    /// Whether the team owns a visible (or, with `include_hidden`, any)
    /// record of the given type and id.
    fn parent_exists(
        &self,
        team_id: &Uuid,
        parent_type: CrmListParentType,
        parent_id: &Uuid,
        include_hidden: bool,
    ) -> impl Future<Output = Result<bool, CrmError>> + Send;

    /// Add a record to a list. A record may be added more than once.
    fn create_entry(
        &self,
        list_id: &Uuid,
        parent_id: &Uuid,
    ) -> impl Future<Output = Result<CrmListEntry, CrmError>> + Send;
}

/// Team-scoped list operations.
pub trait CrmListService: Send + Sync + 'static {
    /// The caller's team's lists.
    fn list_lists(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
    ) -> impl Future<Output = Result<Vec<CrmList>, CrmError>> + Send;

    /// Create a list; admin or owner only.
    fn create_list(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        name: String,
        parent_type: CrmListParentType,
    ) -> impl Future<Output = Result<CrmList, CrmError>> + Send;

    /// Entries of one of the team's lists.
    fn list_entries(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        list_id: Uuid,
    ) -> impl Future<Output = Result<Vec<CrmListEntry>, CrmError>> + Send;

    /// Add a company or contact to one of the team's lists.
    fn add_entry(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        list_id: Uuid,
        parent_id: Uuid,
    ) -> impl Future<Output = Result<CrmListEntry, CrmError>> + Send;
}

/// [`CrmListService`] over a [`ListStore`].
#[derive(Debug, Clone)]
pub struct CrmListServiceImpl<S> {
    store: S,
}

impl<S: ListStore> CrmListServiceImpl<S> {
    /// Wrap a store.
    pub fn new(store: S) -> Self {
        Self { store }
    }

    async fn require_list(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        list_id: Uuid,
    ) -> Result<CrmList, CrmError> {
        self.store
            .get_list(&access.team_id(), &list_id)
            .await?
            .ok_or(CrmError::ListNotFoundForTeam)
    }
}

impl<S: ListStore> CrmListService for CrmListServiceImpl<S> {
    #[tracing::instrument(skip(self, access), err)]
    async fn list_lists(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
    ) -> Result<Vec<CrmList>, CrmError> {
        self.store.list_lists(&access.team_id()).await
    }

    #[tracing::instrument(skip(self, access), err)]
    async fn create_list(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        name: String,
        parent_type: CrmListParentType,
    ) -> Result<CrmList, CrmError> {
        if !access.has_admin_role() {
            return Err(CrmError::ListAdminRequired);
        }
        let name = name.trim();
        if name.is_empty() {
            return Err(CrmError::InvalidRequest("list name is required".into()));
        }
        if name.chars().count() > MAX_LIST_NAME_CHARS {
            return Err(CrmError::InvalidRequest(format!(
                "list name must be at most {MAX_LIST_NAME_CHARS} characters"
            )));
        }
        self.store
            .create_list(&access.team_id(), name, parent_type)
            .await
    }

    #[tracing::instrument(skip(self, access), err)]
    async fn list_entries(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        list_id: Uuid,
    ) -> Result<Vec<CrmListEntry>, CrmError> {
        let list = self.require_list(access, list_id).await?;
        self.store
            .list_entries(&list.id, access.include_hidden())
            .await
    }

    #[tracing::instrument(skip(self, access), err)]
    async fn add_entry(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        list_id: Uuid,
        parent_id: Uuid,
    ) -> Result<CrmListEntry, CrmError> {
        let list = self.require_list(access, list_id).await?;
        let exists = self
            .store
            .parent_exists(
                &access.team_id(),
                list.parent_type,
                &parent_id,
                access.include_hidden(),
            )
            .await?;
        if !exists {
            return Err(match list.parent_type {
                CrmListParentType::Company => CrmError::CompanyNotFoundForTeam,
                CrmListParentType::Contact => CrmError::ContactNotFoundForTeam,
            });
        }
        self.store.create_entry(&list.id, &parent_id).await
    }
}

/// [`CrmListService`] that panics on every call.
#[derive(Clone, Debug)]
pub struct NoOpCrmListService;

impl CrmListService for NoOpCrmListService {
    async fn list_lists(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
    ) -> Result<Vec<CrmList>, CrmError> {
        unimplemented!("NoOpCrmListService")
    }

    async fn create_list(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
        _name: String,
        _parent_type: CrmListParentType,
    ) -> Result<CrmList, CrmError> {
        unimplemented!("NoOpCrmListService")
    }

    async fn list_entries(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
        _list_id: Uuid,
    ) -> Result<Vec<CrmListEntry>, CrmError> {
        unimplemented!("NoOpCrmListService")
    }

    async fn add_entry(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
        _list_id: Uuid,
        _parent_id: Uuid,
    ) -> Result<CrmListEntry, CrmError> {
        unimplemented!("NoOpCrmListService")
    }
}
