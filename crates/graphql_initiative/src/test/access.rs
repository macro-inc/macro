use super::*;
use entity_access::domain::models::{
    AccessError, EditAccessLevel, EntityAccessAuth, EntityAccessReceipt, EntityPermission,
    EntityType, OwnerAccessLevel, RequiredPermission, ViewAccessLevel,
};
use initiative::domain::ports::InitiativeService;

#[derive(Default)]
struct ReceiptService {
    receipts: Mutex<Vec<(String, String)>>,
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
        unreachable!("unexpected domain call")
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
