use super::*;
use entity_access::domain::models::{
    AccessError, EditAccessLevel, EntityAccessAuth, EntityAccessReceipt, EntityPermission,
    EntityType, OwnerAccessLevel, RequiredPermission, ViewAccessLevel,
};
use initiative::domain::ports::InitiativeService;

#[derive(Default)]
struct ReceiptService {
    receipts: Mutex<Vec<(String, String)>>,
    assignments: Mutex<Vec<String>>,
}

#[allow(unused_variables)]
impl InitiativeService for ReceiptService {
    async fn summary(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<InitiativePageRow, InitiativeError> {
        unreachable!("unexpected domain call")
    }
    async fn page(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: InitiativePageRequest,
    ) -> Result<InitiativePage, InitiativeError> {
        unreachable!("unexpected domain call")
    }
    async fn tasks_page(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        request: InitiativeTasksRequest,
    ) -> Result<InitiativeTasksPage, InitiativeError> {
        unreachable!("unexpected domain call")
    }
    async fn task_references(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: TaskInitiativeReferencesRequest,
    ) -> Result<TaskInitiativeReferences, InitiativeError> {
        unreachable!("unexpected domain call")
    }
    async fn create(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: CreateInitiativeRequest,
    ) -> Result<InitiativeDetail, InitiativeError> {
        unreachable!("unexpected domain call")
    }

    async fn internal_get_basic(
        &self,
        id: InitiativeId,
    ) -> Result<InitiativeBasic, InitiativeError> {
        unreachable!("unexpected domain call")
    }
    async fn get(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<InitiativeDetail, InitiativeError> {
        unreachable!("unexpected domain call")
    }
    async fn list(&self, user_id: &MacroUserIdStr<'_>) -> Result<InitiativeList, InitiativeError> {
        unreachable!("unexpected domain call")
    }
    async fn update(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        request: UpdateInitiativeRequest,
    ) -> Result<InitiativeDetail, InitiativeError> {
        unreachable!("unexpected domain call")
    }
    async fn assign_tasks(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        assignments: Vec<TaskAssignment>,
    ) -> Result<AssignTasksResponse, InitiativeError> {
        *self.assignments.lock().unwrap() = assignments
            .iter()
            .map(|assignment| assignment.task_id().to_owned())
            .collect();
        Ok(AssignTasksResponse {
            results: assignments
                .into_iter()
                .map(|assignment| AssignTasksResult {
                    task_id: assignment.task_id().to_owned(),
                    status: match assignment {
                        TaskAssignment::Authorized { .. } => AssignTaskStatus::Assigned,
                        TaskAssignment::NotFound { .. } => AssignTaskStatus::NotFound,
                        TaskAssignment::SkippedNoPermission { .. } => {
                            AssignTaskStatus::SkippedNoPermission
                        }
                    },
                })
                .collect(),
        })
    }
    async fn unassign_task(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        task_receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<(), InitiativeError> {
        unreachable!("unexpected domain call")
    }
    async fn clear_task(
        &self,
        task_receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<(), InitiativeError> {
        self.receipts.lock().unwrap().push((
            task_receipt.entity().entity_id.clone(),
            task_receipt.get_authenticated_user().unwrap().to_string(),
        ));
        Ok(())
    }
    async fn grant_assignees(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        user_ids: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), InitiativeError> {
        unreachable!("unexpected domain call")
    }
    async fn delete(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), InitiativeError> {
        unreachable!("unexpected domain call")
    }
}

struct TaskOnlyAccess {
    level: AccessLevel,
    calls: Mutex<Vec<(String, EntityType)>>,
}

impl InitiativeAuthorizer for TaskOnlyAccess {
    async fn authorize<T: RequiredPermission>(
        &self,
        user: &MacroUserIdStr<'static>,
        id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        self.calls
            .lock()
            .unwrap()
            .push((id.to_string(), entity_type));
        assert_eq!(
            entity_type,
            EntityType::Document,
            "clearing a task must not depend on project access"
        );
        EntityAccessReceipt::try_new(
            EntityAccessAuth::Authenticated(user.clone()),
            entity_access::domain::models::Entity {
                entity_id: id.to_string(),
                entity_type,
            },
            EntityPermission::AccessLevel {
                access_level: self.level,
            },
        )
    }
}

#[tokio::test]
async fn clear_task_succeeds_using_only_task_edit_access() {
    let service = Arc::new(ReceiptService::default());
    let access = Arc::new(TaskOnlyAccess {
        level: AccessLevel::Edit,
        calls: Mutex::new(Vec::new()),
    });
    let context = InitiativeGraphqlContext::new(service.clone(), access.clone());
    let schema = Schema::build(
        Query,
        InitiativeMutationRoot::<TestSoupEdges>::default(),
        EmptySubscription,
    )
    .data(context)
    .finish();
    let response = schema
        .execute(Request::new("mutation { clearTaskInitiative(taskId: \"task-1\") }").data(user()))
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        *service.receipts.lock().unwrap(),
        [("task-1".into(), "macro|viewer@example.com".into())]
    );
    assert_eq!(
        *access.calls.lock().unwrap(),
        [("task-1".into(), EntityType::Document)]
    );
}

#[tokio::test]
async fn clear_task_denied_edit_access_never_calls_service() {
    let service = Arc::new(ReceiptService::default());
    let access = Arc::new(TaskOnlyAccess {
        level: AccessLevel::View,
        calls: Mutex::new(Vec::new()),
    });
    let context = InitiativeGraphqlContext::new(service.clone(), access);
    let schema = Schema::build(
        Query,
        InitiativeMutationRoot::<TestSoupEdges>::default(),
        EmptySubscription,
    )
    .data(context)
    .finish();
    let response = schema
        .execute(Request::new("mutation { clearTaskInitiative(taskId: \"task-1\") }").data(user()))
        .await;
    assert_eq!(response.errors[0].message, "unauthorized");
    assert!(service.receipts.lock().unwrap().is_empty());
}

#[derive(Default)]
struct ConcurrentAccess {
    destination_checked: std::sync::atomic::AtomicBool,
    inflight: std::sync::atomic::AtomicUsize,
    peak: std::sync::atomic::AtomicUsize,
    calls: Mutex<Vec<String>>,
    deny_destination: bool,
}

impl InitiativeAuthorizer for ConcurrentAccess {
    async fn authorize<T: RequiredPermission>(
        &self,
        user: &MacroUserIdStr<'static>,
        id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        use std::sync::atomic::Ordering::SeqCst;
        self.calls.lock().unwrap().push(id.to_owned());
        if entity_type == EntityType::Initiative {
            self.destination_checked.store(true, SeqCst);
            if self.deny_destination {
                return Err(AccessError::Unauthorized);
            }
        } else {
            assert!(self.destination_checked.load(SeqCst));
            let running = self.inflight.fetch_add(1, SeqCst) + 1;
            self.peak.fetch_max(running, SeqCst);
            tokio::task::yield_now().await;
            if id.ends_with('0') {
                tokio::task::yield_now().await;
            }
            self.inflight.fetch_sub(1, SeqCst);
            if id == "task-1" {
                return Err(AccessError::Unauthorized);
            }
        }
        EntityAccessReceipt::try_new(
            EntityAccessAuth::Authenticated(user.clone()),
            entity_access::domain::models::Entity {
                entity_id: id.to_owned(),
                entity_type,
            },
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Edit,
            },
        )
    }
}

#[tokio::test]
async fn task_assignment_authorization_is_bounded_concurrent_and_keeps_input_order() {
    let service = Arc::new(ReceiptService::default());
    let access = Arc::new(ConcurrentAccess::default());
    let context = InitiativeGraphqlContext::new(service.clone(), access.clone());
    let ids: Vec<_> = (0..40).map(|index| format!("task-{index}")).collect();
    let result = context
        .0
        .assign(user(), Uuid::from_u128(1), ids.clone())
        .await
        .unwrap();
    assert_eq!(*service.assignments.lock().unwrap(), ids);
    assert_eq!(
        result.results[1].status,
        AssignTaskStatus::SkippedNoPermission
    );
    let peak = access.peak.load(std::sync::atomic::Ordering::SeqCst);
    assert!(
        peak > 1 && peak <= 16,
        "expected bounded parallel checks; observed {peak}"
    );
}

#[tokio::test]
async fn task_assignment_validates_batch_and_destination_before_authorizing_tasks() {
    let service = Arc::new(ReceiptService::default());
    let access = Arc::new(ConcurrentAccess {
        deny_destination: true,
        ..Default::default()
    });
    let context = InitiativeGraphqlContext::new(service.clone(), access.clone());
    assert!(
        context
            .0
            .assign(
                user(),
                Uuid::from_u128(1),
                (0..101).map(|id| id.to_string()).collect()
            )
            .await
            .is_err()
    );
    assert!(access.calls.lock().unwrap().is_empty());
    assert!(
        context
            .0
            .assign(user(), Uuid::from_u128(1), vec!["task-0".into()])
            .await
            .is_err()
    );
    assert_eq!(access.calls.lock().unwrap().len(), 1);
    assert!(service.assignments.lock().unwrap().is_empty());
}
