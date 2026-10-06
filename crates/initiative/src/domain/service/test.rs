use chrono::{TimeZone, Utc};

mod access;
mod events;
mod initial_properties;
mod reads;
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
    CreateInitiativeRequest, InitiativeBasic, InitiativeDetail, InitiativeError, InitiativeId,
    InitiativeList, InitiativeSummary, MAX_INITIATIVE_DESCRIPTION_GRAPHEMES,
    MAX_INITIATIVE_NAME_GRAPHEMES, UpdateInitiativeRequest,
};
use crate::domain::ports::{
    InitiativeService, MockInitiativeDescriptionSurfaces, MockInitiativeRepo,
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

fn share_permission() -> SharePermissionV2 {
    SharePermissionV2::new_initiative_share_permission(None)
}

fn detail(member_ids: Vec<MacroUserIdStr<'static>>) -> InitiativeDetail {
    InitiativeDetail {
        id: initiative_id(),
        name: "Launch".to_string(),
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

type TestService = InitiativeServiceImpl<MockInitiativeRepo, MockInitiativeDescriptionSurfaces>;

/// A service whose surfaces mock has no expectations: any surface call fails the test.
fn service(repo: MockInitiativeRepo) -> TestService {
    service_with(repo, MockInitiativeDescriptionSurfaces::new())
}

fn service_with(
    repo: MockInitiativeRepo,
    surfaces: MockInitiativeDescriptionSurfaces,
) -> TestService {
    InitiativeServiceImpl::new(
        repo,
        surfaces,
        std::sync::Arc::new(reads::FakeResources::default()),
    )
}

/// Surfaces that accept exactly one soft-delete, of whichever initiative a create generated.
fn deleting_surfaces() -> MockInitiativeDescriptionSurfaces {
    let mut surfaces = MockInitiativeDescriptionSurfaces::new();
    surfaces
        .expect_delete()
        .times(1)
        .return_once(|_| Box::pin(async { Ok(()) }));
    surfaces
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
        owner: user(owner).into(),
        owner_team_id: Some(uuid::Uuid::from_u128(7)),
        current: None,
        revision: 0,
    }
}

fn initiative_facts(owner: &str) -> TeamShareFacts {
    team_facts(EntityType::Initiative, initiative_id().to_string(), owner)
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
async fn create_rejects_too_long_description_before_creating_anything() {
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
async fn create_seeds_the_description_surface_before_the_row() {
    let mut sequence = Sequence::new();
    let mut repo = MockInitiativeRepo::new();
    let mut surfaces = MockInitiativeDescriptionSurfaces::new();
    repo.expect_get_team_default_link_share()
        .return_once(|_| Box::pin(async { Ok(None) }));
    let created_id = std::sync::Arc::new(std::sync::Mutex::new(None));
    let seeded_id = created_id.clone();
    surfaces
        .expect_ensure()
        .withf(|_, markdown| markdown == "# Goals")
        .times(1)
        .in_sequence(&mut sequence)
        .returning(move |id, _| {
            *seeded_id.lock().unwrap() = Some(id);
            Box::pin(async { Ok(()) })
        });
    let row_id = created_id.clone();
    repo.expect_create()
        .withf(move |args, _, _| *row_id.lock().unwrap() == Some(args.id))
        .times(1)
        .in_sequence(&mut sequence)
        .return_once(|_, _, _| Box::pin(async { Ok(detail(Vec::new())) }));

    service_with(repo, surfaces)
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
async fn create_without_description_applies_the_team_default_and_leaves_surfaces_alone() {
    let expected = LinkShareState::On {
        scope: LinkShare::Team,
        level: ShareAccessLevel::View,
    };
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_team_default_link_share()
        .return_once(|_| Box::pin(async { Ok(Some(TeamLinkShareDefault(Some(LinkShare::Team)))) }));
    repo.expect_create()
        .withf(move |_, share_permission, _| share_permission.link_share_state() == expected)
        .return_once(|_, _, _| Box::pin(async { Ok(detail(Vec::new())) }));

    // `service` has no surface expectations: the surface is ensured on first open.
    service(repo)
        .create(
            &user(OWNER),
            CreateInitiativeRequest {
                name: "Launch".into(),
                description: Some("   ".into()),
                ..Default::default()
            },
        )
        .await
        .expect("created");
}

#[tokio::test]
async fn failed_initiative_write_retires_a_seeded_surface_and_returns_the_original_error() {
    let mut sequence = Sequence::new();
    let mut repo = MockInitiativeRepo::new();
    let mut surfaces = MockInitiativeDescriptionSurfaces::new();
    repo.expect_get_team_default_link_share()
        .return_once(|_| Box::pin(async { Ok(None) }));
    surfaces
        .expect_ensure()
        .times(1)
        .in_sequence(&mut sequence)
        .return_once(|_, _| Box::pin(async { Ok(()) }));
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
    surfaces
        .expect_delete()
        .times(1)
        .in_sequence(&mut sequence)
        .return_once(|_| {
            Box::pin(async {
                Err(InitiativeError::Internal(rootcause::report!(
                    "retire failed"
                )))
            })
        });

    let result = service_with(repo, surfaces)
        .create(
            &user(OWNER),
            CreateInitiativeRequest {
                name: "Launch".into(),
                description: Some("Plan".into()),
                ..Default::default()
            },
        )
        .await;
    assert!(
        matches!(result, Err(InitiativeError::Conflict(ref message)) if message == "initiative already exists")
    );
}

#[tokio::test]
async fn failed_initiative_write_without_description_touches_no_surface() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_team_default_link_share()
        .return_once(|_| Box::pin(async { Ok(None) }));
    repo.expect_create().return_once(|_, _, _| {
        Box::pin(async {
            Err(InitiativeError::Conflict(
                "initiative already exists".into(),
            ))
        })
    });

    let result = service(repo)
        .create(
            &user(OWNER),
            CreateInitiativeRequest {
                name: "Launch".into(),
                ..Default::default()
            },
        )
        .await;
    assert!(matches!(result, Err(InitiativeError::Conflict(_))));
}

#[tokio::test]
async fn failed_surface_seed_creates_no_initiative() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_team_default_link_share()
        .return_once(|_| Box::pin(async { Ok(None) }));
    let mut surfaces = MockInitiativeDescriptionSurfaces::new();
    surfaces.expect_ensure().return_once(|_, _| {
        Box::pin(async { Err(InitiativeError::Internal(rootcause::report!("sync down"))) })
    });

    // The repo mock has no create expectation: the row is never written.
    let result = service_with(repo, surfaces)
        .create(
            &user(OWNER),
            CreateInitiativeRequest {
                name: "Launch".into(),
                description: Some("Plan".into()),
                ..Default::default()
            },
        )
        .await;
    assert!(matches!(result, Err(InitiativeError::Internal(_))));
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
async fn owner_receipt_renames_and_replaces_members() {
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
            owner_edit_receipt(),
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
            owner_edit_receipt(),
            UpdateInitiativeRequest {
                member_ids: Some(vec!["nope".into()]),
                ..Default::default()
            },
        )
        .await;
    assert!(matches!(result, Err(InitiativeError::BadRequest(_))));
}

#[tokio::test]
async fn owner_patches_team_share_from_the_initiative_facts() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_team_share_facts()
        .withf(|id| *id == initiative_id())
        .times(1)
        .return_once(|_| Box::pin(async { Ok(initiative_facts(OWNER)) }));
    repo.expect_update()
        .withf(|args| {
            args.team_share.as_ref().is_some_and(|command| {
                command.expected() == &initiative_facts(OWNER)
                    && command.target().map(|grant| grant.level.into())
                        == Some(ShareAccessLevel::Edit)
            })
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
async fn team_share_patch_is_refused_when_the_actor_does_not_own_the_initiative() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_team_share_facts()
        .return_once(|_| Box::pin(async { Ok(initiative_facts(OTHER)) }));

    let result = service(repo)
        .update(
            owner_edit_receipt(),
            UpdateInitiativeRequest {
                share_permission: Some(share_update()),
                ..Default::default()
            },
        )
        .await;
    assert!(matches!(result, Err(InitiativeError::Unauthorized)));
}

#[tokio::test]
async fn get_and_list_call_the_repo() {
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
                    updated_at: now(),
                }],
            })
        })
    });

    let svc = service(repo);
    svc.internal_get_basic(initiative_id())
        .await
        .expect("basic");
    svc.get(view_receipt()).await.expect("detail");
    svc.list(&user(OWNER)).await.expect("list");
}

#[tokio::test]
async fn delete_retires_the_surface_after_the_initiative() {
    let mut sequence = Sequence::new();
    let mut repo = MockInitiativeRepo::new();
    let mut surfaces = MockInitiativeDescriptionSurfaces::new();
    repo.expect_delete()
        .withf(|id| *id == initiative_id())
        .times(1)
        .in_sequence(&mut sequence)
        .return_once(|_| Box::pin(async { Ok(()) }));
    surfaces
        .expect_delete()
        .withf(|id| *id == initiative_id())
        .times(1)
        .in_sequence(&mut sequence)
        .return_once(|_| Box::pin(async { Ok(()) }));

    service_with(repo, surfaces)
        .delete(owner_receipt())
        .await
        .expect("deleted");
}

#[tokio::test]
async fn delete_reports_a_failed_surface_retirement_after_the_initiative_is_gone() {
    let mut repo = MockInitiativeRepo::new();
    let mut surfaces = MockInitiativeDescriptionSurfaces::new();
    repo.expect_delete()
        .return_once(|_| Box::pin(async { Ok(()) }));
    surfaces.expect_delete().return_once(|_| {
        Box::pin(async { Err(InitiativeError::Internal(rootcause::report!("sync down"))) })
    });

    let result = service_with(repo, surfaces).delete(owner_receipt()).await;
    assert!(matches!(result, Err(InitiativeError::Internal(_))));
}

#[tokio::test]
async fn ensure_description_surface_ensures_an_empty_surface_for_the_initiative() {
    let mut surfaces = MockInitiativeDescriptionSurfaces::new();
    surfaces
        .expect_ensure()
        .withf(|initiative, markdown| *initiative == initiative_id() && markdown.is_empty())
        .times(1)
        .return_once(|_, _| Box::pin(async { Ok(()) }));

    service_with(MockInitiativeRepo::new(), surfaces)
        .ensure_description_surface(view_receipt())
        .await
        .expect("ensured");
}

#[tokio::test]
async fn read_description_reads_the_initiative_surface() {
    let mut surfaces = MockInitiativeDescriptionSurfaces::new();
    surfaces
        .expect_read()
        .withf(|initiative| *initiative == initiative_id())
        .times(1)
        .return_once(|_| Box::pin(async { Ok("# Goals".to_string()) }));

    let description = service_with(MockInitiativeRepo::new(), surfaces)
        .read_description(view_receipt())
        .await
        .expect("read");
    assert_eq!(description, "# Goals");
}

#[tokio::test]
async fn ensure_description_surface_rejects_other_receipts() {
    let document_receipt: EntityAccessReceipt<ViewAccessLevel> =
        receipt(OWNER, EntityType::Document, AccessLevel::View);
    assert!(matches!(
        service(MockInitiativeRepo::new())
            .ensure_description_surface(document_receipt)
            .await,
        Err(InitiativeError::BadRequest(_))
    ));
}
