use chrono::{TimeZone, Utc};
use entity_access::domain::models::{
    AccessLevel, EditAccessLevel, Entity, EntityAccessReceipt, EntityPermission, EntityType,
    OwnerAccessLevel, ViewAccessLevel,
};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel as ShareAccessLevel;
use models_permissions::share_permission::team_share::{TeamShareCreation, TeamShareFacts};
use models_permissions::share_permission::{SharePermissionV2, UpdateSharePermissionRequestV2};

use super::InitiativeServiceImpl;
use crate::domain::models::{
    AssignTaskStatus, AssignTasksResult, CreateInitiativeRequest, InitiativeBasic,
    InitiativeDetail, InitiativeError, InitiativeId, InitiativeList, InitiativeSummary,
    MAX_INITIATIVE_DESCRIPTION_GRAPHEMES, MAX_INITIATIVE_NAME_GRAPHEMES, MAX_TASKS_PER_ASSIGN,
    TaskAssignment, UpdateInitiativeRequest,
};
use crate::domain::ports::{InitiativeService, MockInitiativeRepo};

const OWNER: &str = "macro|owner@macro.com";
const MEMBER: &str = "macro|member@macro.com";
const OTHER: &str = "macro|other@macro.com";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id)
        .expect("valid user id")
        .into_owned()
}

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 15, 12, 0, 0)
        .single()
        .expect("unambiguous instant")
}

fn initiative_id() -> InitiativeId {
    InitiativeId::from_uuid(uuid::Uuid::from_u128(1))
}

fn share_permission() -> SharePermissionV2 {
    SharePermissionV2::new_initiative_share_permission(None)
}

fn detail(member_ids: Vec<MacroUserIdStr<'static>>) -> InitiativeDetail {
    InitiativeDetail {
        id: initiative_id(),
        name: "Launch".to_string(),
        description: None,
        owner_id: user(OWNER),
        member_ids,
        task_ids: Vec::new(),
        share_permission: share_permission(),
        user_access_level: ShareAccessLevel::Edit,
        created_at: now(),
        updated_at: now(),
    }
}

fn receipt<T: entity_access::domain::models::RequiredPermission>(
    user_id: &str,
    entity_type: EntityType,
    access_level: AccessLevel,
) -> EntityAccessReceipt<T> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(user_id),
        Entity {
            entity_id: initiative_id().to_string(),
            entity_type,
        },
        EntityPermission::AccessLevel { access_level },
    )
    .expect("permission satisfies the receipt")
}

fn edit_receipt() -> EntityAccessReceipt<EditAccessLevel> {
    receipt(OWNER, EntityType::Initiative, AccessLevel::Edit)
}

fn owner_edit_receipt() -> EntityAccessReceipt<EditAccessLevel> {
    receipt(OWNER, EntityType::Initiative, AccessLevel::Owner)
}

fn view_receipt() -> EntityAccessReceipt<ViewAccessLevel> {
    receipt(OWNER, EntityType::Initiative, AccessLevel::View)
}

fn owner_receipt() -> EntityAccessReceipt<OwnerAccessLevel> {
    receipt(OWNER, EntityType::Initiative, AccessLevel::Owner)
}

fn service(repo: MockInitiativeRepo) -> InitiativeServiceImpl<MockInitiativeRepo> {
    InitiativeServiceImpl::new(repo)
}

fn share_update() -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        link_share: None,
        link_share_access_level: None,
        team_share_access_level: Some(Some(ShareAccessLevel::Edit)),
        channel_share_permissions: None,
    }
}

fn team_facts() -> TeamShareFacts {
    TeamShareFacts {
        entity: EntityType::Initiative.with_entity_string(initiative_id().to_string()),
        owner: user(OWNER),
        owner_team_id: Some(uuid::Uuid::from_u128(7)),
        current: None,
        revision: 0,
    }
}

#[tokio::test]
async fn create_rejects_empty_and_too_long_names() {
    let repo = MockInitiativeRepo::new();
    let svc = service(repo);
    let empty = svc
        .create(
            &user(OWNER),
            CreateInitiativeRequest {
                name: "   ".into(),
                ..Default::default()
            },
        )
        .await;
    assert!(matches!(empty, Err(InitiativeError::BadRequest(_))));

    let too_long = svc
        .create(
            &user(OWNER),
            CreateInitiativeRequest {
                name: "🎉".repeat(MAX_INITIATIVE_NAME_GRAPHEMES + 1),
                ..Default::default()
            },
        )
        .await;
    assert!(matches!(
        too_long,
        Err(InitiativeError::NameTooLong {
            max: MAX_INITIATIVE_NAME_GRAPHEMES
        })
    ));
}

#[tokio::test]
async fn create_rejects_too_long_description() {
    let repo = MockInitiativeRepo::new();
    let result = service(repo)
        .create(
            &user(OWNER),
            CreateInitiativeRequest {
                name: "Launch".into(),
                description: Some("🎉".repeat(MAX_INITIATIVE_DESCRIPTION_GRAPHEMES + 1)),
                ..Default::default()
            },
        )
        .await;
    assert!(matches!(result, Err(InitiativeError::BadRequest(_))));
}

#[tokio::test]
async fn create_drops_owner_from_members_and_shares_with_team() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_team_default_link_share()
        .return_once(|_| Box::pin(async { Ok(None) }));
    repo.expect_create()
        .withf(|args, _, team_share| {
            *team_share == TeamShareCreation::Initiative
                && args.member_ids == vec![user(MEMBER)]
                && args.owner_id == user(OWNER)
        })
        .return_once(|_, _, _| Box::pin(async { Ok(detail(vec![user(MEMBER)])) }));

    let created = service(repo)
        .create(
            &user(OWNER),
            CreateInitiativeRequest {
                name: " Launch ".into(),
                member_ids: Some(vec![OWNER.into(), MEMBER.into(), MEMBER.into()]),
                share_with_team: Some(true),
                ..Default::default()
            },
        )
        .await
        .expect("created");
    assert_eq!(created.member_ids, vec![user(MEMBER)]);
}

#[tokio::test]
async fn create_rejects_bad_member_id() {
    let repo = MockInitiativeRepo::new();
    let result = service(repo)
        .create(
            &user(OWNER),
            CreateInitiativeRequest {
                name: "Launch".into(),
                member_ids: Some(vec!["not-a-user".into()]),
                ..Default::default()
            },
        )
        .await;
    assert!(matches!(result, Err(InitiativeError::BadRequest(_))));
}

#[tokio::test]
async fn edit_receipt_cannot_change_share_permission() {
    let repo = MockInitiativeRepo::new();
    let result = service(repo)
        .update(
            edit_receipt(),
            UpdateInitiativeRequest {
                share_permission: Some(share_update()),
                ..Default::default()
            },
        )
        .await;
    assert!(matches!(result, Err(InitiativeError::Unauthorized)));
}

#[tokio::test]
async fn edit_receipt_renames_and_replaces_members() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_detail()
        .return_once(|_| Box::pin(async { Ok(Some(detail(vec![user(MEMBER)]))) }));
    repo.expect_update()
        .withf(|args| {
            args.name.as_deref() == Some("Renamed")
                && args.member_ids_added == vec![user(OTHER)]
                && args.member_ids_removed == vec![user(MEMBER)]
        })
        .return_once(|args| Box::pin(async move { Ok(detail(args.member_ids_added.clone())) }));

    let updated = service(repo)
        .update(
            edit_receipt(),
            UpdateInitiativeRequest {
                name: Some("Renamed".into()),
                member_ids: Some(vec![OTHER.into()]),
                ..Default::default()
            },
        )
        .await
        .expect("updated");
    assert_eq!(updated.member_ids, vec![user(OTHER)]);
}

#[tokio::test]
async fn update_filters_owner_from_replacement_members() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_detail()
        .return_once(|_| Box::pin(async { Ok(Some(detail(Vec::new()))) }));
    repo.expect_update()
        .withf(|args| {
            args.member_ids_added == vec![user(MEMBER)] && args.member_ids_removed.is_empty()
        })
        .return_once(|_| Box::pin(async { Ok(detail(vec![user(MEMBER)])) }));

    service(repo)
        .update(
            owner_edit_receipt(),
            UpdateInitiativeRequest {
                member_ids: Some(vec![OWNER.into(), MEMBER.into()]),
                ..Default::default()
            },
        )
        .await
        .expect("updated");
}

#[tokio::test]
async fn update_rejects_bad_member_id() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_detail()
        .return_once(|_| Box::pin(async { Ok(Some(detail(Vec::new()))) }));
    let result = service(repo)
        .update(
            edit_receipt(),
            UpdateInitiativeRequest {
                member_ids: Some(vec!["nope".into()]),
                ..Default::default()
            },
        )
        .await;
    assert!(matches!(result, Err(InitiativeError::BadRequest(_))));
}

#[tokio::test]
async fn owner_can_patch_share_permission() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_team_share_facts()
        .return_once(|_| Box::pin(async { Ok(team_facts()) }));
    repo.expect_update()
        .withf(|args| args.team_share.is_some())
        .return_once(|_| Box::pin(async { Ok(detail(Vec::new())) }));

    service(repo)
        .update(
            owner_edit_receipt(),
            UpdateInitiativeRequest {
                share_permission: Some(share_update()),
                ..Default::default()
            },
        )
        .await
        .expect("updated");
}

#[tokio::test]
async fn assign_rejects_non_initiative_receipts() {
    let repo = MockInitiativeRepo::new();
    let document_receipt: EntityAccessReceipt<EditAccessLevel> =
        receipt(OWNER, EntityType::Document, AccessLevel::Edit);
    let result = service(repo)
        .assign_tasks(
            document_receipt,
            vec![TaskAssignment::Candidate {
                task_id: "task-1".into(),
            }],
        )
        .await;
    assert!(matches!(result, Err(InitiativeError::BadRequest(_))));
}

#[tokio::test]
async fn assign_dedupes_enforces_cap_and_preserves_order() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_assign_tasks()
        .withf(|_, task_ids| task_ids == &["t1".to_string(), "t2".to_string()])
        .return_once(|_, _| {
            Box::pin(async {
                Ok(vec![
                    AssignTasksResult {
                        task_id: "t1".into(),
                        status: AssignTaskStatus::Assigned,
                    },
                    AssignTasksResult {
                        task_id: "t2".into(),
                        status: AssignTaskStatus::Moved,
                    },
                ])
            })
        });

    let response = service(repo)
        .assign_tasks(
            edit_receipt(),
            vec![
                TaskAssignment::Candidate {
                    task_id: "t1".into(),
                },
                TaskAssignment::SkippedNoPermission {
                    task_id: "skip".into(),
                },
                TaskAssignment::Candidate {
                    task_id: "t1".into(),
                },
                TaskAssignment::NotFound {
                    task_id: "missing".into(),
                },
                TaskAssignment::Candidate {
                    task_id: "t2".into(),
                },
            ],
        )
        .await
        .expect("assigned");

    assert_eq!(
        response.results,
        vec![
            AssignTasksResult {
                task_id: "t1".into(),
                status: AssignTaskStatus::Assigned,
            },
            AssignTasksResult {
                task_id: "skip".into(),
                status: AssignTaskStatus::SkippedNoPermission,
            },
            AssignTasksResult {
                task_id: "missing".into(),
                status: AssignTaskStatus::NotFound,
            },
            AssignTasksResult {
                task_id: "t2".into(),
                status: AssignTaskStatus::Moved,
            },
        ]
    );

    let over_cap: Vec<TaskAssignment> = (0..=MAX_TASKS_PER_ASSIGN)
        .map(|i| TaskAssignment::Candidate {
            task_id: format!("task-{i}"),
        })
        .collect();
    let capped = service(MockInitiativeRepo::new())
        .assign_tasks(edit_receipt(), over_cap)
        .await;
    assert!(matches!(capped, Err(InitiativeError::BadRequest(_))));
}

#[tokio::test]
async fn get_list_unassign_and_delete_call_the_repo() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_basic().return_once(|_| {
        Box::pin(async {
            Ok(Some(InitiativeBasic {
                id: initiative_id(),
                name: "Launch".into(),
                owner_id: user(OWNER),
            }))
        })
    });
    repo.expect_get_detail()
        .return_once(|_| Box::pin(async { Ok(Some(detail(Vec::new()))) }));
    repo.expect_list_accessible().return_once(|_| {
        Box::pin(async {
            Ok(InitiativeList {
                initiatives: vec![InitiativeSummary {
                    id: initiative_id(),
                    name: "Launch".into(),
                    description: None,
                    updated_at: now(),
                }],
            })
        })
    });
    repo.expect_unassign_task()
        .return_once(|_, _| Box::pin(async { Ok(()) }));
    repo.expect_delete()
        .return_once(|_| Box::pin(async { Ok(()) }));

    let svc = service(repo);
    svc.internal_get_basic(initiative_id())
        .await
        .expect("basic");
    svc.get(view_receipt()).await.expect("detail");
    svc.list(&user(OWNER)).await.expect("list");
    svc.unassign_task(edit_receipt(), "task-1")
        .await
        .expect("unassign");
    svc.delete(owner_receipt()).await.expect("delete");
}
