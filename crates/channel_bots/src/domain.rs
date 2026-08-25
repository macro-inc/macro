//! Domain layer: bot trigger models, ports, and service implementation.

pub mod models;
pub mod ports;
pub mod service;
pub mod trigger_detector;

/// Human-readable label for a message sender storage id.
pub(crate) fn sender_label(sender_id: &str) -> String {
    if let Ok(bot) = bot_id::BotIdStr::parse_from_str(sender_id) {
        return if bot.bot_id() == bot_id::MACRO_AI_BOT_ID {
            bot_id::MACRO_AI_NAME.to_string()
        } else {
            "Bot".to_string()
        };
    }
    // User ids look like `macro|<email>`; show the email's local part.
    sender_id
        .rsplit('|')
        .next()
        .unwrap_or(sender_id)
        .split('@')
        .next()
        .unwrap_or(sender_id)
        .to_string()
}
