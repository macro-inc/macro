//! Batched agent settings for the message audience policy.
use super::PgBotsRepo;
use bot_id::BotId;
use messages::domain::ports::{EphemeralAgentReader, MessageError};

impl EphemeralAgentReader for PgBotsRepo {
    fn ephemeral_agents<'a>(
        &'a self,
        bots: &'a [BotId],
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<Vec<String>, MessageError>> + Send + 'a>>
    {
        Box::pin(async move {
            if bots.is_empty() {
                return Ok(Vec::new());
            }
            let ids: Vec<_> = bots.iter().map(|id| id.as_uuid()).collect();
            let ids = sqlx::query_scalar!(
                "SELECT bot_id FROM agent_configs WHERE bot_id = ANY($1) AND is_ephemeral",
                &ids,
            )
            .fetch_all(&self.pool)
            .await
            .map_err(|error| MessageError::Repository(rootcause::Report::new(error).into()))?;
            Ok(ids
                .into_iter()
                .map(|id| BotId::new_from_uuid(id).into_storage_id().to_string())
                .collect())
        })
    }
}
