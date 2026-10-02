//! Existing session queue and authorized realtime capabilities.

use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use agent_session::domain::{
    control::ControlPrincipal,
    model::AgentSessionId,
    ports::{AgentSessionNotificationRecipient, AgentSessionRealtime, ControlEvent},
};
use async_trait::async_trait;
use entity_access::domain::{
    models::{EditAccessLevel, EntityType},
    ports::EntityAccessService,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::sync::Arc;
use uuid::Uuid;

use crate::domain::{
    model::{Result, ReviewError, ReviewId},
    ports::{ReviewEvents, ReviewFeedback},
};

/// Adapter to the existing session control boundary; no second conversation loop.
pub struct SessionFeedback<C, A> {
    control: Arc<C>,
    access: Arc<A>,
}

impl<C, A> SessionFeedback<C, A> {
    /// Wire the harness control service and session permission authority.
    pub fn new(control: Arc<C>, access: Arc<A>) -> Self {
        Self { control, access }
    }
}

#[async_trait]
impl<C: AgentSessionNotificationRecipient, A: EntityAccessService> ReviewFeedback
    for SessionFeedback<C, A>
{
    async fn send(
        &self,
        session: AgentSessionId,
        user: &str,
        message: Uuid,
        prompt: String,
    ) -> Result<()> {
        let user = MacroUserIdStr::parse_from_str(user)
            .map_err(|_| ReviewError::Forbidden)?
            .into_owned();
        let receipt = self
            .access
            .generate_entity_access_receipt::<EditAccessLevel>(
                &user,
                None,
                &session.to_string(),
                EntityType::AgentSession,
            )
            .await
            .map_err(|_| ReviewError::Forbidden)?;
        let event = ControlEvent::authorized(
            AgentAction::prompt(prompt),
            Some(AgentActionId::from_uuid(message)),
            ControlPrincipal::User,
            receipt,
        )
        .map_err(|_| ReviewError::Forbidden)?;
        self.control
            .control_event(session, event)
            .await
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        Ok(())
    }
}

/// Use the session's existing audience and connection-gateway notifications.
pub struct SessionReviewEvents<R>(pub R);

#[async_trait]
impl<R: AgentSessionRealtime + Send + Sync + 'static> ReviewEvents for SessionReviewEvents<R> {
    async fn changed(&self, session: AgentSessionId, _: ReviewId) -> Result<()> {
        self.0
            .publish_updated(session)
            .await
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))
    }
}
