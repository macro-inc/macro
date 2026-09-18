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
use macro_uuid::Uuid;
use std::sync::Arc;

pub struct MacroAuthority<Repo, Access> {
    pub sessions: Repo,
    pub access: Arc<Access>,
}
impl<Repo: AgentSessionRepo, Access> MacroAuthority<Repo, Access> {
    async fn session(&self, session: &str) -> Result<AgentSession, PreviewError> {
        let id = AgentSessionId::new_from_uuid(
            session.parse::<Uuid>().map_err(|_| PreviewError::Denied)?,
        );
        self.sessions
            .get(id)
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
            session: session.id.to_string(),
            owner: session.owner_id.to_string(),
        })
    }
    async fn viewer(&self, session: &str, user: &str) -> Result<(), PreviewError> {
        let user = MacroUserIdStr::parse_from_str(user).map_err(|_| PreviewError::Denied)?;
        self.access
            .generate_entity_access_receipt::<ViewAccessLevel>(
                &user,
                None,
                session,
                EntityType::AgentSession,
            )
            .await
            .map_err(|_| PreviewError::Denied)?;
        self.active(session).await
    }
    async fn active(&self, session: &str) -> Result<(), PreviewError> {
        // Runtime disconnection is transient (Cursor deliberately detaches idle ACP pipes).
        // Deletion revokes the capability; explicit preview stop and SSH closure end the lease.
        self.session(session).await.map(|_| ())
    }
}

pub struct Realtime(pub connection_gateway_client::ConnectionGatewayClient);
#[async_trait]
impl Events for Realtime {
    async fn changed(&self, preview: &Preview, viewers: &[String]) -> Result<(), PreviewError> {
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
                    .map(|user| model_entity::EntityType::User.with_entity_str(user))
                    .collect(),
            )
            .await
            .map(|_| ())
            .map_err(|_| PreviewError::Unavailable)
    }
}

#[cfg(test)]
mod test;
