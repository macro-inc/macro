//! How stored rich content, mentions and votes read in the timeline: WhatsApp
//! ids become people's names, votes become tallies.

use super::*;
use crate::domain::rich::{PollOption, RichContent, SystemLine};
use std::collections::HashMap;

#[cfg(test)]
mod test;

/// Who WhatsApp ids are, as far as the group knows: people seen in it (with
/// their verified Macro user) and the roster's names.
#[derive(Debug, Default)]
pub struct People {
    by_jid: HashMap<String, WhatsAppPersonRef>,
}

impl People {
    /// Learn a person's name; the first name given for an id wins, so pass
    /// the better sources first.
    pub fn learn(&mut self, jid: &str, person: WhatsAppPersonRef) {
        self.by_jid.entry(jid.to_owned()).or_insert(person);
    }

    /// The person behind an id: their name when known, else their phone
    /// number, else a generic name.
    pub fn get(&self, jid: &str) -> WhatsAppPersonRef {
        if let Some(person) = self.by_jid.get(jid) {
            return person.clone();
        }
        WhatsAppPersonRef {
            name: jid
                .strip_suffix("@s.whatsapp.net")
                .map(|phone| format!("+{phone}"))
                .unwrap_or_else(|| UNKNOWN_PERSON.to_owned()),
            user_id: None,
        }
    }
}

/// Name for someone WhatsApp only knows by a private id.
pub const UNKNOWN_PERSON: &str = "WhatsApp participant";

/// One person's current vote on a poll.
#[derive(Debug, Clone)]
pub struct StoredVote {
    /// The poll message.
    pub message_id: Uuid,
    /// Hashes of the options chosen.
    pub selected: Vec<String>,
    /// Who voted.
    pub voter: WhatsAppPersonRef,
}

/// The mentions of a body, by name.
pub fn mentions_view(mentions: &[String], people: &People) -> Vec<WhatsAppMention> {
    mentions
        .iter()
        .filter_map(|jid| {
            let (token, _) = jid.split_once('@')?;
            Some(WhatsAppMention {
                token: token.to_owned(),
                person: people.get(jid),
            })
        })
        .collect()
}

fn poll_option(option: &PollOption, votes: &[&StoredVote], viewer: &str) -> WhatsAppPollOption {
    let voters: Vec<WhatsAppPersonRef> = votes
        .iter()
        .filter(|vote| vote.selected.contains(&option.hash))
        .map(|vote| vote.voter.clone())
        .collect();
    WhatsAppPollOption {
        name: option.name.clone(),
        votes: voters.len() as i64,
        mine: voters
            .iter()
            .any(|voter| voter.user_id.as_deref() == Some(viewer)),
        voters,
    }
}

fn system_view(
    line: SystemLine,
    sender: &WhatsAppPersonRef,
    people: &People,
) -> WhatsAppSystemLine {
    WhatsAppSystemLine {
        action: line.action,
        actor: (!line.by_whatsapp).then(|| sender.clone()),
        participants: line
            .participants
            .iter()
            .map(|jid| people.get(jid))
            .collect(),
        value: line.value,
        call: line.call,
    }
}

/// The timeline form of stored rich content. `votes` are the votes on this
/// message; `viewer` decides `mine`.
pub fn rich_view(
    rich: RichContent,
    sender: &WhatsAppPersonRef,
    votes: &[&StoredVote],
    viewer: &str,
    people: &People,
) -> Option<WhatsAppRichContent> {
    Some(match rich {
        RichContent::Poll(poll) => WhatsAppRichContent::Poll(WhatsAppPoll {
            options: poll
                .options
                .iter()
                .map(|option| poll_option(option, votes, viewer))
                .collect(),
            question: poll.question,
            selectable_count: poll.selectable_count,
            voters: votes
                .iter()
                .filter(|vote| !vote.selected.is_empty())
                .count() as i64,
        }),
        RichContent::Location(location) => WhatsAppRichContent::Location(location),
        RichContent::Contacts(contacts) => WhatsAppRichContent::Contacts(contacts),
        RichContent::Event(event) => WhatsAppRichContent::Event(event),
        RichContent::System(line) => WhatsAppRichContent::System(system_view(line, sender, people)),
        // Votes are applied to their poll, never shown on their own.
        RichContent::PollVote(_) => return None,
    })
}
