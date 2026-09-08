use super::*;
use entity_access::domain::{models::OwnerAccessLevel, service::EntityAccessServiceImpl};
use entity_access::outbound::PgAccessRepository;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::PgPool;
use std::sync::Mutex;

// These fakes test dispatch and transport behavior, not domain authorization.
// Receipts still come from the real access service and PostgreSQL queries.
struct ShareCapability {
    kind: EntityType,
    received: Mutex<Vec<UpdateSharePermissionRequestV2>>,
}

impl ShareCapability {
    fn new(kind: EntityType) -> Self {
        Self {
            kind,
            received: Mutex::new(Vec::new()),
        }
    }

    fn receive(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        policy: UpdateSharePermissionRequestV2,
    ) -> Result<(), ThreadShareError> {
        assert_eq!(receipt.entity().entity_type, self.kind);
        assert_eq!(
            receipt.acting_user_id().unwrap().as_ref(),
            "macro|owner@share.test"
        );
        let level = policy.team_share_access_level;
        self.received.lock().unwrap().push(policy);
        // Representative per-item downstream errors must survive batching.
        match level {
            Some(None) => Err(ThreadShareError::Policy(TeamSharePolicyError::NotOwner)),
            Some(Some(AccessLevel::Owner)) => {
                Err(ThreadShareError::Policy(TeamSharePolicyError::InvalidLevel))
            }
            _ => Ok(()),
        }
    }
}

impl UpdateEntitySharePolicy for ShareCapability {
    type Receipt = OwnerAccessLevel;

    async fn update_share_policy(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
        policy: UpdateSharePermissionRequestV2,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        assert_eq!(entity.entity_id.as_ref(), receipt.entity().entity_id);
        self.receive(receipt, policy)
            .map_err(thread_share_failure)?;
        Ok(vec![EntityMutationEffect::updated(entity)])
    }
}

// Any unrelated capability invocation is a dispatch regression.
macro_rules! unused_receipt_capability {
    ($trait:ident, $method:ident $(, $arg:ident : $ty:ty)*) => {
        impl $trait for ShareCapability {
            type Receipt = OwnerAccessLevel;
            async fn $method(&self, _: Entity<'static>, _: EntityAccessReceipt<Self::Receipt> $(, $arg: $ty)*) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
                $(let _ = $arg;)*
                panic!("unexpected capability: {}", stringify!($method));
            }
        }
    };
}
unused_receipt_capability!(RenameEntity, rename_entity, name: String);
unused_receipt_capability!(TrashEntity, trash_entity);
unused_receipt_capability!(RestoreEntity, restore_entity);
unused_receipt_capability!(DeleteEntityPermanently, delete_entity_permanently);
unused_receipt_capability!(DuplicateEntity, duplicate_entity, user: MacroUserIdStr<'static>, name: Option<String>);

impl MoveEntity for ShareCapability {
    type Receipt = OwnerAccessLevel;
    async fn move_entity(
        &self,
        _: CapabilityMoveEntityRequest<Self::Receipt>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        panic!("unexpected move");
    }
}

impl EntityLifecycleService for ShareCapability {
    async fn update_thread_share_policy(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        policy: UpdateSharePermissionRequestV2,
    ) -> Result<(), ThreadShareError> {
        self.receive(receipt, policy)
    }
    async fn restore_document(
        &self,
        _: &EntityMutationActor,
        _: &Entity<'static>,
    ) -> Result<Vec<Entity<'static>>, LifecycleError> {
        panic!("unexpected restore");
    }
    async fn delete_document_permanently(
        &self,
        _: &EntityMutationActor,
        _: &Entity<'static>,
    ) -> Result<Vec<Entity<'static>>, LifecycleError> {
        panic!("unexpected permanent delete");
    }
}

#[sqlx::test(
    migrations = "../../crates/macro_db_client/migrations",
    fixtures(
        path = "../../../../../crates/entity_access/fixtures",
        scripts("team_share")
    )
)]
async fn team_share_dispatch_preserves_all_kinds_tristate_and_per_item_results(pool: PgPool) {
    let documents = Arc::new(ShareCapability::new(EntityType::Document));
    let chats = Arc::new(ShareCapability::new(EntityType::Chat));
    let calls = Arc::new(ShareCapability::new(EntityType::Call));
    let projects = Arc::new(ShareCapability::new(EntityType::Project));
    let threads = Arc::new(ShareCapability::new(EntityType::EmailThread));
    let unused = Arc::new(ShareCapability::new(EntityType::Channel));
    let service = DssEntityMutationService::new(
        documents.clone(),
        chats.clone(),
        unused.clone(),
        calls.clone(),
        unused.clone(),
        projects.clone(),
        Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(pool))),
        threads.clone(),
    );
    let actor = EntityMutationActor {
        user_id: MacroUserIdStr::parse_from_str("macro|owner@share.test")
            .unwrap()
            .into_owned(),
        organization_id: None,
    };
    let entities: Vec<_> = [
        (EntityType::Project, 1),
        (EntityType::Document, 2),
        (EntityType::Chat, 3),
        (EntityType::EmailThread, 4),
        (EntityType::Call, 5),
        (EntityType::Call, 6),
        (EntityType::Document, 7),
        (EntityType::Document, 8),
    ]
    .into_iter()
    .map(|(kind, id)| kind.with_entity_string(format!("20000000-0000-0000-0000-{id:012}")))
    .collect();
    let levels = [
        None,
        Some(None),
        Some(Some(AccessLevel::View)),
        Some(Some(AccessLevel::Comment)),
        Some(Some(AccessLevel::Edit)),
        Some(Some(AccessLevel::Owner)),
    ];
    let mut requests = Vec::new();
    for entity in &entities {
        for level in levels {
            requests.push(UpdateEntitySharePolicyRequest {
                entity: entity.clone(),
                policy: UpdateSharePermissionRequestV2 {
                    team_share_access_level: level,
                    link_share: None,
                    link_share_access_level: None,
                    channel_share_permissions: None,
                },
            });
        }
    }
    let expected: Vec<_> = requests
        .iter()
        .map(|r| (r.entity.clone(), r.policy.team_share_access_level))
        .collect();
    let results = service.update_share_policies(actor, requests).await;
    assert_eq!(results.len(), expected.len());
    for (result, (entity, level)) in results.into_iter().zip(expected) {
        match level {
            Some(None) => assert!(matches!(result, Err(EntityMutationErrorCode::Forbidden(_)))),
            Some(Some(AccessLevel::Owner)) => assert!(matches!(
                result,
                Err(EntityMutationErrorCode::InvalidInput(_))
            )),
            _ => assert_eq!(
                result.unwrap().effects,
                vec![EntityMutationEffect::updated(entity)]
            ),
        }
    }
    for (capability, count) in [
        (&documents, 3),
        (&chats, 1),
        (&calls, 2),
        (&projects, 1),
        (&threads, 1),
    ] {
        let received = capability.received.lock().unwrap();
        assert_eq!(received.len(), count * levels.len());
        for level in levels {
            assert_eq!(
                received
                    .iter()
                    .filter(|p| p.team_share_access_level == level)
                    .count(),
                count
            );
        }
    }
    assert!(unused.received.lock().unwrap().is_empty());

    // Receipt rejection never reaches the domain, including in a mixed batch
    // with an unsupported kind. Input order and individual failures are retained.
    let actor = EntityMutationActor {
        user_id: MacroUserIdStr::parse_from_str("macro|viewer@share.test")
            .unwrap()
            .into_owned(),
        organization_id: None,
    };
    let requests = entities
        .into_iter()
        .chain([EntityType::Channel
            .with_entity_string("40000000-0000-0000-0000-000000000001".to_owned())])
        .map(|entity| UpdateEntitySharePolicyRequest {
            entity,
            policy: UpdateSharePermissionRequestV2 {
                team_share_access_level: Some(Some(AccessLevel::View)),
                link_share: None,
                link_share_access_level: None,
                channel_share_permissions: None,
            },
        })
        .collect();
    let results = service.update_share_policies(actor, requests).await;
    assert_eq!(results.len(), 9);
    assert!(
        results[..8]
            .iter()
            .all(|r| matches!(r, Err(EntityMutationErrorCode::Forbidden(_))))
    );
    assert!(matches!(
        results.last().unwrap(),
        Err(EntityMutationErrorCode::UnsupportedOperation(_))
    ));
    assert_eq!(documents.received.lock().unwrap().len(), 18);
    assert_eq!(chats.received.lock().unwrap().len(), 6);
    assert_eq!(calls.received.lock().unwrap().len(), 12);
    assert_eq!(projects.received.lock().unwrap().len(), 6);
    assert_eq!(threads.received.lock().unwrap().len(), 6);
}

#[test]
fn success_preserves_domain_effect_order_and_kind() {
    let requested = EntityType::Project.with_entity_string("project-1".to_owned());
    let child = EntityType::Document.with_entity_string("document-1".to_owned());
    let effects = vec![
        EntityMutationEffect::deleted(requested.clone()),
        EntityMutationEffect::updated(child.clone()),
    ];

    let success = success(effects.clone()).expect("mutation should succeed");

    assert_eq!(success.effects, effects);
}

#[test]
fn thread_invalid_inputs_map_to_stable_public_error() {
    let error = thread_share_failure(ThreadShareError::InvalidInput);

    assert!(matches!(
        error,
        entity_mutation::EntityMutationErrorCode::InvalidInput(_)
    ));
}

#[test]
fn thread_sharing_failures_have_stable_transport_codes() {
    for policy in [
        TeamSharePolicyError::NotOwner,
        TeamSharePolicyError::MissingActor,
    ] {
        assert!(matches!(
            thread_share_failure(ThreadShareError::Policy(policy)),
            EntityMutationErrorCode::Forbidden(_)
        ));
    }
    for policy in [
        TeamSharePolicyError::InvalidLevel,
        TeamSharePolicyError::MissingTeam,
    ] {
        assert!(matches!(
            thread_share_failure(ThreadShareError::Policy(policy)),
            EntityMutationErrorCode::InvalidInput(_)
        ));
    }
    assert!(matches!(
        thread_share_failure(ThreadShareError::Conflict),
        EntityMutationErrorCode::Conflict(_)
    ));
    assert!(matches!(
        thread_share_failure(ThreadShareError::NotFound),
        EntityMutationErrorCode::NotFound(_)
    ));
}

#[test]
fn target_project_failures_map_to_stable_error_codes() {
    let forbidden = target_project_failure(AccessError::Unauthorized);
    assert!(matches!(
        forbidden,
        entity_mutation::EntityMutationErrorCode::Forbidden(_)
    ));

    let missing = target_project_failure(AccessError::NotFound("project-1"));
    assert!(matches!(
        missing,
        entity_mutation::EntityMutationErrorCode::NotFound(_)
    ));
}
