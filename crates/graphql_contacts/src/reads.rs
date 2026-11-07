use contacts::domain::{
    models::{
        contact::ContactPage,
        page::{ContactCursor, ContactPageSize},
    },
    ports::ContactDirectory,
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::{future::Future, pin::Pin, sync::Arc};

type ReadFuture<'a> = Pin<Box<dyn Future<Output = Result<ContactPage, Report>> + Send + 'a>>;

pub(crate) trait ContactsGraphqlReads: Send + Sync {
    fn page(
        &self,
        viewer: MacroUserIdStr<'static>,
        after: Option<ContactCursor>,
        limit: ContactPageSize,
    ) -> ReadFuture<'_>;
}

/// Request-scoped, type-erased access to the directory domain service.
#[derive(Clone)]
pub struct ContactsGraphqlContext {
    pub(crate) reads: Arc<dyn ContactsGraphqlReads>,
}

impl ContactsGraphqlContext {
    /// Compose the domain reader without adding schema type parameters.
    pub fn new<S: ContactDirectory>(service: Arc<S>) -> Self {
        Self {
            reads: Arc::new(ServiceReads(service)),
        }
    }
}

struct ServiceReads<S>(Arc<S>);
impl<S: ContactDirectory> ContactsGraphqlReads for ServiceReads<S> {
    fn page(
        &self,
        viewer: MacroUserIdStr<'static>,
        after: Option<ContactCursor>,
        limit: ContactPageSize,
    ) -> ReadFuture<'_> {
        Box::pin(async move { self.0.contact_page(viewer, after.as_ref(), limit).await })
    }
}
