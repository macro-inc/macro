use crate::model::{CountedReaction, Reaction};
use std::collections::HashMap;
pub mod add_reaction;
pub mod get_reactions;
pub mod remove_reaction;

/// Groups the reactions for a single message into a vec of CountedMessages
pub fn group_reactions(reactions: Vec<Reaction>) -> Vec<CountedReaction> {
    let mut emoji_groups: HashMap<String, (Vec<String>, chrono::DateTime<chrono::Utc>)> =
        HashMap::new();

    for reaction in reactions {
        emoji_groups
            .entry(reaction.emoji)
            .and_modify(|(users, earliest_time)| {
                users.push(reaction.user_id.clone());
                *earliest_time = std::cmp::min(*earliest_time, reaction.created_at);
            })
            .or_insert_with(|| (vec![reaction.user_id], reaction.created_at));
    }

    let mut counted_reactions: Vec<_> = emoji_groups
        .into_iter()
        .map(|(emoji, (users, time))| (CountedReaction { emoji, users }, time))
        .collect();

    counted_reactions.sort_by_key(|(_, time)| *time);

    counted_reactions
        .into_iter()
        .map(|(reaction, _)| reaction)
        .collect()
}

/// Groups the reactions for multiple messages into a vec of CountedMessages
pub fn group_reactions_by_message(
    reactions: Vec<Reaction>,
) -> HashMap<String, Vec<CountedReaction>> {
    #[expect(
        clippy::type_complexity,
        reason = "no good reason too annoying to fix right now"
    )]
    let mut message_groups: HashMap<
        String,
        HashMap<String, (Vec<String>, chrono::DateTime<chrono::Utc>)>,
    > = HashMap::new();

    for reaction in reactions {
        let message_id = reaction.message_id.to_string();
        let emoji_groups = message_groups.entry(message_id).or_default();

        emoji_groups
            .entry(reaction.emoji)
            .and_modify(|(users, earliest_time)| {
                users.push(reaction.user_id.clone());
                *earliest_time = std::cmp::min(*earliest_time, reaction.created_at);
            })
            .or_insert_with(|| (vec![reaction.user_id], reaction.created_at));
    }

    message_groups
        .into_iter()
        .map(|(message_id, emoji_groups)| {
            let mut reactions_with_time: Vec<_> = emoji_groups
                .into_iter()
                .map(|(emoji, (users, time))| (CountedReaction { emoji, users }, time))
                .collect();

            reactions_with_time.sort_by_key(|(_, time)| *time);

            let counted_reactions = reactions_with_time
                .into_iter()
                .map(|(reaction, _)| reaction)
                .collect();

            (message_id, counted_reactions)
        })
        .collect()
}
