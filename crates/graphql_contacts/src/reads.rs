use contacts::domain::{
    models::{
        contact::{Contact, ContactPage},
        page::{ContactCursor, ContactPageSize},
        people::{NamedPeopleQuery, PeopleSearchLimit},
        query::{ContactLookup, ContactSearch},
    },
    ports::{ContactDirectory, PeopleNamingService},
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::{future::Future, pin::Pin, sync::Arc};

type ReadFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, Report>> + Send + 'a>>;

pub(crate) trait ContactsGraphqlReads: Send + Sync {
    fn page(
        &self,
        viewer: MacroUserIdStr<'static>,
        after: Option<ContactCursor>,
        limit: ContactPageSize,
    ) -> ReadFuture<'_, ContactPage>;
    fn search(
        &self,
        viewer: MacroUserIdStr<'static>,
        search: ContactSearch,
        after: Option<ContactCursor>,
        limit: ContactPageSize,
    ) -> ReadFuture<'_, ContactPage>;
    fn lookup(
        &self,
        viewer: MacroUserIdStr<'static>,
        lookup: ContactLookup,
    ) -> ReadFuture<'_, Vec<Contact>>;
    fn named(
        &self,
        viewer: MacroUserIdStr<'static>,
        query: NamedPeopleQuery,
        limit: PeopleSearchLimit,
    ) -> ReadFuture<'_, Vec<Contact>>;
}

/// Request-scoped, type-erased access to the directory domain service.
#[derive(Clone)]
pub struct ContactsGraphqlContext {
    pub(crate) reads: Arc<dyn ContactsGraphqlReads>,
}

impl ContactsGraphqlContext {
    /// Compose the domain readers without adding schema type parameters.
    pub fn new<S: ContactDirectory, P: PeopleNamingService>(
        directory: Arc<S>,
        people: Arc<P>,
    ) -> Self {
        Self {
            reads: Arc::new(ServiceReads { directory, people }),
        }
    }
}

struct ServiceReads<S, P> {
    directory: Arc<S>,
    people: Arc<P>,
}
impl<S: ContactDirectory, P: PeopleNamingService> ContactsGraphqlReads for ServiceReads<S, P> {
    fn page(
        &self,
        viewer: MacroUserIdStr<'static>,
        after: Option<ContactCursor>,
        limit: ContactPageSize,
    ) -> ReadFuture<'_, ContactPage> {
        Box::pin(async move {
            self.directory
                .contact_page(viewer, after.as_ref(), limit)
                .await
        })
    }
    fn search(
        &self,
        viewer: MacroUserIdStr<'static>,
        search: ContactSearch,
        after: Option<ContactCursor>,
        limit: ContactPageSize,
    ) -> ReadFuture<'_, ContactPage> {
        Box::pin(async move {
            self.directory
                .search_contacts(viewer, &search, after.as_ref(), limit)
                .await
        })
    }
    fn lookup(
        &self,
        viewer: MacroUserIdStr<'static>,
        lookup: ContactLookup,
    ) -> ReadFuture<'_, Vec<Contact>> {
        Box::pin(async move { self.directory.lookup_contacts(viewer, &lookup).await })
    }
    fn named(
        &self,
        viewer: MacroUserIdStr<'static>,
        query: NamedPeopleQuery,
        limit: PeopleSearchLimit,
    ) -> ReadFuture<'_, Vec<Contact>> {
        Box::pin(async move {
            let people = self.people.people_named(viewer, &query, limit).await?;
            Ok(people.into_iter().map(|person| person.contact).collect())
        })
    }
}
