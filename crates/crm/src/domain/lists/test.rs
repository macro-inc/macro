use std::sync::{Arc, Mutex};

use entity_access::domain::models::{
    Entity, EntityAccessReceipt, EntityPermission, EntityType, TeamRole,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};

use super::*;

#[derive(Clone, Default)]
struct MemoryStore {
    lists: Arc<Mutex<Vec<CrmList>>>,
    entries: Arc<Mutex<Vec<CrmListEntry>>>,
    /// `(team_id, parent_type, parent_id, hidden)` records the team owns.
    parents: Arc<Mutex<Vec<(Uuid, CrmListParentType, Uuid, bool)>>>,
}

impl MemoryStore {
    fn with_parent(
        self,
        team_id: Uuid,
        parent_type: CrmListParentType,
        hidden: bool,
    ) -> (Self, Uuid) {
        let id = Uuid::now_v7();
        self.parents
            .lock()
            .unwrap()
            .push((team_id, parent_type, id, hidden));
        (self, id)
    }

    fn with_list(self, team_id: Uuid, name: &str, parent_type: CrmListParentType) -> (Self, Uuid) {
        let list = new_list(team_id, name, parent_type);
        let id = list.id;
        self.lists.lock().unwrap().push(list);
        (self, id)
    }
}

fn new_list(team_id: Uuid, name: &str, parent_type: CrmListParentType) -> CrmList {
    let now = Utc::now();
    CrmList {
        id: Uuid::now_v7(),
        team_id,
        name: name.to_string(),
        parent_type,
        builtin: false,
        created_at: now,
        updated_at: now,
    }
}

impl ListStore for MemoryStore {
    async fn list_lists(&self, team_id: &Uuid) -> Result<Vec<CrmList>, CrmError> {
        Ok(self
            .lists
            .lock()
            .unwrap()
            .iter()
            .filter(|list| list.team_id == *team_id)
            .cloned()
            .collect())
    }

    async fn create_list(
        &self,
        team_id: &Uuid,
        name: &str,
        parent_type: CrmListParentType,
    ) -> Result<CrmList, CrmError> {
        let mut lists = self.lists.lock().unwrap();
        if lists
            .iter()
            .any(|list| list.team_id == *team_id && list.name == name)
        {
            return Err(CrmError::InvalidRequest("duplicate".into()));
        }
        let list = new_list(*team_id, name, parent_type);
        lists.push(list.clone());
        Ok(list)
    }

    async fn get_list(&self, team_id: &Uuid, list_id: &Uuid) -> Result<Option<CrmList>, CrmError> {
        Ok(self
            .lists
            .lock()
            .unwrap()
            .iter()
            .find(|list| list.id == *list_id && list.team_id == *team_id)
            .cloned())
    }

    async fn list_entries(
        &self,
        list_id: &Uuid,
        include_hidden: bool,
    ) -> Result<Vec<CrmListEntry>, CrmError> {
        let parents = self.parents.lock().unwrap();
        Ok(self
            .entries
            .lock()
            .unwrap()
            .iter()
            .filter(|entry| entry.list_id == *list_id)
            .filter(|entry| {
                include_hidden
                    || !parents
                        .iter()
                        .any(|(_, _, id, hidden)| *id == entry.parent_id && *hidden)
            })
            .cloned()
            .collect())
    }

    async fn parent_exists(
        &self,
        team_id: &Uuid,
        parent_type: CrmListParentType,
        parent_id: &Uuid,
        include_hidden: bool,
    ) -> Result<bool, CrmError> {
        Ok(self
            .parents
            .lock()
            .unwrap()
            .iter()
            .any(|(team, kind, id, hidden)| {
                team == team_id
                    && *kind == parent_type
                    && id == parent_id
                    && (include_hidden || !hidden)
            }))
    }

    async fn create_entry(
        &self,
        list_id: &Uuid,
        parent_id: &Uuid,
    ) -> Result<CrmListEntry, CrmError> {
        let now = Utc::now();
        let entry = CrmListEntry {
            id: Uuid::now_v7(),
            list_id: *list_id,
            parent_id: *parent_id,
            created_at: now,
            updated_at: now,
        };
        self.entries.lock().unwrap().push(entry.clone());
        Ok(entry)
    }
}

fn receipt_with_role(role: TeamRole) -> CrmTeamReceipt<MemberTeamRole> {
    let user = MacroUserIdStr::parse_from_str("macro|user@example.com")
        .unwrap()
        .into_owned();
    CrmTeamReceipt::from_team_receipt(
        EntityAccessReceipt::<MemberTeamRole>::try_new_authenticated_user(
            user,
            Entity {
                entity_id: Uuid::now_v7().to_string(),
                entity_type: EntityType::Team,
            },
            EntityPermission::TeamRole { role },
        )
        .unwrap(),
    )
    .unwrap()
}

#[tokio::test]
async fn member_cannot_create_a_list() {
    let access = receipt_with_role(TeamRole::Member);
    let result = CrmListServiceImpl::new(MemoryStore::default())
        .create_list(&access, "Deals".into(), CrmListParentType::Company)
        .await;
    assert!(matches!(result, Err(CrmError::ListAdminRequired)));
}

#[tokio::test]
async fn admin_creates_a_list_with_a_trimmed_name() {
    let access = receipt_with_role(TeamRole::Admin);
    let service = CrmListServiceImpl::new(MemoryStore::default());
    let list = service
        .create_list(&access, "  Renewals  ".into(), CrmListParentType::Company)
        .await
        .unwrap();
    assert_eq!(list.name, "Renewals");
    assert_eq!(list.team_id, access.team_id());
    assert_eq!(service.list_lists(&access).await.unwrap(), vec![list]);
}

#[tokio::test]
async fn blank_and_oversized_names_are_rejected() {
    let access = receipt_with_role(TeamRole::Owner);
    let service = CrmListServiceImpl::new(MemoryStore::default());
    for name in ["", "   ", &"x".repeat(MAX_LIST_NAME_CHARS + 1)] {
        let result = service
            .create_list(&access, name.into(), CrmListParentType::Contact)
            .await;
        assert!(
            matches!(result, Err(CrmError::InvalidRequest(_))),
            "{name:?}"
        );
    }
}

#[tokio::test]
async fn another_teams_list_is_not_found() {
    let access = receipt_with_role(TeamRole::Admin);
    let (store, list_id) =
        MemoryStore::default().with_list(Uuid::now_v7(), "Deals", CrmListParentType::Company);
    let result = CrmListServiceImpl::new(store)
        .list_entries(&access, list_id)
        .await;
    assert!(matches!(result, Err(CrmError::ListNotFoundForTeam)));
}

#[tokio::test]
async fn adding_a_record_the_team_does_not_own_is_not_found() {
    let access = receipt_with_role(TeamRole::Admin);
    let (store, list_id) =
        MemoryStore::default().with_list(access.team_id(), "Deals", CrmListParentType::Company);
    let result = CrmListServiceImpl::new(store)
        .add_entry(&access, list_id, Uuid::now_v7())
        .await;
    assert!(matches!(result, Err(CrmError::CompanyNotFoundForTeam)));
}

#[tokio::test]
async fn a_record_can_be_in_a_list_twice() {
    let access = receipt_with_role(TeamRole::Member);
    let (store, list_id) =
        MemoryStore::default().with_list(access.team_id(), "Deals", CrmListParentType::Company);
    let (store, company) = store.with_parent(access.team_id(), CrmListParentType::Company, false);
    let service = CrmListServiceImpl::new(store);
    let first = service.add_entry(&access, list_id, company).await.unwrap();
    let second = service.add_entry(&access, list_id, company).await.unwrap();
    assert_ne!(first.id, second.id);
    assert_eq!(
        service.list_entries(&access, list_id).await.unwrap().len(),
        2
    );
}

#[tokio::test]
async fn hidden_parents_are_visible_to_admins_only() {
    let member = receipt_with_role(TeamRole::Member);
    let (store, list_id) =
        MemoryStore::default().with_list(member.team_id(), "Deals", CrmListParentType::Company);
    let (store, hidden) = store.with_parent(member.team_id(), CrmListParentType::Company, true);
    let service = CrmListServiceImpl::new(store);

    // A member cannot add a hidden company, and cannot see its entries.
    let result = service.add_entry(&member, list_id, hidden).await;
    assert!(matches!(result, Err(CrmError::CompanyNotFoundForTeam)));

    // The same team's admin can do both. Receipts carry their own team id,
    // so build the admin's from the member's team.
    let admin = admin_on_team_of(&member);
    service.add_entry(&admin, list_id, hidden).await.unwrap();
    assert_eq!(
        service.list_entries(&admin, list_id).await.unwrap().len(),
        1
    );
    assert!(
        service
            .list_entries(&member, list_id)
            .await
            .unwrap()
            .is_empty()
    );
}

fn admin_on_team_of(access: &CrmTeamReceipt<MemberTeamRole>) -> CrmTeamReceipt<MemberTeamRole> {
    let user = MacroUserIdStr::parse_from_str("macro|admin@example.com")
        .unwrap()
        .into_owned();
    CrmTeamReceipt::from_team_receipt(
        EntityAccessReceipt::<MemberTeamRole>::try_new_authenticated_user(
            user,
            Entity {
                entity_id: access.team_id().to_string(),
                entity_type: EntityType::Team,
            },
            EntityPermission::TeamRole {
                role: TeamRole::Admin,
            },
        )
        .unwrap(),
    )
    .unwrap()
}
