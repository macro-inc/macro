use super::*;
use crate::task_dependencies::BlockerVisibilityBudget;
use entity_access::domain::models::{AccessError, AccessLevel, Entity};
use macro_user_id::{cowlike::CowLike, lowercased::Lowercase, user_id::MacroUserId};
use std::{
    collections::HashSet,
    sync::atomic::{AtomicUsize, Ordering},
};

fn receipt(key: &model_entity::Entity<'static>) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap(),
        Entity {
            entity_id: key.entity_id.to_string(),
            entity_type: key.entity_type,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap()
}

#[tokio::test]
async fn retains_only_authorized_property_targets() {
    let keys = [
        model_entity::EntityType::DatabaseRow.with_entity_string("allowed".into()),
        model_entity::EntityType::DatabaseRow.with_entity_string("denied".into()),
        model_entity::EntityType::Team.with_entity_string("unsupported".into()),
        model_entity::EntityType::Document.with_entity_string("document".into()),
        model_entity::EntityType::CrmContact.with_entity_string("contact".into()),
    ];
    let calls = AtomicUsize::new(0);
    let receipts = load_view_receipts(&keys, |key| {
        calls.fetch_add(1, Ordering::SeqCst);
        async move {
            if key.entity_id == "denied" {
                Err(AccessError::internal("denied"))
            } else {
                Ok(receipt(key))
            }
        }
    })
    .await;
    assert_eq!(calls.load(Ordering::SeqCst), 4);
    let mut ids = receipts
        .iter()
        .map(|receipt| receipt.entity().entity_id.as_str())
        .collect::<Vec<_>>();
    ids.sort();
    assert_eq!(ids, ["allowed", "contact", "document"]);
}

#[tokio::test]
async fn authorizes_concurrently_with_a_bounded_number_of_checks() {
    let keys = (0..18)
        .map(|index| model_entity::EntityType::DatabaseRow.with_entity_string(index.to_string()))
        .collect::<Vec<_>>();
    let active = AtomicUsize::new(0);
    let maximum = AtomicUsize::new(0);
    let receipts = load_view_receipts(&keys, |key| async {
        let count = active.fetch_add(1, Ordering::SeqCst) + 1;
        maximum.fetch_max(count, Ordering::SeqCst);
        tokio::task::yield_now().await;
        active.fetch_sub(1, Ordering::SeqCst);
        Ok(receipt(key))
    })
    .await;
    assert_eq!(receipts.len(), 18);
    assert_eq!(active.load(Ordering::SeqCst), 0);
    assert_eq!(maximum.load(Ordering::SeqCst), 16);
}

/// Access fake for document routing: the bulk lookup either answers with the
/// documents it grants or fails; the per-entity check grants `granted`.
#[derive(Clone, Default)]
struct DocumentAccess {
    granted: Vec<String>,
    bulk_fails: bool,
    bulk_pending: bool,
    bulk_batches: Arc<std::sync::Mutex<Vec<Vec<String>>>>,
    single_checks: Arc<std::sync::Mutex<Vec<String>>>,
}

fn grant<T: entity_access::domain::models::RequiredPermission>(
    user_id: &MacroUserId<Lowercase<'_>>,
    entity_id: &str,
    entity_type: model_entity::EntityType,
) -> Result<EntityAccessReceipt<T>, AccessError> {
    EntityAccessReceipt::try_new_authenticated_user(
        MacroUserIdStr(user_id.clone().into_owned()),
        Entity {
            entity_id: entity_id.into(),
            entity_type,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
}

fn not_used() -> AccessError {
    AccessError::internal("not used by the property loader")
}

impl EntityAccessService for DocumentAccess {
    async fn generate_entity_access_receipt<
        T: entity_access::domain::models::RequiredPermission,
    >(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: model_entity::EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        self.single_checks
            .lock()
            .unwrap()
            .push(entity_id.to_string());
        if !self.granted.iter().any(|id| id == entity_id) {
            return Err(AccessError::Unauthorized);
        }
        grant(user_id, entity_id, entity_type)
    }

    async fn generate_document_view_access_receipts<'a>(
        &'a self,
        user_id: &'a MacroUserId<Lowercase<'_>>,
        document_ids: &'a [String],
    ) -> Result<HashMap<String, EntityAccessReceipt<ViewAccessLevel>>, AccessError> {
        self.bulk_batches
            .lock()
            .unwrap()
            .push(document_ids.to_vec());
        if self.bulk_fails {
            return Err(AccessError::internal("statement timeout"));
        }
        if self.bulk_pending {
            std::future::pending::<()>().await;
        }
        document_ids
            .iter()
            .filter(|id| self.granted.contains(id))
            .map(|id| {
                Ok((
                    id.clone(),
                    grant(user_id, id, model_entity::EntityType::Document)?,
                ))
            })
            .collect()
    }

    async fn generate_bot_entity_access_receipt<
        T: entity_access::domain::models::RequiredPermission,
    >(
        &self,
        _bot_id: entity_access::domain::models::BotId,
        _scope: entity_access::domain::models::BotAccessScope,
        _entity_id: &str,
        _entity_type: model_entity::EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Err(not_used())
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: model_entity::EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Err(not_used())
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: model_entity::EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(not_used())
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: model_entity::EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(not_used())
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: model_entity::EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        Err(not_used())
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: model_entity::EntityType,
    ) -> Result<
        (
            EntityPermission,
            Uuid,
            entity_access::domain::models::TeamRole,
        ),
        AccessError,
    > {
        Err(not_used())
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: model_entity::EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Err(not_used())
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<entity_access::domain::models::CallChannelInfo>, AccessError> {
        Err(not_used())
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<entity_access::domain::models::CallChannelInfo>, AccessError> {
        Err(not_used())
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<entity_access::domain::models::UserTeamInfo>, AccessError> {
        Err(not_used())
    }
}

const GRANTED: &str = "0193376c-5c8a-721a-a585-d8f282b3b334";
const REFUSED: &str = "01933945-3b50-78fa-9551-9a9981aeddf5";
const MISSING: &str = "019339ae-fde1-71fa-b3cb-e5c6b5d6e83c";
const LEGACY: &str = "legacy-document";

/// Granted, refused, missing and legacy-id documents in one batch.
fn mixed_documents() -> Vec<model_entity::Entity<'static>> {
    [GRANTED, REFUSED, MISSING, LEGACY]
        .into_iter()
        .map(|id| model_entity::EntityType::Document.with_entity_string(id.into()))
        .collect()
}

async fn authorized_ids(access: &DocumentAccess) -> Vec<String> {
    let reader = PropertiesEntityPropertyReader::new(Arc::new(()), Arc::new(access.clone()));
    let user = MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap();
    let mut ids = reader
        .view_receipts(&user, &mixed_documents())
        .await
        .iter()
        .map(|receipt| receipt.entity().entity_id.to_string())
        .collect::<Vec<_>>();
    ids.sort();
    ids
}

#[tokio::test]
async fn documents_are_authorized_by_the_bulk_lookup() {
    let access = DocumentAccess {
        granted: vec![GRANTED.into(), LEGACY.into()],
        ..DocumentAccess::default()
    };
    assert_eq!(authorized_ids(&access).await, [GRANTED, LEGACY]);
    assert!(access.single_checks.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_failed_bulk_lookup_checks_each_document() {
    let access = DocumentAccess {
        granted: vec![GRANTED.into(), LEGACY.into()],
        bulk_fails: true,
        ..DocumentAccess::default()
    };
    assert_eq!(authorized_ids(&access).await, [GRANTED, LEGACY]);
    let mut checked = access.single_checks.lock().unwrap().clone();
    checked.sort();
    let mut expected = [GRANTED, REFUSED, MISSING, LEGACY].map(String::from);
    expected.sort();
    assert_eq!(checked, expected);
}

#[tokio::test]
async fn blocker_visibility_uses_one_status_neutral_bulk_call() {
    use crate::task_dependencies::load_blocker_view_receipts;
    use properties::domain::task_dependency_state::TaskDependencyState;
    let task = Uuid::from_u128(2000);
    let blockers = (1..=1001).map(Uuid::from_u128).collect::<Vec<_>>();
    let granted = blockers
        .iter()
        .take(501)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let access = DocumentAccess {
        granted,
        ..Default::default()
    };
    let user = MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap();
    for open in [blockers.clone(), vec![], vec![blockers[0]]] {
        let facts = HashMap::from([(
            task,
            TaskDependencyState {
                task_id: task,
                blocker_ids: blockers.clone(),
                open_blocker_ids: open,
                ..Default::default()
            },
        )]);
        let visible =
            load_blocker_view_receipts(&access, &user, &facts, &BlockerVisibilityBudget::default())
                .await
                .unwrap();
        assert_eq!(
            visible.into_keys().collect::<HashSet<_>>(),
            blockers.iter().take(501).copied().collect()
        );
    }
    let batches = access.bulk_batches.lock().unwrap();
    assert_eq!(
        batches.iter().map(Vec::len).collect::<Vec<_>>(),
        [1000, 1000, 1000]
    );
    assert!(access.single_checks.lock().unwrap().is_empty());
}

#[tokio::test]
async fn blocker_visibility_fails_closed_when_bulk_authorization_fails() {
    use crate::task_dependencies::load_blocker_view_receipts;
    use properties::domain::task_dependency_state::TaskDependencyState;
    let task = Uuid::from_u128(1);
    let access = DocumentAccess {
        bulk_fails: true,
        ..Default::default()
    };
    let user = MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap();
    let facts = HashMap::from([(
        task,
        TaskDependencyState {
            task_id: task,
            blocker_ids: vec![Uuid::from_u128(2)],
            ..Default::default()
        },
    )]);
    assert!(
        load_blocker_view_receipts(&access, &user, &facts, &BlockerVisibilityBudget::default())
            .await
            .is_err()
    );
    assert!(access.single_checks.lock().unwrap().is_empty());
}

#[tokio::test(start_paused = true)]
async fn blocker_visibility_deadline_preserves_only_canonical_aggregate() {
    use crate::task_dependencies::load_blocker_view_receipts;
    use properties::domain::task_dependency_state::TaskDependencyState;
    let access = DocumentAccess {
        bulk_pending: true,
        ..Default::default()
    };
    let user = MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap();
    let task = Uuid::from_u128(1);
    let facts = HashMap::from([(
        task,
        TaskDependencyState {
            task_id: task,
            blocker_ids: vec![Uuid::from_u128(2)],
            open_blocker_ids: vec![Uuid::from_u128(2)],
            ..Default::default()
        },
    )]);
    let started = tokio::time::Instant::now();
    let receipts =
        load_blocker_view_receipts(&access, &user, &facts, &BlockerVisibilityBudget::default())
            .await
            .unwrap();
    assert_eq!(started.elapsed(), std::time::Duration::from_secs(5));
    assert!(receipts.is_empty());
    let state = facts[&task].visible_state(&[]);
    assert!(state.is_blocked);
    assert!(state.visible_blocker_ids.is_empty());
    assert!(state.open_blocker_ids.is_empty());
    assert_eq!(access.bulk_batches.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn large_dependency_batches_never_expand_the_authorization_budget() {
    use crate::task_dependencies::load_blocker_view_receipts;
    use properties::domain::task_dependency_state::TaskDependencyState;
    let facts = (0..500u128)
        .map(|source| {
            let task_id = Uuid::from_u128(source + 1);
            let blockers = (0..1000)
                .map(|offset| Uuid::from_u128(1000000 + source * 1000 + offset))
                .collect::<Vec<_>>();
            (
                task_id,
                TaskDependencyState {
                    task_id,
                    open_blocker_ids: blockers.clone(),
                    blocker_ids: blockers,
                    ..Default::default()
                },
            )
        })
        .collect::<HashMap<_, _>>();
    let access = DocumentAccess {
        granted: facts[&Uuid::from_u128(1)]
            .blocker_ids
            .iter()
            .map(ToString::to_string)
            .collect(),
        ..Default::default()
    };
    let user = MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap();
    let receipts =
        load_blocker_view_receipts(&access, &user, &facts, &BlockerVisibilityBudget::default())
            .await
            .unwrap();
    assert_eq!(receipts.len(), 1000);
    assert_eq!(
        access
            .bulk_batches
            .lock()
            .unwrap()
            .iter()
            .map(Vec::len)
            .collect::<Vec<_>>(),
        [1000]
    );
    let unverified = facts[&Uuid::from_u128(500)].visible_state(&[]);
    assert!(unverified.is_blocked);
    assert!(unverified.open_blocker_ids.is_empty());
}

#[tokio::test(start_paused = true)]
async fn visibility_quota_and_deadline_are_shared_across_loader_batches() {
    use crate::task_dependencies::load_blocker_view_receipts;
    use properties::domain::task_dependency_state::TaskDependencyState;
    let task = Uuid::from_u128(1);
    let blockers = (2..=501).map(Uuid::from_u128).collect::<Vec<_>>();
    let facts = HashMap::from([(
        task,
        TaskDependencyState {
            task_id: task,
            blocker_ids: blockers.clone(),
            ..Default::default()
        },
    )]);
    let mut access = DocumentAccess {
        granted: blockers.iter().map(ToString::to_string).collect(),
        ..Default::default()
    };
    let user = MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap();
    let budget = BlockerVisibilityBudget::default();
    let first = load_blocker_view_receipts(&access, &user, &facts, &budget)
        .await
        .unwrap();
    assert_eq!(first.len(), 500);
    let second = load_blocker_view_receipts(&access, &user, &facts, &budget)
        .await
        .unwrap();
    assert_eq!(second.len(), 500);
    let exhausted = load_blocker_view_receipts(&access, &user, &facts, &budget)
        .await
        .unwrap();
    assert!(exhausted.is_empty());
    assert_eq!(access.bulk_batches.lock().unwrap().len(), 2);

    let budget = BlockerVisibilityBudget::default();
    let started = tokio::time::Instant::now();
    load_blocker_view_receipts(&access, &user, &facts, &budget)
        .await
        .unwrap();
    tokio::time::advance(std::time::Duration::from_secs(4)).await;
    access.bulk_pending = true;
    let timed_out = load_blocker_view_receipts(&access, &user, &facts, &budget)
        .await
        .unwrap();
    assert!(timed_out.is_empty());
    assert_eq!(started.elapsed(), std::time::Duration::from_secs(5));
}
