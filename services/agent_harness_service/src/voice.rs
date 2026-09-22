//! Composition-root bridge between voice policy and the owning session service.

use crate::config::{Config, Environment};
use agent_harness::domain::model::AgentKind;
use agent_session::domain::{model::AgentSessionId, service::AgentSessionService};
use agent_voice::{
    domain::{
        model::{Result, VoiceError},
        ports::{AgentVoiceDirectory, VoiceRuntime},
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

/// Build the required media adapter and validate its configuration at startup.
pub fn service<Sessions: AgentSessionService>(
    sessions: Sessions,
    redis: redis::Client,
    config: &Config,
    runtime: Arc<dyn VoiceRuntime>,
) -> anyhow::Result<AgentVoiceService> {
    let media = Arc::new(LivekitVoiceMedia::new(
        &config.livekit_server_url,
        config.livekit_api_key.clone(),
        config.livekit_api_secret.clone(),
        &macro_service_urls::AgentHarnessServiceUrl::new()?.to_string(),
        worker_name(config.environment, config.compose_project_name.value()),
    )?);
    Ok(AgentVoiceService::new(
        Arc::new(SessionDirectory(sessions)),
        Arc::new(RedisVoiceLeaseStore::new(redis)),
        media,
        runtime,
    ))
}

fn worker_name(environment: Environment, project: Option<&str>) -> String {
    match environment {
        Environment::Local => format!("macro-agent-voice-local-{}", project.unwrap_or("macro")),
        _ => format!("macro-agent-voice-{environment}"),
    }
}

#[cfg(test)]
mod test;
