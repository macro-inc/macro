//! Which candidate a notification belongs to, per keying.
//!
//! The candidate query (Soup's `attention` repository) keys notifications the
//! same way: under [`CandidateKeying::ThreadScoped`] a channel notification
//! that names a thread root keys to a `channel_message` candidate on it;
//! under [`CandidateKeying::FiledEntity`] every notification keys to its own
//! entity.

use model_entity::{Entity, EntityType};
use model_notifications::NotifEvent;
use notification::domain::models::UserNotificationRow;

use super::models::CandidateKeying;

#[cfg(test)]
mod test;

/// The channel thread root a channel notification is attributed to, if any:
/// the thread for replies, and the named message's thread (or the message
/// itself, which becomes the root) for mentions, reactions and document
/// mentions. Plain sends and channel-level events have none.
pub fn channel_thread_root(notification: &UserNotificationRow<NotifEvent>) -> Option<&str> {
    if notification.entity.entity_type != EntityType::Channel {
        return None;
    }
    match &notification.notification_metadata {
        NotifEvent::ChannelMessageReply(reply) => Some(reply.thread_id.as_str()),
        NotifEvent::ChannelMention(mention) => {
            Some(mention.thread_id.as_deref().unwrap_or(&mention.message_id))
        }
        NotifEvent::ChannelMessageReaction(reaction) => Some(
            reaction
                .thread_id
                .as_deref()
                .unwrap_or(&reaction.message_id),
        ),
        NotifEvent::DocumentMention(mention) => Some(
            mention
                .channel
                .thread_id
                .as_deref()
                .unwrap_or(&mention.channel.message_id),
        ),
        _ => None,
    }
}

/// The candidates a notification about its entity may affect.
///
/// Under [`CandidateKeying::ThreadScoped`] a channel notification can move
/// between the channel candidate and a thread candidate, so both are
/// recomputed; a plain send names the thread it may root. Under
/// [`CandidateKeying::FiledEntity`] only the notification's own entity.
pub fn trigger_keys(
    notification: &UserNotificationRow<NotifEvent>,
    keying: CandidateKeying,
) -> Vec<Entity<'static>> {
    let mut keys = vec![notification.entity.clone()];
    if keying == CandidateKeying::FiledEntity
        || notification.entity.entity_type != EntityType::Channel
    {
        return keys;
    }
    let thread = channel_thread_root(notification).or(match &notification.notification_metadata {
        NotifEvent::ChannelMessageSend(send) => Some(send.message_id.as_str()),
        _ => None,
    });
    if let Some(root) = thread {
        keys.push(EntityType::ChannelMessage.with_entity_string(root.to_string()));
    }
    keys
}
