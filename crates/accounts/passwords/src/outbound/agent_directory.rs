//! Production-default agent directory until the agent platform supplies the
//! authoritative adapter.
use crate::domain::{
    agent::{DirectoryAgent, ports::AgentDirectory},
    models::Error,
};
use async_trait::async_trait;

/// Admits nobody: with the agent flags on, every agent call is `invalid_agent`.
pub struct NoAgents;

#[async_trait]
impl AgentDirectory for NoAgents {
    async fn resolve(
        &self,
        _: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<Option<DirectoryAgent>, Error> {
        Ok(None)
    }
}
