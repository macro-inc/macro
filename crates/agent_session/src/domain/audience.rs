//! Select stream recipients using current session access, including document inheritance.

use super::{model::AgentSessionId, ports::AgentSessionRepo};
use entity_access::domain::{
    models::{AccessError, EntityType, ViewAccessLevel},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::models::MessageParent;
use std::collections::HashSet;

/// Users tracking a session or a parent that renders its response chip.
pub trait SessionSubscriptions: Send + Sync + 'static {
    /// Subscription candidates are never authorization evidence.
    fn candidates(
        &self,
        id: AgentSessionId,
        parent: Option<&MessageParent>,
    ) -> impl Future<Output = Result<HashSet<String>, rootcause::Report>> + Send;
}

/// Authorized users who may receive session frames.
pub trait SessionAudience: Send + Sync + 'static {
    /// Select current viewers of a session.
    fn viewers(
        &self,
        id: AgentSessionId,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, rootcause::Report>> + Send;
}

/// Includes the owner and currently authorized viewers watching either surface.
#[derive(Clone)]
pub struct AuthorizedSessionAudience<Repo, Access, Subscriptions> {
    repo: Repo,
    access: Access,
    subscriptions: Subscriptions,
}
impl<Repo, Access, Subscriptions> AuthorizedSessionAudience<Repo, Access, Subscriptions> {
    /// Compose persisted session facts, access capabilities, and subscriptions.
    pub fn new(repo: Repo, access: Access, subscriptions: Subscriptions) -> Self {
        Self {
            repo,
            access,
            subscriptions,
        }
    }
}
impl<Repo: AgentSessionRepo, Access: EntityAccessService, Subscriptions: SessionSubscriptions>
    SessionAudience for AuthorizedSessionAudience<Repo, Access, Subscriptions>
{
    async fn viewers(
        &self,
        id: AgentSessionId,
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        let session = self
            .repo
            .get(id)
            .await
            .map_err(|error| rootcause::report!(error))?;
        let mut candidates = self
            .subscriptions
            .candidates(id, session.thread_parent.as_ref())
            .await?;
        candidates.insert(session.owner_id.to_string());
        let mut viewers = Vec::new();
        for candidate in candidates {
            let Ok(user) = MacroUserIdStr::try_from(candidate) else {
                continue;
            };
            match self
                .access
                .generate_entity_access_receipt::<ViewAccessLevel>(
                    &user,
                    None,
                    &id.to_string(),
                    EntityType::AgentSession,
                )
                .await
            {
                Ok(_) => viewers.push(user),
                Err(
                    AccessError::Unauthorized
                    | AccessError::NotFound(_)
                    | AccessError::BadRequest(_),
                ) => {}
                Err(error) => return Err(rootcause::report!(error).into()),
            }
        }
        Ok(viewers)
    }
}
