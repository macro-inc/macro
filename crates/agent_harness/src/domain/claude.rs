//! Claude conversation lifecycle through owner-bound provider and session ports.
use crate::domain::error::{HarnessError, Result};
use agent_session::domain::{
    model::{AgentSessionId, ExternalSession},
    ports::{AgentSessionRepo, ExternalSessionRepo},
};
use claude_cloud_agents::domain::{
    model::{Error, SessionId},
    ports::{CloudLifecycle, CloudProvider},
    service::Session,
};
use std::sync::Arc;

/// Provider identity in the shared external-session store.
pub const PROVIDER: &str = "claude-cloud";
const PENDING: &str = "claude-cloud-create-pending";

fn cloud_error(error: Error) -> HarnessError {
    HarnessError::Container(error.to_string())
}

/// Lifecycle policy shared by every agent configured with the Claude harness.
pub struct ClaudeSessions<P, Repo, External> {
    provider: Arc<P>,
    repo: Repo,
    external: External,
    creation: tokio::sync::Mutex<()>,
}

impl<P: CloudProvider, Repo: AgentSessionRepo, External: ExternalSessionRepo>
    ClaudeSessions<P, Repo, External>
{
    /// Mint a fresh egress credential on reattach; persist only its hash, as for
    /// other external runtimes. The saved agent selection remains authoritative.
    pub async fn refresh_egress(
        &self,
        id: AgentSessionId,
        provisioner: &impl crate::domain::ports::SandboxEgressProvisioner,
    ) -> Result<String> {
        let row = self.repo.get(id).await?;
        let egress = provisioner
            .provision(id, &row.owner_id, &row.mcp_servers)
            .await?;
        self.repo
            .set_egress_token_hash(id, &egress.session_token_hash)
            .await?;
        Ok(egress.sandbox.session_token)
    }

    /// Wire the provider and the owning session repository at the composition root.
    pub fn new(provider: Arc<P>, repo: Repo, external: External) -> Self {
        Self {
            provider,
            repo,
            external,
            creation: tokio::sync::Mutex::new(()),
        }
    }

    /// Archive the owner's remote conversation before removing its mapping.
    pub async fn archive(&self, id: AgentSessionId) -> Result<()> {
        let _creation = self.creation.lock().await;
        let Some(external) = ExternalSessionRepo::get(&self.external, id).await? else {
            return Ok(());
        };
        if external.provider != PROVIDER {
            return Err(cloud_error(Error::UncertainCreate));
        }
        let row = AgentSessionRepo::get(&self.repo, id).await?;
        self.provider
            .connect(row.owner_id.as_ref())
            .await
            .map_err(cloud_error)?
            .archive(&SessionId::parse(&external.external_id).map_err(cloud_error)?)
            .await
            .map_err(cloud_error)?;
        ExternalSessionRepo::delete(&self.external, id).await?;
        Ok(())
    }
    /// Resolve or create a durable conversation for the session owner.
    pub async fn attach(&self, id: AgentSessionId) -> Result<Arc<Session<P::Client>>> {
        let _creation = self.creation.lock().await;
        let row = AgentSessionRepo::get(&self.repo, id).await?;
        let client = self
            .provider
            .connect(row.owner_id.as_ref())
            .await
            .map_err(cloud_error)?;
        let external = ExternalSessionRepo::get(&self.external, id).await?;
        let cloud_id = match external {
            Some(mut external) if external.provider == PROVIDER => {
                let cloud_id = SessionId::parse(&external.external_id).map_err(cloud_error)?;
                if external.external_url.is_none() {
                    external.external_url = Some(cloud_id.web_url());
                    self.external.upsert(id, external).await?;
                }
                cloud_id
            }
            Some(_) => return Err(cloud_error(Error::UncertainCreate)),
            None => {
                // Write a durable intent before the non-idempotent POST. A crash or
                // timeout stays visibly pending rather than minting a duplicate VM.
                self.external
                    .upsert(
                        id,
                        ExternalSession {
                            provider: PENDING.into(),
                            external_id: id.to_string(),
                            external_name: None,
                            external_url: None,
                            last_run_id: None,
                        },
                    )
                    .await?;
                let cloud_id = match client
                    .create(row.instructions.as_deref().unwrap_or_default())
                    .await
                {
                    Ok(id) => id,
                    Err(error) => {
                        // Only a definite client rejection is safe to retry as a new create.
                        if matches!(
                            error,
                            Error::Authorization | Error::NotConnected | Error::Http(400..=499)
                        ) {
                            ExternalSessionRepo::delete(&self.external, id).await?;
                        }
                        return Err(cloud_error(error));
                    }
                };
                self.external
                    .upsert(
                        id,
                        ExternalSession {
                            provider: PROVIDER.into(),
                            external_id: cloud_id.as_str().to_owned(),
                            external_name: Some("Claude Cloud".into()),
                            external_url: Some(cloud_id.web_url()),
                            last_run_id: None,
                        },
                    )
                    .await?;
                cloud_id
            }
        };
        Ok(Session::with_model(
            client,
            cloud_id,
            claude_cloud_agents::domain::models::Model::parse(&row.model).map_err(cloud_error)?,
        ))
    }
}

#[cfg(test)]
mod test;
