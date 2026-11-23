//! Request capabilities supplied by the application composition root.

use std::{future::Future, pin::Pin, sync::Arc};

use entity_access::domain::{
    models::{
        AccessError, EditAccessLevel, EntityAccessReceipt, EntityType, RequiredPermission,
        ViewAccessLevel,
    },
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use time_tracking::domain::{
    models::{
        LoggedTime, NewTimeEntry, StartTimer, StartedTimer, StopTimer, StoppedTimer, TaskTimeTotal,
        TimeEntryChanges, TimeEntryPage, TimeEntryPageRequest, TimeTrackingError, TimerState,
    },
    service::TimeTrackingService,
};
use uuid::Uuid;

/// Why a time tracking request failed: the task's access check, or the domain.
#[derive(Debug)]
pub(crate) enum TimeTrackingFailure {
    Access(AccessError),
    Domain(TimeTrackingError),
}

impl From<AccessError> for TimeTrackingFailure {
    fn from(error: AccessError) -> Self {
        Self::Access(error)
    }
}

impl From<TimeTrackingError> for TimeTrackingFailure {
    fn from(error: TimeTrackingError) -> Self {
        Self::Domain(error)
    }
}

/// Object-safe forwarding future for the request's concrete domain service.
pub(crate) type ApiFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, TimeTrackingFailure>> + Send + 'a>>;

/// Transport-facing service bundle; implementations mint receipts and delegate policy.
pub(crate) trait TimeTrackingApi: Send + Sync {
    fn entries(
        &self,
        user: MacroUserIdStr<'static>,
        task_id: String,
        page: TimeEntryPageRequest,
    ) -> ApiFuture<'_, TimeEntryPage>;
    fn log(
        &self,
        user: MacroUserIdStr<'static>,
        task_id: String,
        entry: NewTimeEntry,
    ) -> ApiFuture<'_, LoggedTime>;
    fn update(
        &self,
        user: MacroUserIdStr<'static>,
        entry_id: Uuid,
        changes: TimeEntryChanges,
    ) -> ApiFuture<'_, LoggedTime>;
    fn delete(&self, user: MacroUserIdStr<'static>, entry_id: Uuid)
    -> ApiFuture<'_, TaskTimeTotal>;
    fn timer(&self, user: MacroUserIdStr<'static>) -> ApiFuture<'_, TimerState>;
    fn start(
        &self,
        user: MacroUserIdStr<'static>,
        task_id: String,
        start: StartTimer,
    ) -> ApiFuture<'_, StartedTimer>;
    fn stop(&self, user: MacroUserIdStr<'static>, stop: StopTimer) -> ApiFuture<'_, StoppedTimer>;
    fn discard(&self, user: MacroUserIdStr<'static>, timer_id: Uuid) -> ApiFuture<'_, ()>;
}

/// Request-scoped time tracking capability, shared by viewer reads and mutations.
///
/// Type erasure keeps domain implementation parameters out of the schema's public type.
#[derive(Clone)]
pub struct TimeTrackingGraphqlContext(pub(crate) Arc<dyn TimeTrackingApi>);

/// Typed capability-minting boundary for the task a request names.
pub trait TimeTrackingAuthorizer: Send + Sync + 'static {
    /// Verify the authenticated viewer's required capability on a task document.
    fn authorize<T: RequiredPermission>(
        &self,
        user: &MacroUserIdStr<'static>,
        task_id: &str,
    ) -> impl Future<Output = Result<EntityAccessReceipt<T>, AccessError>> + Send;
}

impl<A: EntityAccessService> TimeTrackingAuthorizer for A {
    async fn authorize<T: RequiredPermission>(
        &self,
        user: &MacroUserIdStr<'static>,
        task_id: &str,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        self.generate_entity_access_receipt::<T>(user, None, task_id, EntityType::Document)
            .await
    }
}

impl TimeTrackingGraphqlContext {
    /// Compose the time tracking use cases and the receipt-minting boundary.
    pub fn new<S: TimeTrackingService, A: TimeTrackingAuthorizer>(
        service: Arc<S>,
        access: Arc<A>,
    ) -> Self {
        Self(Arc::new(TimeTrackingApiAdapter { service, access }))
    }
}

/// Thin inbound bridge from GraphQL identity to domain capabilities.
struct TimeTrackingApiAdapter<S, A> {
    service: Arc<S>,
    access: Arc<A>,
}

impl<S: TimeTrackingService, A: TimeTrackingAuthorizer> TimeTrackingApi
    for TimeTrackingApiAdapter<S, A>
{
    fn entries(
        &self,
        user: MacroUserIdStr<'static>,
        task_id: String,
        page: TimeEntryPageRequest,
    ) -> ApiFuture<'_, TimeEntryPage> {
        Box::pin(async move {
            let receipt = self
                .access
                .authorize::<ViewAccessLevel>(&user, &task_id)
                .await?;
            Ok(self.service.list_entries(&receipt, page).await?)
        })
    }

    fn log(
        &self,
        user: MacroUserIdStr<'static>,
        task_id: String,
        entry: NewTimeEntry,
    ) -> ApiFuture<'_, LoggedTime> {
        Box::pin(async move {
            let receipt = self
                .access
                .authorize::<EditAccessLevel>(&user, &task_id)
                .await?;
            Ok(self.service.log_entry(&receipt, entry).await?)
        })
    }

    fn update(
        &self,
        user: MacroUserIdStr<'static>,
        entry_id: Uuid,
        changes: TimeEntryChanges,
    ) -> ApiFuture<'_, LoggedTime> {
        Box::pin(async move { Ok(self.service.update_entry(&user, entry_id, changes).await?) })
    }

    fn delete(
        &self,
        user: MacroUserIdStr<'static>,
        entry_id: Uuid,
    ) -> ApiFuture<'_, TaskTimeTotal> {
        Box::pin(async move { Ok(self.service.delete_entry(&user, entry_id).await?) })
    }

    fn timer(&self, user: MacroUserIdStr<'static>) -> ApiFuture<'_, TimerState> {
        Box::pin(async move { Ok(self.service.timer(&user).await?) })
    }

    fn start(
        &self,
        user: MacroUserIdStr<'static>,
        task_id: String,
        start: StartTimer,
    ) -> ApiFuture<'_, StartedTimer> {
        Box::pin(async move {
            let receipt = self
                .access
                .authorize::<EditAccessLevel>(&user, &task_id)
                .await?;
            Ok(self.service.start_timer(&receipt, start).await?)
        })
    }

    fn stop(&self, user: MacroUserIdStr<'static>, stop: StopTimer) -> ApiFuture<'_, StoppedTimer> {
        Box::pin(async move { Ok(self.service.stop_timer(&user, stop).await?) })
    }

    fn discard(&self, user: MacroUserIdStr<'static>, timer_id: Uuid) -> ApiFuture<'_, ()> {
        Box::pin(async move { Ok(self.service.discard_timer(&user, timer_id).await?) })
    }
}
