//! Request capabilities supplied by the application composition root.

use std::{future::Future, pin::Pin, sync::Arc};

use entity_access::domain::{
    models::{
        AccessError, EditAccessLevel, EntityAccessReceipt, EntityType, OwnerAccessLevel,
        RequiredPermission, ViewAccessLevel,
    },
    ports::EntityAccessService,
};
use initiative::domain::{
    models::{
        AssignTasksResponse, CreateInitiativeRequest, InitiativeDetail, InitiativeError,
        TaskAssignment, TaskAssignmentBatch, UpdateInitiativeRequest,
    },
    ports::InitiativeService,
    reads::{
        InitiativePage, InitiativePageRequest, InitiativePageRow, InitiativeTasksPage,
        InitiativeTasksRequest, TaskInitiativeReferences, TaskInitiativeReferencesRequest,
    },
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Object-safe forwarding future for the request's concrete domain services.
pub(crate) type ApiFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, InitiativeError>> + Send + 'a>>;

/// Transport-facing service bundle; implementations mint receipts and delegate policy.
pub(crate) trait InitiativeApi: Send + Sync {
    fn page(
        &self,
        user: MacroUserIdStr<'static>,
        input: InitiativePageRequest,
    ) -> ApiFuture<'_, InitiativePage>;
    fn summary(&self, user: MacroUserIdStr<'static>, id: Uuid) -> ApiFuture<'_, InitiativePageRow>;
    fn get(&self, user: MacroUserIdStr<'static>, id: Uuid) -> ApiFuture<'_, InitiativeDetail>;
    fn tasks(
        &self,
        user: MacroUserIdStr<'static>,
        id: Uuid,
        input: InitiativeTasksRequest,
    ) -> ApiFuture<'_, InitiativeTasksPage>;
    fn references(
        &self,
        user: MacroUserIdStr<'static>,
        ids: Vec<String>,
    ) -> ApiFuture<'_, TaskInitiativeReferences>;
    fn create(
        &self,
        user: MacroUserIdStr<'static>,
        input: CreateInitiativeRequest,
    ) -> ApiFuture<'_, InitiativeDetail>;
    fn update(
        &self,
        user: MacroUserIdStr<'static>,
        id: Uuid,
        input: UpdateInitiativeRequest,
    ) -> ApiFuture<'_, InitiativeDetail>;
    fn delete(&self, user: MacroUserIdStr<'static>, id: Uuid) -> ApiFuture<'_, ()>;
    fn assign(
        &self,
        user: MacroUserIdStr<'static>,
        id: Uuid,
        task_ids: Vec<String>,
    ) -> ApiFuture<'_, AssignTasksResponse>;
    fn unassign(
        &self,
        user: MacroUserIdStr<'static>,
        id: Uuid,
        task_id: String,
    ) -> ApiFuture<'_, ()>;
    fn clear(&self, user: MacroUserIdStr<'static>, task_id: String) -> ApiFuture<'_, ()>;
}

/// Request-scoped initiative capability, shared by viewer reads and mutations.
///
/// Type erasure keeps domain implementation parameters out of the schema's public type.
#[derive(Clone)]
pub struct InitiativeGraphqlContext(pub(crate) Arc<dyn InitiativeApi>);

/// Typed capability-minting boundary shared by all initiative GraphQL operations.
pub trait InitiativeAuthorizer: Send + Sync + 'static {
    /// Verify the authenticated viewer's required capability for an entity.
    fn authorize<T: RequiredPermission>(
        &self,
        user: &MacroUserIdStr<'static>,
        id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<EntityAccessReceipt<T>, AccessError>> + Send;
}

impl<A: EntityAccessService> InitiativeAuthorizer for A {
    async fn authorize<T: RequiredPermission>(
        &self,
        user: &MacroUserIdStr<'static>,
        id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        self.generate_entity_access_receipt::<T>(user, None, id, entity_type)
            .await
    }
}

impl InitiativeGraphqlContext {
    /// Compose the initiative use cases and receipt-minting boundary.
    pub fn new<S: InitiativeService, A: InitiativeAuthorizer>(
        service: Arc<S>,
        access: Arc<A>,
    ) -> Self {
        Self(Arc::new(InitiativeApiAdapter { service, access }))
    }
}

/// Thin inbound bridge from GraphQL identity to domain capabilities.
struct InitiativeApiAdapter<S, A> {
    service: Arc<S>,
    access: Arc<A>,
}

impl<S: InitiativeService, A: InitiativeAuthorizer> InitiativeApi for InitiativeApiAdapter<S, A> {
    fn page(
        &self,
        user: MacroUserIdStr<'static>,
        input: InitiativePageRequest,
    ) -> ApiFuture<'_, InitiativePage> {
        Box::pin(async move { self.service.page(&user, input).await })
    }

    fn summary(&self, user: MacroUserIdStr<'static>, id: Uuid) -> ApiFuture<'_, InitiativePageRow> {
        Box::pin(async move {
            let receipt = self
                .access
                .authorize::<ViewAccessLevel>(&user, &id.to_string(), EntityType::Initiative)
                .await?;
            self.service.summary(receipt).await
        })
    }

    fn get(&self, user: MacroUserIdStr<'static>, id: Uuid) -> ApiFuture<'_, InitiativeDetail> {
        Box::pin(async move {
            let receipt = self
                .access
                .authorize::<ViewAccessLevel>(&user, &id.to_string(), EntityType::Initiative)
                .await?;
            self.service.get(receipt).await
        })
    }

    fn tasks(
        &self,
        user: MacroUserIdStr<'static>,
        id: Uuid,
        input: InitiativeTasksRequest,
    ) -> ApiFuture<'_, InitiativeTasksPage> {
        Box::pin(async move {
            let receipt = self
                .access
                .authorize::<ViewAccessLevel>(&user, &id.to_string(), EntityType::Initiative)
                .await?;
            self.service.tasks_page(receipt, input).await
        })
    }

    fn references(
        &self,
        user: MacroUserIdStr<'static>,
        ids: Vec<String>,
    ) -> ApiFuture<'_, TaskInitiativeReferences> {
        Box::pin(async move {
            self.service
                .task_references(&user, TaskInitiativeReferencesRequest { task_ids: ids })
                .await
        })
    }

    fn create(
        &self,
        user: MacroUserIdStr<'static>,
        input: CreateInitiativeRequest,
    ) -> ApiFuture<'_, InitiativeDetail> {
        Box::pin(async move { self.service.create(&user, input).await })
    }

    fn update(
        &self,
        user: MacroUserIdStr<'static>,
        id: Uuid,
        input: UpdateInitiativeRequest,
    ) -> ApiFuture<'_, InitiativeDetail> {
        Box::pin(async move {
            let receipt = self
                .access
                .authorize::<EditAccessLevel>(&user, &id.to_string(), EntityType::Initiative)
                .await?;
            self.service.update(receipt, input).await
        })
    }

    fn delete(&self, user: MacroUserIdStr<'static>, id: Uuid) -> ApiFuture<'_, ()> {
        Box::pin(async move {
            let receipt = self
                .access
                .authorize::<OwnerAccessLevel>(&user, &id.to_string(), EntityType::Initiative)
                .await?;
            self.service.delete(receipt).await
        })
    }

    fn assign(
        &self,
        user: MacroUserIdStr<'static>,
        id: Uuid,
        task_ids: Vec<String>,
    ) -> ApiFuture<'_, AssignTasksResponse> {
        Box::pin(async move {
            let batch = TaskAssignmentBatch::try_new(task_ids)?;
            let receipt = self
                .access
                .authorize::<EditAccessLevel>(&user, &id.to_string(), EntityType::Initiative)
                .await?;
            let mut tasks = Vec::new();
            for task_id in batch.into_task_ids() {
                let access = self
                    .access
                    .authorize::<EditAccessLevel>(&user, &task_id, EntityType::Document)
                    .await;
                tasks.push(TaskAssignment::from_access(task_id, access)?);
            }
            self.service.assign_tasks(receipt, tasks).await
        })
    }

    fn unassign(
        &self,
        user: MacroUserIdStr<'static>,
        id: Uuid,
        task_id: String,
    ) -> ApiFuture<'_, ()> {
        Box::pin(async move {
            let receipt = self
                .access
                .authorize::<EditAccessLevel>(&user, &id.to_string(), EntityType::Initiative)
                .await?;
            let task_receipt = self
                .access
                .authorize::<EditAccessLevel>(&user, &task_id, EntityType::Document)
                .await?;
            self.service.unassign_task(receipt, task_receipt).await
        })
    }

    fn clear(&self, user: MacroUserIdStr<'static>, task_id: String) -> ApiFuture<'_, ()> {
        Box::pin(async move {
            let task_receipt = self
                .access
                .authorize::<EditAccessLevel>(&user, &task_id, EntityType::Document)
                .await?;
            self.service.clear_task(task_receipt).await
        })
    }
}
