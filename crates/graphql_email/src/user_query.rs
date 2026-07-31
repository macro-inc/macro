use std::sync::Arc;

use async_graphql::Object;
use email::domain::ports::EmailUserService;
use macro_user_id::user_id::MacroUserIdStr;

use crate::user_objects::{GraphqlEmailLabel, GraphqlEmailLink};

#[cfg(test)]
mod test;

/// Flattenable GraphQL fields for authenticated user email catalogs.
pub struct GraphqlEmailQuery<S> {
    /// Email domain service supplied by the composition root.
    service: Arc<S>,
    /// Authenticated user whose catalogs may be loaded.
    user_id: MacroUserIdStr<'static>,
}

impl<S> Clone for GraphqlEmailQuery<S> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            user_id: self.user_id.clone(),
        }
    }
}

impl<S> GraphqlEmailQuery<S> {
    /// Create user-scoped email query fields from the authenticated identity and
    /// the application's email domain service.
    pub fn new(service: Arc<S>, user_id: MacroUserIdStr<'static>) -> Self {
        Self { service, user_id }
    }
}

/// Authenticated user email catalog fields.
#[Object]
impl<S> GraphqlEmailQuery<S>
where
    S: EmailUserService,
{
    /// Labels across every owned or delegated inbox accessible to the authenticated user.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn email_labels(&self) -> async_graphql::Result<Vec<GraphqlEmailLabel>> {
        self.service
            .get_user_email_labels(self.user_id.clone())
            .await
            .map(|labels| labels.into_iter().map(Into::into).collect())
            .map_err(|error| {
                tracing::error!(
                    error = ?error,
                    user_id = %self.user_id,
                    "failed to load authenticated user's email labels"
                );
                async_graphql::Error::new("email labels are unavailable")
            })
    }

    /// Enriched owned or delegated email links accessible to the authenticated user.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn email_links(&self) -> async_graphql::Result<Vec<GraphqlEmailLink>> {
        self.service
            .get_user_email_links(self.user_id.clone())
            .await
            .map(|links| links.into_iter().map(Into::into).collect())
            .map_err(|error| {
                tracing::error!(
                    error = ?error,
                    user_id = %self.user_id,
                    "failed to load authenticated user's email links"
                );
                async_graphql::Error::new("email links are unavailable")
            })
    }
}
