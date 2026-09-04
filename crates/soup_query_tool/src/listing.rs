//! The resolver's listing port and its production implementation.
//!
//! Policy lives in [`soup::domain::agent_listing`]; this file only carries the
//! services and request identity into that use case so the GraphQL resolver
//! can be exercised against a fake.

use std::sync::Arc;

use async_trait::async_trait;
use email::domain::ports::EmailService;
use macro_user_id::user_id::MacroUserIdStr;
use soup::domain::agent_listing::{
    AgentListingError, AgentListingPage, AgentListingRequest, list_for_agent,
};
use soup::domain::ports::SoupService;
use uuid::Uuid;

/// The single listing port the resolver sees.
#[async_trait]
pub(crate) trait SoupLister: Send + Sync {
    async fn list(
        &self,
        request: AgentListingRequest,
    ) -> Result<AgentListingPage, AgentListingError>;
}

/// Production lister: the domain use case bound to one request's identity.
pub(crate) struct SoupListing<S: SoupService, E: EmailService> {
    soup: Arc<S>,
    email: Arc<E>,
    user: MacroUserIdStr<'static>,
    self_chat_id: Option<Uuid>,
}

impl<S: SoupService, E: EmailService> SoupListing<S, E> {
    pub(crate) fn new(
        soup: Arc<S>,
        email: Arc<E>,
        user: MacroUserIdStr<'static>,
        self_chat_id: Option<Uuid>,
    ) -> Self {
        Self {
            soup,
            email,
            user,
            self_chat_id,
        }
    }
}

#[async_trait]
impl<S: SoupService, E: EmailService> SoupLister for SoupListing<S, E> {
    #[tracing::instrument(skip_all, err)]
    async fn list(
        &self,
        request: AgentListingRequest,
    ) -> Result<AgentListingPage, AgentListingError> {
        list_for_agent(
            &*self.soup,
            &*self.email,
            self.user.clone(),
            self.self_chat_id,
            request,
        )
        .await
    }
}
