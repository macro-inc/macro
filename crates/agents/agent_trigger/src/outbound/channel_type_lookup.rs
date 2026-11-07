//! Channel type facts from the channels repository.

use agent_session::domain::error::{AgentSessionError, Result};
use channels::domain::models::ChannelType;
use channels::domain::ports::ChannelRepo;
use macro_uuid::Uuid;

use crate::domain::processing::ChannelTypeLookup;

/// Reads a channel's type from the channels repository.
pub struct ChannelRepoTypeLookup<Repo> {
    repo: Repo,
}

impl<Repo> ChannelRepoTypeLookup<Repo> {
    /// Creates a lookup over the given channels repository.
    pub const fn new(repo: Repo) -> Self {
        Self { repo }
    }
}

impl<Repo> ChannelTypeLookup for ChannelRepoTypeLookup<Repo>
where
    Repo: ChannelRepo,
{
    async fn channel_type(&self, channel_id: Uuid) -> Result<Option<ChannelType>> {
        match self.repo.get_channel_info(channel_id).await {
            Ok(info) => Ok(Some(info.channel_type)),
            Err(error) => {
                let error: anyhow::Error = error.into();
                // The repository reads one row and reports a missing channel
                // as the driver's not-found, which is the one failure a
                // consumer should skip rather than retry.
                if matches!(
                    error.downcast_ref::<sqlx::Error>(),
                    Some(sqlx::Error::RowNotFound)
                ) {
                    return Ok(None);
                }
                Err(AgentSessionError::Unknown(error))
            }
        }
    }
}
