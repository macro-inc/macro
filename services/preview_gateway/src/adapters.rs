//! Composition-root adapters to existing Macro session, permission and realtime services.
use agent_egress::domain::model::SessionToken;
use agent_preview::domain::{
    AgentIdentity, Preview, PreviewError,
    ports::{Authority, Events},
};
use agent_session::domain::{
    model::{AgentSession, AgentSessionId},
    ports::AgentSessionRepo,
};
use async_trait::async_trait;
use entity_access::domain::{
    models::{EntityType, ViewAccessLevel},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

pub struct MacroAuthority<Repo, Access> {
    pub sessions: Repo,
    pub access: Arc<Access>,
}
impl<Repo: AgentSessionRepo, Access> MacroAuthority<Repo, Access> {
    async fn session(&self, session: AgentSessionId) -> Result<AgentSession, PreviewError> {
        self.sessions
            .get(session)
            .await
            .map_err(|_| PreviewError::Denied)
    }
}
#[async_trait]
impl<Repo: AgentSessionRepo, Access: EntityAccessService> Authority
    for MacroAuthority<Repo, Access>
{
    async fn agent(&self, token: &str) -> Result<AgentIdentity, PreviewError> {
        let token = SessionToken::new(token);
        let session =
            agent_session::domain::credentials::authenticate_session(&self.sessions, &token.hash())
                .await
                .map_err(|_| PreviewError::Denied)?;
        Ok(AgentIdentity {
            session: session.id,
            owner: session.owner_id,
        })
    }
    async fn viewer(
        &self,
        session: AgentSessionId,
        user: &MacroUserIdStr<'_>,
    ) -> Result<(), PreviewError> {
        self.access
            .generate_entity_access_receipt::<ViewAccessLevel>(
                user,
                None,
                &session.to_string(),
                EntityType::AgentSession,
            )
            .await
            .map_err(|_| PreviewError::Denied)?;
        self.active(session).await
    }
    async fn active(&self, session: AgentSessionId) -> Result<(), PreviewError> {
        // Runtime disconnection is transient (Cursor deliberately detaches idle ACP pipes).
        // Deletion revokes the capability; explicit preview stop and SSH closure end the lease.
        self.session(session).await.map(|_| ())
    }
}

pub struct Realtime(pub connection_gateway_client::ConnectionGatewayClient);
#[async_trait]
impl Events for Realtime {
    async fn changed(
        &self,
        preview: &Preview,
        viewers: &[MacroUserIdStr<'static>],
    ) -> Result<(), PreviewError> {
        if viewers.is_empty() {
            return Ok(());
        }
        // Invalidation rather than a snapshot: a reconnect/read cannot overwrite newer state.
        self.0
            .batch_send_message(
                "agent_session_preview".into(),
                serde_json::json!({"agentSessionId": preview.agent_session_id}),
                viewers
                    .iter()
                    .map(|user| model_entity::EntityType::User.with_entity_str(user.as_ref()))
                    .collect(),
            )
            .await
            .map(|_| ())
            .map_err(|_| PreviewError::Unavailable)
    }
}

#[cfg(test)]
mod test;
