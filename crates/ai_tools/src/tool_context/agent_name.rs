//! The name an agent's writes are presented under while they happen.
use bot_id::BotId;
use bots::domain::ports::BotService;

#[cfg(test)]
mod test;

/// The display name of `agent`, a user- or team-owned bot a credential was
/// signed for, so the cursor the editing worker draws reads that agent's name.
/// `None` for a first-party bot, whose constant name the tools already know,
/// and for a bot that no longer exists or could not be read.
#[tracing::instrument(
    name = "mcp.agent_name",
    skip_all,
    fields(bot_id = %agent.as_uuid(), found = tracing::field::Empty)
)]
pub(crate) async fn agent_name<Bots: BotService>(bots: &Bots, agent: BotId) -> Option<String> {
    if bot_id::system_bot(agent).is_some() {
        return None;
    }
    match bots.get_self(agent).await {
        Ok(bot) => {
            tracing::Span::current().record("found", true);
            Some(bot.name)
        }
        Err(error) => {
            tracing::Span::current().record("found", false);
            tracing::warn!(?error, "could not read the calling agent's name");
            None
        }
    }
}
