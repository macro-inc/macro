//! GraphQL read adapter for the authenticated viewer's normal contacts.

use std::{future::Future, pin::Pin, sync::Arc};

use async_graphql::{Context, ErrorExtensions, ID};
use contacts::domain::ports::ContactsService;
use macro_user_id::user_id::MacroUserIdStr;

/// Object-safe adapter for the contacts domain service.
trait ContactsReader: Send + Sync {
    /// Read the complete contact graph for the authenticated viewer.
    fn contacts(
        &self,
        viewer: MacroUserIdStr<'static>,
    ) -> Pin<Box<dyn Future<Output = async_graphql::Result<Vec<ID>>> + Send + '_>>;
}

impl<S: ContactsService> ContactsReader for S {
    fn contacts(
        &self,
        viewer: MacroUserIdStr<'static>,
    ) -> Pin<Box<dyn Future<Output = async_graphql::Result<Vec<ID>>> + Send + '_>> {
        Box::pin(async move {
            self.query_contacts(viewer)
                .await
                .map(|contacts| {
                    contacts
                        .into_iter()
                        .map(|contact| ID(contact.to_string()))
                        .collect()
                })
                .map_err(|error| {
                    tracing::error!(error = ?error, "failed to query contacts");
                    async_graphql::Error::new("Contacts are unavailable")
                        .extend_with(|_, extensions| extensions.set("code", "INTERNAL"))
                })
        })
    }
}

/// Contacts domain service stored in GraphQL request data.
#[derive(Clone)]
pub struct ContactsGraphqlContext {
    /// Type-erased domain reader; persistence and contact membership remain domain-owned.
    reader: Arc<dyn ContactsReader>,
}

impl ContactsGraphqlContext {
    /// Share the existing contacts domain service without adding schema type parameters.
    pub fn new<S: ContactsService>(service: Arc<S>) -> Self {
        Self { reader: service }
    }
}

/// Resolve the complete contact-ID catalog, including the viewer, through its domain service.
#[tracing::instrument(
    name = "contacts.graphql_list",
    skip_all,
    fields(contact_count),
    err(Debug)
)]
pub(crate) async fn resolve_contacts(
    ctx: &Context<'_>,
    viewer: MacroUserIdStr<'static>,
) -> async_graphql::Result<Vec<ID>> {
    let contacts = ctx
        .data::<ContactsGraphqlContext>()?
        .reader
        .contacts(viewer)
        .await?;
    tracing::Span::current().record("contact_count", contacts.len());
    Ok(contacts)
}
