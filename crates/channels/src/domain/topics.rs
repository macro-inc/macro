//! Team-owned channel topics and participant-scoped topic reads.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// A topic with only the channel memberships visible to this user.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ChannelTopic {
    /// Topic id.
    pub id: Uuid,
    /// Owning team.
    pub team_id: Uuid,
    /// Display name.
    pub name: String,
    /// Optional explanation.
    pub description: Option<String>,
    /// Team default position.
    pub sort_order: f64,
    /// User's custom position, when set.
    pub sort_position: Option<f64>,
    /// Number of channels filed in this topic.
    pub channel_count: i64,
    /// IDs of channels this user participates in.
    pub channel_ids: Vec<Uuid>,
}

/// Topic write failure.
#[derive(Debug, thiserror::Error)]
pub enum TopicError {
    /// Invalid input.
    #[error("{0}")]
    Invalid(&'static str),
    /// Caller does not belong to the owning team.
    #[error("team membership required")]
    Forbidden,
    /// Topic or channel does not exist.
    #[error("topic or channel not found")]
    NotFound,
    /// Persistence failure.
    #[error(transparent)]
    Repo(#[from] anyhow::Error),
}

/// Persistence facts and commands for topic use cases.
#[async_trait::async_trait]
pub trait TopicRepository: Send + Sync + 'static {
    /// Team of an authenticated user, if any.
    async fn user_team(&self, user_id: &str) -> anyhow::Result<Option<Uuid>>;
    /// Team owning this topic, if it exists.
    async fn topic_team(&self, topic_id: Uuid) -> anyhow::Result<Option<Uuid>>;
    /// Team of a team channel, if the channel is one.
    async fn team_channel_team(&self, channel_id: Uuid) -> anyhow::Result<Option<Uuid>>;
    /// Insert a topic.
    async fn create(
        &self,
        id: Uuid,
        team_id: Uuid,
        name: &str,
        description: Option<&str>,
        user_id: &str,
    ) -> anyhow::Result<()>;
    /// Change topic metadata.
    async fn update(
        &self,
        id: Uuid,
        name: Option<&str>,
        description: Option<&str>,
    ) -> anyhow::Result<()>;
    /// Delete a topic and its membership rows.
    async fn delete(&self, id: Uuid) -> anyhow::Result<()>;
    /// Insert a channel membership.
    async fn add_channel(
        &self,
        topic_id: Uuid,
        channel_id: Uuid,
        user_id: &str,
    ) -> anyhow::Result<()>;
    /// Remove a channel membership.
    async fn remove_channel(&self, topic_id: Uuid, channel_id: Uuid) -> anyhow::Result<()>;
    /// List topics and participant-scoped channel ids.
    async fn list(&self, team_id: Uuid, user_id: &str) -> anyhow::Result<Vec<ChannelTopic>>;
    /// Write positions in one transaction.
    async fn set_order(&self, user_id: &str, ids: &[Uuid]) -> anyhow::Result<()>;
}

/// Topic use cases; authorization and channel type policy live here.
#[derive(Clone)]
pub struct TopicService<R> {
    repo: R,
}

impl<R: TopicRepository> TopicService<R> {
    /// Construct with the outbound port.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }

    async fn own_team(&self, user_id: &str) -> Result<Uuid, TopicError> {
        self.repo
            .user_team(user_id)
            .await?
            .ok_or(TopicError::Forbidden)
    }

    async fn authorize_topic(&self, user_id: &str, id: Uuid) -> Result<Uuid, TopicError> {
        let team = self.own_team(user_id).await?;
        let topic_team = self
            .repo
            .topic_team(id)
            .await?
            .ok_or(TopicError::NotFound)?;
        if team != topic_team {
            return Err(TopicError::Forbidden);
        }
        Ok(team)
    }

    /// Create a topic for the caller's team.
    pub async fn create(
        &self,
        user_id: &str,
        name: &str,
        description: Option<&str>,
    ) -> Result<Uuid, TopicError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(TopicError::Invalid("topic name is required"));
        }
        let team = self.own_team(user_id).await?;
        let id = Uuid::now_v7();
        self.repo
            .create(id, team, name, description, user_id)
            .await?;
        Ok(id)
    }

    /// Rename or describe a topic.
    pub async fn update(
        &self,
        user_id: &str,
        id: Uuid,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<(), TopicError> {
        self.authorize_topic(user_id, id).await?;
        if name.is_some_and(|value| value.trim().is_empty()) {
            return Err(TopicError::Invalid("topic name is required"));
        }
        self.repo.update(id, name, description).await?;
        Ok(())
    }

    /// Delete a topic; channels remain unchanged.
    pub async fn delete(&self, user_id: &str, id: Uuid) -> Result<(), TopicError> {
        self.authorize_topic(user_id, id).await?;
        self.repo.delete(id).await?;
        Ok(())
    }

    /// Add a team channel from the same team to a topic.
    pub async fn add_channel(
        &self,
        user_id: &str,
        topic_id: Uuid,
        channel_id: Uuid,
    ) -> Result<(), TopicError> {
        let team = self.authorize_topic(user_id, topic_id).await?;
        if self.repo.team_channel_team(channel_id).await? != Some(team) {
            return Err(TopicError::Invalid(
                "only team channels from this team can be filed",
            ));
        }
        self.repo.add_channel(topic_id, channel_id, user_id).await?;
        Ok(())
    }

    /// Remove a channel from a topic.
    pub async fn remove_channel(
        &self,
        user_id: &str,
        topic_id: Uuid,
        channel_id: Uuid,
    ) -> Result<(), TopicError> {
        self.authorize_topic(user_id, topic_id).await?;
        self.repo.remove_channel(topic_id, channel_id).await?;
        Ok(())
    }

    /// List only the caller's team topics, with participant-scoped channel IDs.
    pub async fn list(&self, user_id: &str) -> Result<Vec<ChannelTopic>, TopicError> {
        let team = self.own_team(user_id).await?;
        Ok(self.repo.list(team, user_id).await?)
    }

    /// Set this user's custom topic order. Requires every id to belong to the caller's team.
    pub async fn set_order(&self, user_id: &str, ids: &[Uuid]) -> Result<(), TopicError> {
        let team = self.own_team(user_id).await?;
        let unique: std::collections::HashSet<_> = ids.iter().collect();
        if unique.len() != ids.len() {
            return Err(TopicError::Invalid("duplicate topic id"));
        }
        for id in ids {
            if self.repo.topic_team(*id).await? != Some(team) {
                return Err(TopicError::Forbidden);
            }
        }
        self.repo.set_order(user_id, ids).await?;
        Ok(())
    }
}
