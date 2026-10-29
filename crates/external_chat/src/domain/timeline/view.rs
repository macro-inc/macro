//! How stored rich content, mentions and votes read in the timeline: provider
//! ids become people's names, votes become tallies.

use super::*;
use crate::domain::rich::{
    Event, Location, PollOption, RichContent, SystemAction, SystemLine, created_subject, web_link,
};
use std::collections::HashMap;

#[cfg(test)]
mod test;

/// Who provider ids are, as far as the chat knows: people seen in it (with
/// their verified Macro user) and the roster's names.
#[derive(Debug)]
pub struct People {
    by_id: HashMap<String, ExternalChatPersonRef>,
    unnamed: fn(&str) -> Option<String>,
}

impl Default for People {
    fn default() -> Self {
        Self::new(|_| None)
    }
}

impl People {
    /// Nobody known yet; `unnamed` names an id nobody named (WhatsApp: its
    /// phone number).
    pub fn new(unnamed: fn(&str) -> Option<String>) -> Self {
        Self {
            by_id: HashMap::new(),
            unnamed,
        }
    }

    /// Learn a person's name; the first name given for an id wins, so pass
    /// the better sources first.
    pub fn learn(&mut self, id: &str, person: ExternalChatPersonRef) {
        self.by_id.entry(id.to_owned()).or_insert(person);
    }

    /// The person behind an id: their name when known, else what `unnamed`
    /// calls them, else a generic name.
    pub fn get(&self, id: &str) -> ExternalChatPersonRef {
        if let Some(person) = self.by_id.get(id) {
            return person.clone();
        }
        ExternalChatPersonRef {
            name: (self.unnamed)(id).unwrap_or_else(|| UNKNOWN_PERSON.to_owned()),
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
    pub voter: ExternalChatPersonRef,
}

/// The mentions of a body, by name.
pub fn mentions_view(mentions: &[String], people: &People) -> Vec<ExternalChatMention> {
    mentions
        .iter()
        .filter_map(|jid| {
            let (token, _) = jid.split_once('@')?;
            Some(ExternalChatMention {
                token: token.to_owned(),
                person: people.get(jid),
            })
        })
        .collect()
}

fn poll_option(option: &PollOption, votes: &[&StoredVote], viewer: &str) -> ExternalChatPollOption {
    let voters: Vec<ExternalChatPersonRef> = votes
        .iter()
        .filter(|vote| vote.selected.contains(&option.hash))
        .map(|vote| vote.voter.clone())
        .collect();
    ExternalChatPollOption {
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
    sender: &ExternalChatPersonRef,
    people: &People,
) -> ExternalChatSystemLine {
    ExternalChatSystemLine {
        action: line.action,
        actor: (!line.by_whatsapp).then(|| sender.clone()),
        participants: line
            .participants
            .iter()
            .map(|jid| people.get(jid))
            .collect(),
        value: match line.action {
            SystemAction::GroupCreated => line.value.as_deref().and_then(created_subject),
            _ => line.value,
        },
        call: line.call,
    }
}

/// The timeline form of stored rich content. `votes` are the votes on this
/// message; `viewer` decides `mine`.
pub fn rich_view(
    rich: RichContent,
    sender: &ExternalChatPersonRef,
    votes: &[&StoredVote],
    viewer: &str,
    people: &People,
) -> Option<ExternalChatRichContent> {
    Some(match rich {
        RichContent::Poll(poll) => ExternalChatRichContent::Poll(ExternalChatPoll {
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
        // Links were sender-supplied; ones stored before they were checked
        // are checked again.
        RichContent::Location(location) => ExternalChatRichContent::Location(Location {
            url: location.url.as_deref().and_then(web_link),
            ..location
        }),
        RichContent::Contacts(contacts) => ExternalChatRichContent::Contacts(contacts),
        RichContent::Event(event) => ExternalChatRichContent::Event(Event {
            join_link: event.join_link.as_deref().and_then(web_link),
            ..event
        }),
        RichContent::System(line) => {
            ExternalChatRichContent::System(system_view(line, sender, people))
        }
        // Votes are applied to their poll, never shown on their own.
        RichContent::PollVote(_) => return None,
    })
}

/// A stored message as the timeline shows it to `viewer`.
pub fn message_view(
    message: StoredMessage,
    delivery_state: Option<DeliveryState>,
    viewer: &str,
    people: &People,
) -> ExternalChatMessage {
    let sender = ExternalChatPersonRef {
        name: message.sender.name.clone(),
        user_id: message.sender.user_id.clone(),
    };
    let votes: Vec<&StoredVote> = message.votes.iter().collect();
    ExternalChatMessage {
        id: message.id,
        mentions: mentions_view(&message.mentions, people),
        rich: message
            .rich
            .and_then(|content| rich_view(content, &sender, &votes, viewer, people)),
        sender: message.sender,
        body: message.body,
        reply_to: message.reply_to,
        sent_at: message.sent_at,
        received_at: message.received_at,
        edited_at: message.edited_at,
        deleted: message.deleted,
        reactions: message.reactions,
        attachments: message.attachments,
        delivery_state,
        kind: message.kind,
        forwarded: message.forwarded,
        view_once: message.view_once,
    }
}
