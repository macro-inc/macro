//! Pausing a team's agent teammates' inboxes when the team is deleted.

/// Pauses a team's agent teammates' email inboxes ahead of its deletion.
#[async_trait::async_trait]
pub trait TeamAgentInboxes: Send + Sync {
    async fn pause_team(&self, team_id: uuid::Uuid) -> Result<(), rootcause::Report>;
}

#[async_trait::async_trait]
impl<Repository, Mailboxes> TeamAgentInboxes
    for team_agents::domain::inbox::InboxService<Repository, Mailboxes>
where
    Repository: team_agents::domain::inbox::AgentInboxRepository,
    Mailboxes: team_agents::domain::inbox::AgentMailboxes,
{
    async fn pause_team(&self, team_id: uuid::Uuid) -> Result<(), rootcause::Report> {
        team_agents::domain::inbox::InboxService::pause_team(self, team_id)
            .await
            .map_err(|error| rootcause::Report::new(error).into_dynamic())
    }
}
