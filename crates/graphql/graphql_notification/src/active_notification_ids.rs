use std::{future::Future, pin::Pin, sync::Arc};

use async_graphql::{Context, ErrorExtensions, ID};
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::active_notification_ids::{
    ActiveNotificationIdRepository, ActiveNotificationIdService, ActiveNotificationIdStorageError,
    ActiveNotificationIdsError,
};
use uuid::Uuid;

/// Future returned by the type-erased active notification id reader.
type ListFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Vec<Uuid>, ActiveNotificationIdsError>> + Send + 'a>>;

/// Object-safe view of the active notification id service, so request data
/// does not carry its repository type.
trait ActiveNotificationIdReader: Send + Sync {
    /// Read the ids through the domain service.
    fn list(
        &self,
        user: MacroUserIdStr<'static>,
        event_types: Vec<String>,
        limit: Option<u32>,
    ) -> ListFuture<'_>;
}

impl<R: ActiveNotificationIdRepository> ActiveNotificationIdReader
    for ActiveNotificationIdService<R>
{
    fn list(
        &self,
        user: MacroUserIdStr<'static>,
        event_types: Vec<String>,
        limit: Option<u32>,
    ) -> ListFuture<'_> {
        Box::pin(ActiveNotificationIdService::list(
            self,
            user,
            event_types,
            limit,
        ))
    }
}

/// Type-erased active notification id service stored in GraphQL request data.
#[derive(Clone)]
pub struct ActiveNotificationIdsGraphqlContext {
    /// The erased domain service.
    reader: Arc<dyn ActiveNotificationIdReader>,
}

impl ActiveNotificationIdsGraphqlContext {
    /// Erase `service` so request data does not carry its type parameters.
    pub fn new<R: ActiveNotificationIdRepository + 'static>(
        service: ActiveNotificationIdService<R>,
    ) -> Self {
        Self {
            reader: Arc::new(service),
        }
    }
}

/// The ids of `user_id`'s active notifications of `event_types`, newest first.
#[tracing::instrument(skip_all)]
pub async fn resolve_active_notification_ids(
    ctx: &Context<'_>,
    user_id: MacroUserIdStr<'static>,
    event_types: Vec<String>,
    limit: Option<i32>,
) -> async_graphql::Result<Vec<ID>> {
    let limit = limit
        .map(u32::try_from)
        .transpose()
        .map_err(|_| graphql_error(ActiveNotificationIdsError::InvalidLimit))?;
    let ids = ctx
        .data::<ActiveNotificationIdsGraphqlContext>()?
        .reader
        .list(user_id, event_types, limit)
        .await
        .map_err(graphql_error)?;
    Ok(ids.into_iter().map(|id| ID(id.to_string())).collect())
}

/// Map a domain rejection to bad input and a storage failure, which the
/// domain service has already logged, to a generic error. A timeout is marked
/// so clients can tell it apart without a message to parse.
fn graphql_error(error: ActiveNotificationIdsError) -> async_graphql::Error {
    let ActiveNotificationIdsError::Storage(failure) = error else {
        return async_graphql::Error::new(error.to_string()).extend_with(|_, extensions| {
            extensions.set("code", "BAD_USER_INPUT");
        });
    };
    let timed_out = matches!(failure, ActiveNotificationIdStorageError::TimedOut);
    async_graphql::Error::new("notifications are unavailable").extend_with(|_, extensions| {
        extensions.set("code", "INTERNAL_SERVER_ERROR");
        if timed_out {
            extensions.set("timedOut", true);
        }
    })
}
