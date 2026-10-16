use std::{future::Future, pin::Pin, sync::Arc};

use calendar_events::domain::{
    changes::{CalendarChangeQueryService, CalendarEventChange},
    meeting_links::CreateEventWithMacroCallError,
    models::{AttendeeResponseStatus, CalendarEvent, CalendarEventDraft, CalendarEventPatch},
    ports::{
        CalendarDeletionScope, CalendarMacroCallService, CalendarMutationError,
        CalendarMutationService, CalendarRsvpScope, CalendarUpdateScope,
    },
};
use uuid::Uuid;

use crate::reads::ReadFuture;

pub(crate) type WriteFuture<'a, T, E = CalendarMutationError> =
    Pin<Box<dyn Future<Output = Result<T, E>> + Send + 'a>>;

/// Object-safe view of the calendar mutation service and the primary-pool
/// read that answers each mutation with the event's committed state.
pub(crate) trait CalendarGraphqlWrites: Send + Sync {
    fn create_event(
        &self,
        viewer: String,
        email_link_id: Option<Uuid>,
        calendar_id: Option<Uuid>,
        draft: CalendarEventDraft,
    ) -> WriteFuture<'_, CalendarEvent>;

    fn create_event_with_macro_call(
        &self,
        viewer: String,
        email_link_id: Option<Uuid>,
        calendar_id: Option<Uuid>,
        draft: CalendarEventDraft,
    ) -> WriteFuture<'_, CalendarEvent, CreateEventWithMacroCallError>;

    fn update_event(
        &self,
        viewer: String,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
        patch: CalendarEventPatch,
        scope: CalendarUpdateScope,
    ) -> WriteFuture<'_, CalendarEvent>;

    fn delete_event(
        &self,
        viewer: String,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
        scope: CalendarDeletionScope,
    ) -> WriteFuture<'_, ()>;

    fn respond_to_event(
        &self,
        viewer: String,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
        response: AttendeeResponseStatus,
        scope: CalendarRsvpScope,
        responding_email: Option<String>,
    ) -> WriteFuture<'_, CalendarEvent>;

    fn event_change(
        &self,
        viewer: String,
        event_id: Uuid,
    ) -> ReadFuture<'_, Option<CalendarEventChange>>;
}

/// Type-erased calendar mutation service stored in GraphQL request data.
#[derive(Clone)]
pub struct CalendarGraphqlMutationContext {
    pub(crate) writes: Arc<dyn CalendarGraphqlWrites>,
}

impl CalendarGraphqlMutationContext {
    /// Erase `mutations`, which performs provider writes, and
    /// `committed_changes`, which must read the primary database so each
    /// mutation answers with the state its write committed.
    pub fn new<M, C>(mutations: Arc<M>, committed_changes: Arc<C>) -> Self
    where
        M: CalendarMutationService + CalendarMacroCallService,
        C: CalendarChangeQueryService,
    {
        Self {
            writes: Arc::new(ServiceWrites {
                mutations,
                committed_changes,
            }),
        }
    }
}

struct ServiceWrites<M, C> {
    mutations: Arc<M>,
    committed_changes: Arc<C>,
}

impl<M, C> CalendarGraphqlWrites for ServiceWrites<M, C>
where
    M: CalendarMutationService + CalendarMacroCallService,
    C: CalendarChangeQueryService,
{
    fn create_event(
        &self,
        viewer: String,
        email_link_id: Option<Uuid>,
        calendar_id: Option<Uuid>,
        draft: CalendarEventDraft,
    ) -> WriteFuture<'_, CalendarEvent> {
        Box::pin(async move {
            self.mutations
                .create_event(&viewer, email_link_id, calendar_id, draft)
                .await
        })
    }

    fn create_event_with_macro_call(
        &self,
        viewer: String,
        email_link_id: Option<Uuid>,
        calendar_id: Option<Uuid>,
        draft: CalendarEventDraft,
    ) -> WriteFuture<'_, CalendarEvent, CreateEventWithMacroCallError> {
        Box::pin(async move {
            self.mutations
                .create_event_with_macro_call(&viewer, email_link_id, calendar_id, draft)
                .await
        })
    }

    fn update_event(
        &self,
        viewer: String,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
        patch: CalendarEventPatch,
        scope: CalendarUpdateScope,
    ) -> WriteFuture<'_, CalendarEvent> {
        Box::pin(async move {
            self.mutations
                .update_event(&viewer, event_id, calendar_id, patch, scope)
                .await
        })
    }

    fn delete_event(
        &self,
        viewer: String,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
        scope: CalendarDeletionScope,
    ) -> WriteFuture<'_, ()> {
        Box::pin(async move {
            self.mutations
                .delete_event(&viewer, event_id, calendar_id, scope)
                .await
        })
    }

    fn respond_to_event(
        &self,
        viewer: String,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
        response: AttendeeResponseStatus,
        scope: CalendarRsvpScope,
        responding_email: Option<String>,
    ) -> WriteFuture<'_, CalendarEvent> {
        Box::pin(async move {
            self.mutations
                .respond_to_event(
                    &viewer,
                    event_id,
                    calendar_id,
                    response,
                    scope,
                    responding_email,
                )
                .await
        })
    }

    fn event_change(
        &self,
        viewer: String,
        event_id: Uuid,
    ) -> ReadFuture<'_, Option<CalendarEventChange>> {
        Box::pin(async move { self.committed_changes.event_change(&viewer, event_id).await })
    }
}
