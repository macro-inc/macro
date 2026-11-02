//! The name an agent's writes are presented under while they happen.
use bot_id::BotId;
use bots::domain::ports::BotService;

#[cfg(test)]
mod test;

/// The display name of `agent`, a user- or team-owned bot a credential was
/// signed for, so the cursor the editing worker draws reads that agent's name.
/// `None` for a first-party bot, whose constant name the tools already know,
/// and for a bot that no longer exists or could not be read.
pub(crate) async fn agent_name<Bots: BotService>(bots: &Bots, agent: BotId) -> Option<String> {
    if bot_id::system_bot(agent).is_some() {
        return None;
    }
    match bots.get_self(agent).await {
        Ok(bot) => Some(bot.name),
        Err(error) => {
            tracing::warn!(?error, bot_id = %agent.as_uuid(), "could not read the calling agent's name");
            None
        }
    }
}
