use std::{future::Future, pin::Pin, sync::Arc};

use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use scheduled_action::domain::{models::ScheduledAction, ports::ScheduledActionReadService};

pub(crate) type ListFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Vec<ScheduledAction>, Report>> + Send + 'a>>;

pub(crate) trait ScheduledActionReader: Send + Sync {
    fn list_owned(&self, user_id: MacroUserIdStr<'static>) -> ListFuture<'_>;
}

/// Type-erased routine reader stored in GraphQL request data.
#[derive(Clone)]
pub struct ScheduledActionGraphqlContext(pub(crate) Arc<dyn ScheduledActionReader>);

impl ScheduledActionGraphqlContext {
    /// Erase `service` so request data does not carry its type parameters.
    pub fn new<S: ScheduledActionReadService>(service: Arc<S>) -> Self {
        Self(Arc::new(ReadServiceAdapter { service }))
    }
}

struct ReadServiceAdapter<S> {
    service: Arc<S>,
}

impl<S: ScheduledActionReadService> ScheduledActionReader for ReadServiceAdapter<S> {
    fn list_owned(&self, user_id: MacroUserIdStr<'static>) -> ListFuture<'_> {
        let service = Arc::clone(&self.service);
        Box::pin(async move { service.list_owned(user_id).await })
    }
}
