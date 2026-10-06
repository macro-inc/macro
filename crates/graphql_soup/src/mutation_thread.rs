//! Read-after-write email snapshots, separate from replica-backed Soup lists.

use std::{future::Future, pin::Pin, sync::Arc};

use email::domain::{
    models::{GetEmailsRequest, PreviewView, PreviewViewStandardLabel},
    ports::EmailService,
};
use filter_ast::Expr;
use item_filters::ast::email::EmailLiteral;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{Query, SimpleSortMethod};
use models_soup::email_thread::SoupEnrichedEmailThreadPreview;
use uuid::Uuid;

/// A fresh, user-scoped snapshot from the same service that performs writes.
/// Implementations must not serve a cached or replica-backed mutation reply.
pub trait EmailMutationThreadReader: Send + Sync + 'static {
    /// Reload the thread after its mutation has committed.
    fn read(
        &self,
        user_id: MacroUserIdStr<'static>,
        thread_id: Uuid,
    ) -> impl Future<Output = async_graphql::Result<Option<SoupEnrichedEmailThreadPreview<()>>>> + Send;
}

/// Owned future for one uncached mutation snapshot.
type ReadFuture = Pin<
    Box<
        dyn Future<Output = async_graphql::Result<Option<SoupEnrichedEmailThreadPreview<()>>>>
            + Send,
    >,
>;
/// Type-erased request-scoped reader function.
type ReadThread = dyn Fn(MacroUserIdStr<'static>, Uuid) -> ReadFuture + Send + Sync;

/// Mutation-only reader stored in request data; deliberately never caches.
#[derive(Clone)]
pub struct EmailMutationThreadLoader(Arc<ReadThread>);

impl EmailMutationThreadLoader {
    /// Bind a primary-backed reader, independently of the ordinary Soup loader.
    pub fn new(reader: impl EmailMutationThreadReader) -> Self {
        let reader = Arc::new(reader);
        Self(Arc::new(move |user_id, thread_id| {
            let reader = Arc::clone(&reader);
            Box::pin(async move { reader.read(user_id, thread_id).await })
        }))
    }

    /// Load a fresh snapshot on every call, including sequential mutations.
    pub async fn read(
        &self,
        user_id: MacroUserIdStr<'static>,
        thread_id: Uuid,
    ) -> async_graphql::Result<Option<SoupEnrichedEmailThreadPreview<()>>> {
        (self.0)(user_id, thread_id).await
    }
}

/// Adapter over the email writer's primary-backed domain service.
struct PrimaryEmailReader<E>(Arc<E>);

impl<E: EmailService> EmailMutationThreadReader for PrimaryEmailReader<E> {
    async fn read(
        &self,
        user_id: MacroUserIdStr<'static>,
        thread_id: Uuid,
    ) -> async_graphql::Result<Option<SoupEnrichedEmailThreadPreview<()>>> {
        // Ownership/delegation remains the email service's policy. Never load
        // an arbitrary thread by ID through a repository at this boundary.
        let Some(link) = self
            .0
            .get_owned_link_for_thread(user_id.clone(), thread_id)
            .await?
        else {
            return Ok(None);
        };
        let page = self
            .0
            .get_email_thread_previews(GetEmailsRequest {
                view: PreviewView::StandardLabel(PreviewViewStandardLabel::All),
                link_ids: vec![link.id],
                macro_id: user_id,
                limit: Some(1),
                query: Query::Sort(
                    SimpleSortMethod::UpdatedAt,
                    Some(Arc::new(Expr::val(EmailLiteral::ThreadId(thread_id)))),
                ),
                include_frecency: false,
                team_receipt: None,
                crm_scope: None,
            })
            .await?;
        Ok(page.items.into_iter().next().map(Into::into))
    }
}

/// Build mutation replies from the primary email service, not the Soup reader.
pub fn email_mutation_thread_loader<E: EmailService>(service: Arc<E>) -> EmailMutationThreadLoader {
    EmailMutationThreadLoader::new(PrimaryEmailReader(service))
}
