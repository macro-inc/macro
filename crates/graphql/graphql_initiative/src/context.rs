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
    models::{CreateInitiativeRequest, InitiativeDetail, InitiativeError, UpdateInitiativeRequest},
    ports::InitiativeService,
    reads::{InitiativePageRow, InitiativeRead, InitiativeTasksPage, InitiativeTasksRequest},
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Object-safe forwarding future for the request's concrete domain services.
pub(crate) type ApiFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, InitiativeError>> + Send + 'a>>;

/// Transport-facing service bundle; implementations mint receipts and delegate policy.
pub(crate) trait InitiativeApi: Send + Sync {
    fn read(&self, user: MacroUserIdStr<'static>, id: Uuid) -> ApiFuture<'_, InitiativeRead>;
    fn summarize<'a>(&'a self, read: &'a InitiativeRead) -> ApiFuture<'a, InitiativePageRow>;
    fn ensure_description_surface(
        &self,
        user: MacroUserIdStr<'static>,
        id: Uuid,
    ) -> ApiFuture<'_, ()>;
    fn tasks(
        &self,
        user: MacroUserIdStr<'static>,
        id: Uuid,
        input: InitiativeTasksRequest,
    ) -> ApiFuture<'_, InitiativeTasksPage>;
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
    fn read(&self, user: MacroUserIdStr<'static>, id: Uuid) -> ApiFuture<'_, InitiativeRead> {
        Box::pin(async move {
            let receipt = self
                .access
                .authorize::<ViewAccessLevel>(&user, &id.to_string(), EntityType::Initiative)
                .await?;
            self.service.read(receipt).await
        })
    }

    fn summarize<'a>(&'a self, read: &'a InitiativeRead) -> ApiFuture<'a, InitiativePageRow> {
        Box::pin(self.service.summarize(read))
    }

    fn ensure_description_surface(
        &self,
        user: MacroUserIdStr<'static>,
        id: Uuid,
    ) -> ApiFuture<'_, ()> {
        Box::pin(async move {
            let receipt = self
                .access
                .authorize::<ViewAccessLevel>(&user, &id.to_string(), EntityType::Initiative)
                .await?;
            self.service.ensure_description_surface(receipt).await
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
}
