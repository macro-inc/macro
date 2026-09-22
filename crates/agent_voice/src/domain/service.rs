//! Authorization, controller ownership and room lifecycle.

use std::sync::Arc;

use chrono::Utc;
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, EntityType};
use macro_uuid::Uuid;

use super::model::*;
use super::ports::{AgentVoiceDirectory, VoiceLeaseStore, VoiceMedia, VoiceRuntime};

#[cfg(test)]
mod test;

/// Agent voice use cases for supported Macro harness sessions.
#[derive(Clone)]
pub struct AgentVoiceService {
    directory: Arc<dyn AgentVoiceDirectory>,
    store: Arc<dyn VoiceLeaseStore>,
    media: Arc<dyn VoiceMedia>,
    runtime: Arc<dyn VoiceRuntime>,
}

impl AgentVoiceService {
    /// Wire owning-domain and infrastructure capabilities.
    pub fn new(
        directory: Arc<dyn AgentVoiceDirectory>,
        store: Arc<dyn VoiceLeaseStore>,
        media: Arc<dyn VoiceMedia>,
        runtime: Arc<dyn VoiceRuntime>,
    ) -> Self {
        Self {
            directory,
            store,
            media,
            runtime,
        }
    }

    /// Return availability without creating a media room.
    pub async fn options(
        &self,
        access: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<VoiceOptions> {
        let (session, _) = identity(&access)?;
        let enabled = self.directory.is_macro_session(session).await?;
        Ok(VoiceOptions {
            enabled,
            voices: Voice::catalog(),
            max_duration_seconds: MAX_DURATION_SECONDS,
        })
    }

    /// Start or rejoin this browser's existing conversation without duplicate dispatch.
    pub async fn start(
        &self,
        access: EntityAccessReceipt<EditAccessLevel>,
        request: StartVoice,
    ) -> Result<VoiceConnection> {
        let (session_id, owner) = identity(&access)?;
        if !self.directory.is_macro_session(session_id).await? {
            return Err(VoiceError::UnsupportedHarness);
        }
        // Finish provisioning/cleanup even if the HTTP caller disconnects.
        let service = self.clone();
        tokio::spawn(async move {
            service
                .start_claim(VoiceLease {
                    session_id,
                    owner,
                    client_session_id: request.client_session_id,
                    voice_session_id: VoiceSessionId(macro_uuid::generate_uuid_v7()),
                    voice: request.voice,
                    expires_at: Utc::now()
                        + chrono::Duration::seconds(i64::from(MAX_DURATION_SECONDS)),
                    state: LeaseState::Starting,
                })
                .await
        })
        .await
        .map_err(|error| VoiceError::Infrastructure(rootcause::report!(error).into()))?
    }

    async fn start_claim(&self, lease: VoiceLease) -> Result<VoiceConnection> {
        let media = &self.media;
        if let Some(existing) = self.store.claim(&lease).await? {
            if existing.state == LeaseState::Ending
                && existing.owner == lease.owner
                && existing.client_session_id == lease.client_session_id
            {
                return Err(VoiceError::Ended);
            }
            let gone = existing.expires_at <= Utc::now()
                || (existing.state != LeaseState::Starting && !media.is_open(&existing).await?);
            if gone {
                media.close(&existing).await?;
                self.runtime.end(&existing).await?;
                self.store
                    .release(existing.session_id, existing.voice_session_id)
                    .await?;
                // Retrying an ended conversation never dispatches it again. A fresh
                // conversation may reclaim a room the worker has already deleted.
                if existing.client_session_id == lease.client_session_id {
                    return Err(VoiceError::Ended);
                }
                if self.store.claim(&lease).await?.is_some() {
                    return Err(VoiceError::Conflict);
                }
            } else {
                if existing.owner != lease.owner
                    || existing.client_session_id != lease.client_session_id
                    || existing.voice != lease.voice
                {
                    return Err(VoiceError::Conflict);
                }
                return match existing.state {
                    LeaseState::Active => self.connection(&existing),
                    LeaseState::Starting => Err(VoiceError::Conflict),
                    LeaseState::Ending => Err(VoiceError::Ended),
                };
            }
        }

        // The worker independently enforces expires_at after server restarts.
        let cleanup = self.clone();
        let deadline = lease.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(u64::from(
                MAX_DURATION_SECONDS,
            )))
            .await;
            if let Err(error) = cleanup.close_lease(&deadline).await {
                tracing::error!(error = ?error, voice_session_id = %deadline.voice_session_id.0, "voice deadline cleanup failed");
            }
        });
        let provision = async {
            self.runtime.prepare(&lease).await?;
            media.provision(&lease).await
        };
        if let Err(error) = provision.await {
            // Keep the claim when cleanup cannot establish the room is gone.
            if media.close(&lease).await.is_ok() {
                self.runtime.end(&lease).await?;
                self.store
                    .release(lease.session_id, lease.voice_session_id)
                    .await?;
            } else {
                self.store
                    .transition(
                        lease.session_id,
                        lease.voice_session_id,
                        LeaseState::Starting,
                        LeaseState::Ending,
                    )
                    .await?;
            }
            return Err(error);
        }
        if !self
            .store
            .transition(
                lease.session_id,
                lease.voice_session_id,
                LeaseState::Starting,
                LeaseState::Active,
            )
            .await?
        {
            media.close(&lease).await?;
            self.runtime.end(&lease).await?;
            return Err(VoiceError::Conflict);
        }
        self.connection(&lease)
    }

    fn connection(&self, lease: &VoiceLease) -> Result<VoiceConnection> {
        let media = &self.media;
        let remaining = (lease.expires_at - Utc::now()).num_seconds();
        let ttl = u32::try_from(remaining)
            .ok()
            .filter(|seconds| *seconds > 0)
            .ok_or(VoiceError::Ended)?
            .min(JOIN_TOKEN_SECONDS);
        Ok(VoiceConnection {
            voice_session_id: lease.voice_session_id,
            room_name: lease.room_name(),
            url: media.url().to_owned(),
            token: media.token(lease, ttl)?,
            participant_identity: lease.participant_identity(),
            agent_identity: lease.agent_identity(),
            expires_at: lease.expires_at,
            voice: lease.voice,
            max_duration_seconds: MAX_DURATION_SECONDS,
        })
    }

    /// End only the caller's own private conversation; absent is already ended.
    pub async fn end(
        &self,
        access: EntityAccessReceipt<EditAccessLevel>,
        voice: VoiceSessionId,
    ) -> Result<()> {
        let (session, owner) = identity(&access)?;
        let Some(lease) = self.store.get(session).await? else {
            return Ok(());
        };
        if lease.voice_session_id != voice {
            return Ok(());
        }
        if lease.owner != owner {
            return Err(VoiceError::Forbidden);
        }
        if lease.state == LeaseState::Starting {
            return Err(VoiceError::Conflict);
        }
        if lease.state == LeaseState::Active
            && !self
                .store
                .transition(session, voice, LeaseState::Active, LeaseState::Ending)
                .await?
        {
            return Err(VoiceError::Conflict);
        }
        let service = self.clone();
        tokio::spawn(async move { service.close_lease(&lease).await })
            .await
            .map_err(|error| VoiceError::Infrastructure(rootcause::report!(error).into()))?
    }

    async fn close_lease(&self, lease: &VoiceLease) -> Result<()> {
        self.media.close(lease).await?;
        self.runtime.end(lease).await?;
        self.store
            .release(lease.session_id, lease.voice_session_id)
            .await
    }

    /// The current temporary runtime binding, including a dispatch in progress.
    /// Runtime routing uses this to prevent a competing text agent from starting.
    pub async fn active_lease(&self, session: Uuid) -> Result<Option<VoiceLease>> {
        Ok(self
            .store
            .get(session)
            .await?
            .filter(|lease| lease.expires_at > Utc::now() && lease.state != LeaseState::Ending))
    }

    /// A claimed runtime slot, including one whose cleanup is in progress.
    /// Text must not start a replacement until cleanup releases the claim.
    pub async fn runtime_lease(&self, session: Uuid) -> Result<Option<VoiceLease>> {
        self.store.get(session).await
    }

    /// Release a failed or completed worker's runtime claim. The composition
    /// adapter calls this with the lease authenticated for that connection;
    /// an old connection can never close its replacement.
    pub async fn worker_stopped(&self, worker: &VoiceLease) -> Result<()> {
        let Some(lease) = self.store.get(worker.session_id).await? else {
            return Ok(());
        };
        if lease.voice_session_id != worker.voice_session_id {
            return Ok(());
        }
        if lease.state != LeaseState::Ending {
            self.store
                .transition(
                    lease.session_id,
                    lease.voice_session_id,
                    lease.state,
                    LeaseState::Ending,
                )
                .await?;
        }
        self.close_lease(&lease).await
    }

    /// Authenticate a server worker against the current voice generation.
    /// Browser media tokens are valid LiveKit credentials but never carry the
    /// expected worker identity, so they cannot drive the canonical runtime.
    pub async fn authorize_worker(
        &self,
        session: Uuid,
        voice: VoiceSessionId,
        token: &str,
    ) -> Result<VoiceLease> {
        let principal = self.media.verify_worker(token)?;
        let lease = self.active_lease(session).await?.ok_or(VoiceError::Ended)?;
        if lease.voice_session_id != voice
            || principal.identity != lease.agent_identity()
            || principal.room_name != lease.room_name()
        {
            return Err(VoiceError::Forbidden);
        }
        Ok(lease)
    }
}

fn identity(
    access: &EntityAccessReceipt<EditAccessLevel>,
) -> Result<(Uuid, macro_user_id::user_id::MacroUserIdStr<'static>)> {
    if access.entity().entity_type != EntityType::AgentSession {
        return Err(VoiceError::Forbidden);
    }
    let session = access
        .entity()
        .entity_id
        .parse()
        .map_err(|_| VoiceError::Forbidden)?;
    let owner = access
        .get_authenticated_user()
        .map_err(|_| VoiceError::Forbidden)?
        .clone();
    Ok((session, owner))
}
