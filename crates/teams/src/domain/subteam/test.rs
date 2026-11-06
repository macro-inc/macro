use std::sync::{Arc, Mutex};

use entity_access::domain::models::{
    Entity, EntityAccessReceipt, EntityPermission, EntityType, MemberTeamRole, TeamRole,
};
use macro_user_id::user_id::MacroUserIdStr;

use super::service::SubteamServiceImpl;
use super::*;

const WORKSPACE_ID: uuid::Uuid = uuid::uuid!("11111111-1111-1111-1111-111111111111");
const ENGINEERING_ID: uuid::Uuid = uuid::uuid!("aaaaaaaa-0000-0000-0000-000000000001");
const DESIGN_ID: uuid::Uuid = uuid::uuid!("aaaaaaaa-0000-0000-0000-000000000002");

/// Who a team was created with: its manager and other members.
#[derive(Debug, Clone, PartialEq, Eq)]
struct CreatedWith {
    manager: String,
    members: Vec<String>,
}

/// Keeps teams in memory; enforces nothing the service is supposed to.
#[derive(Clone, Default)]
struct FakeRepository {
    subteams: Arc<Mutex<Vec<Subteam>>>,
    created_with: Arc<Mutex<Vec<CreatedWith>>>,
}

impl FakeRepository {
    fn with(subteams: Vec<Subteam>) -> Self {
        Self {
            subteams: Arc::new(Mutex::new(subteams)),
            created_with: Default::default(),
        }
    }

    fn snapshot(&self, subteam_id: uuid::Uuid) -> Option<Subteam> {
        self.subteams
            .lock()
            .unwrap()
            .iter()
            .find(|subteam| subteam.id == subteam_id)
            .cloned()
    }
}

impl SubteamRepository for FakeRepository {
    async fn list_subteams(&self, _team_id: uuid::Uuid) -> anyhow::Result<Vec<Subteam>> {
        Ok(self.subteams.lock().unwrap().clone())
    }

    async fn get_subteam(
        &self,
        _team_id: uuid::Uuid,
        subteam_id: uuid::Uuid,
    ) -> anyhow::Result<Option<Subteam>> {
        Ok(self.snapshot(subteam_id))
    }

    async fn create_subteam(
        &self,
        _team_id: uuid::Uuid,
        subteam: &NewSubteam,
        manager_id: &MacroUserIdStr<'_>,
        member_ids: &[MacroUserIdStr<'static>],
    ) -> anyhow::Result<CreateSubteamOutcome> {
        self.created_with.lock().unwrap().push(CreatedWith {
            manager: manager_id.to_string(),
            members: member_ids.iter().map(|id| id.to_string()).collect(),
        });

        let mut members = vec![SubteamMember {
            user_id: MacroUserIdStr::try_from(manager_id.to_string())?,
            role: SubteamRole::Manager,
        }];
        for member_id in member_ids {
            members.push(SubteamMember {
                user_id: member_id.clone(),
                role: SubteamRole::Member,
            });
        }

        let created = Subteam {
            id: uuid::uuid!("aaaaaaaa-0000-0000-0000-000000000099"),
            parent_id: subteam.parent_id,
            name: subteam.name.as_str().to_string(),
            description: subteam.description.as_str().to_string(),
            color: subteam.color,
            join_policy: subteam.join_policy,
            created_at: chrono::DateTime::UNIX_EPOCH,
            members,
        };
        self.subteams.lock().unwrap().push(created.clone());

        Ok(CreateSubteamOutcome::Created(created))
    }

    async fn update_subteam(
        &self,
        _team_id: uuid::Uuid,
        subteam_id: uuid::Uuid,
        patch: &SubteamPatch,
    ) -> anyhow::Result<Option<Subteam>> {
        let mut subteams = self.subteams.lock().unwrap();
        let Some(subteam) = subteams.iter_mut().find(|s| s.id == subteam_id) else {
            return Ok(None);
        };

        if let Some(name) = &patch.name {
            subteam.name = name.as_str().to_string();
        }

        Ok(Some(subteam.clone()))
    }

    async fn nest_subteam(
        &self,
        _team_id: uuid::Uuid,
        subteam_id: uuid::Uuid,
        parent_id: Option<uuid::Uuid>,
    ) -> anyhow::Result<NestOutcome> {
        let mut subteams = self.subteams.lock().unwrap();
        let Some(subteam) = subteams.iter_mut().find(|s| s.id == subteam_id) else {
            return Ok(NestOutcome::SubteamNotFound);
        };
        subteam.parent_id = parent_id;

        Ok(NestOutcome::Nested)
    }

    async fn delete_subteam(
        &self,
        _team_id: uuid::Uuid,
        subteam_id: uuid::Uuid,
    ) -> anyhow::Result<bool> {
        let mut subteams = self.subteams.lock().unwrap();
        let before = subteams.len();
        subteams.retain(|subteam| subteam.id != subteam_id);

        Ok(subteams.len() < before)
    }

    async fn save_subteam_member(
        &self,
        _team_id: uuid::Uuid,
        subteam_id: uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
        role: SubteamRole,
    ) -> anyhow::Result<SaveMemberOutcome> {
        let mut subteams = self.subteams.lock().unwrap();
        let Some(subteam) = subteams.iter_mut().find(|s| s.id == subteam_id) else {
            return Ok(SaveMemberOutcome::SubteamNotFound);
        };
        subteam
            .members
            .retain(|member| member.user_id.to_string() != user_id.to_string());
        subteam.members.push(SubteamMember {
            user_id: MacroUserIdStr::try_from(user_id.to_string())?,
            role,
        });

        Ok(SaveMemberOutcome::Saved)
    }

    async fn remove_subteam_member(
        &self,
        _team_id: uuid::Uuid,
        subteam_id: uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> anyhow::Result<()> {
        let mut subteams = self.subteams.lock().unwrap();
        if let Some(subteam) = subteams.iter_mut().find(|s| s.id == subteam_id) {
            subteam
                .members
                .retain(|member| member.user_id.to_string() != user_id.to_string());
        }

        Ok(())
    }
}

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).unwrap()
}

fn receipt(user_id: &str, role: TeamRole) -> EntityAccessReceipt<MemberTeamRole> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(user_id),
        Entity {
            entity_id: WORKSPACE_ID.to_string(),
            entity_type: EntityType::Team,
        },
        EntityPermission::TeamRole { role },
    )
    .unwrap()
}

/// Engineering, managed by lead@macro.com, with member@macro.com on it, and
/// Design, invite only, managed by designer@macro.com.
fn workspace() -> FakeRepository {
    FakeRepository::with(vec![
        Subteam {
            id: ENGINEERING_ID,
            parent_id: None,
            name: "Engineering".to_string(),
            description: String::new(),
            color: SubteamColor::Blue,
            join_policy: SubteamJoinPolicy::Open,
            created_at: chrono::DateTime::UNIX_EPOCH,
            members: vec![
                SubteamMember {
                    user_id: user("macro|lead@macro.com"),
                    role: SubteamRole::Manager,
                },
                SubteamMember {
                    user_id: user("macro|member@macro.com"),
                    role: SubteamRole::Member,
                },
            ],
        },
        Subteam {
            id: DESIGN_ID,
            parent_id: None,
            name: "Design".to_string(),
            description: String::new(),
            color: SubteamColor::Pink,
            join_policy: SubteamJoinPolicy::InviteOnly,
            created_at: chrono::DateTime::UNIX_EPOCH,
            members: vec![SubteamMember {
                user_id: user("macro|designer@macro.com"),
                role: SubteamRole::Manager,
            }],
        },
    ])
}

#[tokio::test]
async fn the_creator_manages_a_new_team_and_is_not_added_twice() {
    let repository = workspace();
    let service = SubteamServiceImpl::new(repository.clone());

    let created = service
        .create_subteam(
            receipt("macro|member@macro.com", TeamRole::Member),
            NewSubteam {
                parent_id: None,
                name: SubteamName::parse("  Platform ").unwrap(),
                description: SubteamDescription::parse("").unwrap(),
                color: SubteamColor::Teal,
                join_policy: SubteamJoinPolicy::Open,
            },
            vec![user("macro|member@macro.com"), user("macro|lead@macro.com")],
        )
        .await
        .unwrap();

    assert_eq!(created.name, "Platform");
    assert_eq!(
        repository.created_with.lock().unwrap().clone(),
        vec![CreatedWith {
            manager: "macro|member@macro.com".to_string(),
            members: vec!["macro|lead@macro.com".to_string()],
        }]
    );
    assert_eq!(
        created.role_of(&user("macro|member@macro.com")),
        Some(SubteamRole::Manager)
    );
}

#[tokio::test]
async fn nesting_a_new_team_requires_managing_the_parent() {
    let service = SubteamServiceImpl::new(workspace());
    let platform = NewSubteam {
        parent_id: Some(ENGINEERING_ID),
        name: SubteamName::parse("Platform").unwrap(),
        description: SubteamDescription::parse("").unwrap(),
        color: SubteamColor::Teal,
        join_policy: SubteamJoinPolicy::Open,
    };

    let by_member = service
        .create_subteam(
            receipt("macro|member@macro.com", TeamRole::Member),
            platform.clone(),
            vec![],
        )
        .await;
    assert!(matches!(by_member, Err(SubteamError::NotManager)));

    let by_lead = service
        .create_subteam(
            receipt("macro|lead@macro.com", TeamRole::Member),
            platform,
            vec![],
        )
        .await
        .unwrap();
    assert_eq!(by_lead.parent_id, Some(ENGINEERING_ID));
}

#[tokio::test]
async fn nesting_under_a_missing_team_is_an_invalid_parent() {
    let service = SubteamServiceImpl::new(workspace());

    let result = service
        .nest_subteam(
            receipt("macro|lead@macro.com", TeamRole::Member),
            ENGINEERING_ID,
            Some(uuid::uuid!("bbbbbbbb-0000-0000-0000-000000000000")),
        )
        .await;

    assert!(matches!(result, Err(SubteamError::InvalidParent)));
}

#[tokio::test]
async fn only_managers_and_workspace_admins_change_a_team() {
    let repository = workspace();
    let service = SubteamServiceImpl::new(repository.clone());
    let rename = || SubteamPatch {
        name: Some(SubteamName::parse("Eng").unwrap()),
        ..Default::default()
    };

    let by_member = service
        .update_subteam(
            receipt("macro|member@macro.com", TeamRole::Member),
            ENGINEERING_ID,
            rename(),
        )
        .await;
    assert!(matches!(by_member, Err(SubteamError::NotManager)));

    let by_admin = service
        .update_subteam(
            receipt("macro|admin@macro.com", TeamRole::Admin),
            ENGINEERING_ID,
            rename(),
        )
        .await
        .unwrap();
    assert_eq!(by_admin.name, "Eng");

    let delete_by_member = service
        .delete_subteam(
            receipt("macro|member@macro.com", TeamRole::Member),
            ENGINEERING_ID,
        )
        .await;
    assert!(matches!(delete_by_member, Err(SubteamError::NotManager)));
    assert!(repository.snapshot(ENGINEERING_ID).is_some());
}

#[tokio::test]
async fn anyone_joins_an_open_team_but_not_an_invite_only_one() {
    let service = SubteamServiceImpl::new(workspace());
    let newcomer = "macro|newcomer@macro.com";

    let joined = service
        .save_subteam_member(
            receipt(newcomer, TeamRole::Member),
            ENGINEERING_ID,
            user(newcomer),
            SubteamRole::Member,
        )
        .await
        .unwrap();
    assert_eq!(joined.role_of(&user(newcomer)), Some(SubteamRole::Member));

    let invite_only = service
        .save_subteam_member(
            receipt(newcomer, TeamRole::Member),
            DESIGN_ID,
            user(newcomer),
            SubteamRole::Member,
        )
        .await;
    assert!(matches!(invite_only, Err(SubteamError::InviteOnly)));

    let self_promotion = service
        .save_subteam_member(
            receipt(newcomer, TeamRole::Member),
            ENGINEERING_ID,
            user(newcomer),
            SubteamRole::Manager,
        )
        .await;
    assert!(matches!(self_promotion, Err(SubteamError::NotManager)));

    let adding_someone_else = service
        .save_subteam_member(
            receipt("macro|member@macro.com", TeamRole::Member),
            ENGINEERING_ID,
            user("macro|other@macro.com"),
            SubteamRole::Member,
        )
        .await;
    assert!(matches!(adding_someone_else, Err(SubteamError::NotManager)));
}

#[tokio::test]
async fn managers_staff_invite_only_teams() {
    let service = SubteamServiceImpl::new(workspace());

    let staffed = service
        .save_subteam_member(
            receipt("macro|designer@macro.com", TeamRole::Member),
            DESIGN_ID,
            user("macro|member@macro.com"),
            SubteamRole::Manager,
        )
        .await
        .unwrap();

    assert_eq!(
        staffed.role_of(&user("macro|member@macro.com")),
        Some(SubteamRole::Manager)
    );
}

#[tokio::test]
async fn members_leave_but_only_managers_remove_others() {
    let service = SubteamServiceImpl::new(workspace());

    let removing_the_lead = service
        .remove_subteam_member(
            receipt("macro|member@macro.com", TeamRole::Member),
            ENGINEERING_ID,
            user("macro|lead@macro.com"),
        )
        .await;
    assert!(matches!(removing_the_lead, Err(SubteamError::NotManager)));

    let left = service
        .remove_subteam_member(
            receipt("macro|member@macro.com", TeamRole::Member),
            ENGINEERING_ID,
            user("macro|member@macro.com"),
        )
        .await
        .unwrap();
    assert_eq!(left.role_of(&user("macro|member@macro.com")), None);
    assert_eq!(
        left.role_of(&user("macro|lead@macro.com")),
        Some(SubteamRole::Manager)
    );
}

#[test]
fn names_are_trimmed_and_bounded() {
    assert_eq!(SubteamName::parse("  Sync ").unwrap().as_str(), "Sync");
    assert!(matches!(
        SubteamName::parse("   "),
        Err(SubteamError::InvalidName)
    ));
    assert!(matches!(
        SubteamName::parse(&"x".repeat(SUBTEAM_NAME_MAX_CHARS + 1)),
        Err(SubteamError::InvalidName)
    ));
    assert!(matches!(
        SubteamDescription::parse(&"x".repeat(SUBTEAM_DESCRIPTION_MAX_CHARS + 1)),
        Err(SubteamError::DescriptionTooLong)
    ));
}
