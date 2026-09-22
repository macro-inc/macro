//! Composition-root bridge between voice policy and the owning session service.

use crate::config::Config;
use agent_harness::domain::model::AgentKind;
use agent_session::domain::{model::AgentSessionId, service::AgentSessionService};
use agent_voice::{
    domain::{
        model::{Result, VoiceError},
        ports::{AgentVoiceDirectory, VoiceMedia},
        service::AgentVoiceService,
    },
    outbound::{livekit::LivekitVoiceMedia, redis::RedisVoiceLeaseStore},
};
use macro_uuid::Uuid;
use std::sync::Arc;

struct SessionDirectory<Sessions>(Sessions);

#[async_trait::async_trait]
impl<Sessions: AgentSessionService> AgentVoiceDirectory for SessionDirectory<Sessions> {
    async fn is_macro_session(&self, session: Uuid) -> Result<bool> {
        let row = self
            .0
            .get_session(AgentSessionId::new_from_uuid(session))
            .await
            .map_err(|error| VoiceError::Infrastructure(rootcause::report!(error).into()))?;
        Ok(AgentKind::for_session(row.bot_id, &row.harness) == AgentKind::InMemory)
    }
}

/// Build the optional media adapter while keeping routes consistently available.
pub fn service<Sessions: AgentSessionService>(
    sessions: Sessions,
    redis: redis::Client,
    config: &Config,
) -> anyhow::Result<AgentVoiceService> {
    let media: Option<Arc<dyn VoiceMedia>> = if config.agent_voice_enabled {
        Some(Arc::new(LivekitVoiceMedia::new(
            &config.livekit_server_url,
            config.livekit_api_key.clone(),
            config.livekit_api_secret.clone(),
        )?))
    } else {
        tracing::info!("agent voice is disabled");
        None
    };
    Ok(AgentVoiceService::new(
        Arc::new(SessionDirectory(sessions)),
        Arc::new(RedisVoiceLeaseStore::new(redis)),
        media,
    ))
}
