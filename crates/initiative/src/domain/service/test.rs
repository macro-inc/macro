use chrono::{TimeZone, Utc};
use entity_access::domain::models::{
    AccessLevel, EditAccessLevel, Entity, EntityAccessReceipt, EntityPermission, EntityType,
    OwnerAccessLevel, ViewAccessLevel,
};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use mockall::Sequence;
use models_permissions::share_permission::access_level::AccessLevel as ShareAccessLevel;
use models_permissions::share_permission::team_share::{TeamShareCreation, TeamShareFacts};
use models_permissions::share_permission::{
    LinkShare, LinkShareState, SharePermissionV2, TeamLinkShareDefault,
    UpdateSharePermissionRequestV2,
};

use super::InitiativeServiceImpl;
use crate::domain::models::{
    AssignTaskStatus, AssignTasksResult, CreateInitiativeRequest, DescriptionDocumentId,
    InitiativeBasic, InitiativeDetail, InitiativeError, InitiativeId, InitiativeList,
    InitiativeSummary, LockstepTeamShareFacts, MAX_INITIATIVE_DESCRIPTION_GRAPHEMES,
    MAX_INITIATIVE_NAME_GRAPHEMES, MAX_TASKS_PER_ASSIGN, TaskAssignment, UpdateInitiativeRequest,
};
use crate::domain::ports::{
    InitiativeService, MockInitiativeDescriptionDocuments, MockInitiativeRepo,
};

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

fn description_document_id() -> DescriptionDocumentId {
    DescriptionDocumentId::from_uuid(uuid::Uuid::from_u128(2))
}

fn share_permission() -> SharePermissionV2 {
    SharePermissionV2::new_initiative_share_permission(None)
}

fn detail(member_ids: Vec<MacroUserIdStr<'static>>) -> InitiativeDetail {
    InitiativeDetail {
        id: initiative_id(),
        name: "Launch".to_string(),
        description_document_id: description_document_id(),
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

fn service(
    repo: MockInitiativeRepo,
) -> InitiativeServiceImpl<MockInitiativeRepo, MockInitiativeDescriptionDocuments> {
    service_with_documents(repo, MockInitiativeDescriptionDocuments::new())
}

fn service_with_documents(
    repo: MockInitiativeRepo,
    documents: MockInitiativeDescriptionDocuments,
) -> InitiativeServiceImpl<MockInitiativeRepo, MockInitiativeDescriptionDocuments> {
    InitiativeServiceImpl::new(repo, documents)
}

fn share_update() -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        link_share: None,
        link_share_access_level: None,
        team_share_access_level: Some(Some(ShareAccessLevel::Edit)),
        channel_share_permissions: None,
    }
}

fn team_facts(entity_type: EntityType, entity_id: String, owner: &str) -> TeamShareFacts {
    TeamShareFacts {
        entity: entity_type.with_entity_string(entity_id),
        owner: user(owner),
        owner_team_id: Some(uuid::Uuid::from_u128(7)),
        current: None,
        revision: 0,
    }
}

fn lockstep_facts(description_owner: &str) -> LockstepTeamShareFacts {
    LockstepTeamShareFacts {
        initiative: team_facts(EntityType::Initiative, initiative_id().to_string(), OWNER),
        description: team_facts(
            EntityType::Document,
            description_document_id().to_string(),
            description_owner,
        ),
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
async fn create_rejects_too_long_description_before_creating_any_document() {
    let result = service(MockInitiativeRepo::new())
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
                && args.description_document_id == description_document_id()
        })
        .return_once(|_, _, _| Box::pin(async { Ok(detail(vec![user(MEMBER)])) }));
    let mut documents = MockInitiativeDescriptionDocuments::new();
    documents
        .expect_create()
        .return_once(|_| Box::pin(async { Ok(description_document_id()) }));

    let created = service_with_documents(repo, documents)
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
    assert_eq!(created.description_document_id, description_document_id());
}

#[tokio::test]
async fn create_asks_for_a_description_document_named_after_the_initiative() {
    let mut sequence = Sequence::new();
    let mut repo = MockInitiativeRepo::new();
    let mut documents = MockInitiativeDescriptionDocuments::new();
    repo.expect_get_team_default_link_share()
        .return_once(|_| Box::pin(async { Ok(None) }));
    documents
        .expect_create()
        .withf(|document| {
            document.owner == user(OWNER)
                && document.name == "Launch"
                && document.prefill_markdown == "# Goals"
                && document.link_share == LinkShareState::Off
        })
        .times(1)
        .in_sequence(&mut sequence)
        .return_once(|_| Box::pin(async { Ok(description_document_id()) }));
    repo.expect_create()
        .withf(|args, share_permission, _| {
            args.description_document_id == description_document_id()
                && share_permission.link_share_state() == LinkShareState::Off
        })
        .times(1)
        .in_sequence(&mut sequence)
        .return_once(|_, _, _| Box::pin(async { Ok(detail(Vec::new())) }));

    service_with_documents(repo, documents)
        .create(
            &user(OWNER),
            CreateInitiativeRequest {
                name: " Launch ".into(),
                description: Some("  # Goals\n".into()),
                ..Default::default()
            },
        )
        .await
        .expect("created");
}

#[tokio::test]
async fn create_copies_the_initiative_link_share_onto_the_document() {
    let expected = LinkShareState::On {
        scope: LinkShare::Team,
        level: ShareAccessLevel::View,
    };
    let mut repo = MockInitiativeRepo::new();
    let mut documents = MockInitiativeDescriptionDocuments::new();
    repo.expect_get_team_default_link_share()
        .return_once(|_| Box::pin(async { Ok(Some(TeamLinkShareDefault(Some(LinkShare::Team)))) }));
    documents
        .expect_create()
        .withf(move |document| {
            document.link_share == expected && document.prefill_markdown.is_empty()
        })
        .return_once(|_| Box::pin(async { Ok(description_document_id()) }));
    repo.expect_create()
        .withf(move |_, share_permission, _| share_permission.link_share_state() == expected)
        .return_once(|_, _, _| Box::pin(async { Ok(detail(Vec::new())) }));

    service_with_documents(repo, documents)
        .create(
            &user(OWNER),
            CreateInitiativeRequest {
                name: "Launch".into(),
                ..Default::default()
            },
        )
        .await
        .expect("created");
}

#[tokio::test]
async fn failed_initiative_write_purges_the_document_and_returns_the_original_error() {
    let mut sequence = Sequence::new();
    let mut repo = MockInitiativeRepo::new();
    let mut documents = MockInitiativeDescriptionDocuments::new();
    repo.expect_get_team_default_link_share()
        .return_once(|_| Box::pin(async { Ok(None) }));
    documents
        .expect_create()
        .times(1)
        .in_sequence(&mut sequence)
        .return_once(|_| Box::pin(async { Ok(description_document_id()) }));
    repo.expect_create()
        .times(1)
        .in_sequence(&mut sequence)
        .return_once(|_, _, _| {
            Box::pin(async {
                Err(InitiativeError::Conflict(
                    "initiative already exists".into(),
                ))
            })
        });
    documents
        .expect_purge()
        .withf(|id| *id == description_document_id())
        .times(1)
        .in_sequence(&mut sequence)
        .return_once(|_| {
            Box::pin(async {
                Err(InitiativeError::Internal(rootcause::report!(
                    "purge failed"
                )))
            })
        });

    let result = service_with_documents(repo, documents)
        .create(
            &user(OWNER),
            CreateInitiativeRequest {
                name: "Launch".into(),
                ..Default::default()
            },
        )
        .await;
    assert!(
        matches!(result, Err(InitiativeError::Conflict(ref message)) if message == "initiative already exists")
    );
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
async fn owner_patches_team_share_on_both_entities_from_one_snapshot() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_team_share_facts()
        .withf(|id| *id == initiative_id())
        .times(1)
        .return_once(|_| Box::pin(async { Ok(lockstep_facts(OWNER)) }));
    repo.expect_update()
        .withf(|args| {
            let Some(team_share) = args.team_share.as_ref() else {
                return false;
            };
            let facts = lockstep_facts(OWNER);
            team_share.initiative.expected() == &facts.initiative
                && team_share.description.expected() == &facts.description
                && team_share.initiative.target().map(|grant| grant.level)
                    == team_share.description.target().map(|grant| grant.level)
        })
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
async fn team_share_patch_conflicts_when_the_document_owner_drifted() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_team_share_facts()
        .return_once(|_| Box::pin(async { Ok(lockstep_facts(OTHER)) }));

    let result = service(repo)
        .update(
            owner_edit_receipt(),
            UpdateInitiativeRequest {
                share_permission: Some(share_update()),
                ..Default::default()
            },
        )
        .await;
    assert!(matches!(result, Err(InitiativeError::Conflict(_))));
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
async fn get_list_and_unassign_call_the_repo() {
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
                    description_document_id: description_document_id(),
                    updated_at: now(),
                }],
            })
        })
    });
    repo.expect_unassign_task()
        .return_once(|_, _| Box::pin(async { Ok(()) }));

    let svc = service(repo);
    svc.internal_get_basic(initiative_id())
        .await
        .expect("basic");
    svc.get(view_receipt()).await.expect("detail");
    svc.list(&user(OWNER)).await.expect("list");
    svc.unassign_task(edit_receipt(), "task-1")
        .await
        .expect("unassign");
}

#[tokio::test]
async fn delete_purges_the_document_after_the_initiative_is_gone() {
    let mut sequence = Sequence::new();
    let mut repo = MockInitiativeRepo::new();
    let mut documents = MockInitiativeDescriptionDocuments::new();
    repo.expect_delete()
        .withf(|id| *id == initiative_id())
        .times(1)
        .in_sequence(&mut sequence)
        .return_once(|_| Box::pin(async { Ok(description_document_id()) }));
    documents
        .expect_purge()
        .withf(|id| *id == description_document_id())
        .times(1)
        .in_sequence(&mut sequence)
        .return_once(|_| Box::pin(async { Ok(()) }));

    service_with_documents(repo, documents)
        .delete(owner_receipt())
        .await
        .expect("deleted");
}

#[tokio::test]
async fn delete_surfaces_a_failed_purge_after_the_initiative_is_gone() {
    let mut repo = MockInitiativeRepo::new();
    let mut documents = MockInitiativeDescriptionDocuments::new();
    repo.expect_delete()
        .return_once(|_| Box::pin(async { Ok(description_document_id()) }));
    documents.expect_purge().return_once(|_| {
        Box::pin(async { Err(InitiativeError::Internal(rootcause::report!("sync down"))) })
    });

    let result = service_with_documents(repo, documents)
        .delete(owner_receipt())
        .await;
    assert!(matches!(result, Err(InitiativeError::Internal(_))));
}
