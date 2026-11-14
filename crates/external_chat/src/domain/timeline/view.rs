//! How stored rich content, mentions and votes read in the timeline: provider
//! ids become people's names, votes become tallies.

use super::*;
use crate::domain::rich::{
    Event, Location, PollOption, RichContent, SystemAction, SystemLine, created_subject, web_link,
};
use std::collections::HashMap;

#[cfg(test)]
mod test;

/// What a stored person is called and how they look.
#[derive(Debug)]
struct KnownPerson {
    name: String,
    picture_file_id: Option<Uuid>,
}

/// Who the people of a chat are, as far as the chat knows: by the provider
/// ids that mentions, system lines and votes name, and by the stored person
/// that sent, reacted or voted.
#[derive(Debug)]
pub struct People {
    by_id: HashMap<String, ExternalChatPersonRef>,
    by_person: HashMap<Uuid, KnownPerson>,
    unnamed: fn(&str) -> Option<String>,
    unknown: &'static str,
}

impl People {
    /// Nobody known yet; `unnamed` names an id nobody named (WhatsApp: its
    /// phone number), and `unknown` is what anyone else is called.
    pub fn new(unnamed: fn(&str) -> Option<String>, unknown: &'static str) -> Self {
        Self {
            by_id: HashMap::new(),
            by_person: HashMap::new(),
            unnamed,
            unknown,
        }
    }

    /// Learn a person's name; the first name given for an id wins, so pass
    /// the better sources first.
    pub fn learn(&mut self, id: &str, person: ExternalChatPersonRef) {
        self.by_id.entry(id.to_owned()).or_insert(person);
    }

    /// Learn what a stored person is called and their picture.
    pub fn name_person(&mut self, person: Uuid, name: String, picture_file_id: Option<Uuid>) {
        self.by_person.insert(
            person,
            KnownPerson {
                name,
                picture_file_id,
            },
        );
    }

    /// The person behind an id: their name when known, else what `unnamed`
    /// calls them, else a generic name.
    pub fn get(&self, id: &str) -> ExternalChatPersonRef {
        if let Some(person) = self.by_id.get(id) {
            return person.clone();
        }
        ExternalChatPersonRef {
            name: (self.unnamed)(id).unwrap_or_else(|| self.unknown.to_owned()),
            user_id: None,
            picture_file_id: None,
        }
    }

    /// A stored person by the name the provider gave them, else a generic
    /// name.
    pub fn person(&self, person: &StoredPerson) -> ExternalChatPersonRef {
        let known = self.by_person.get(&person.person_id);
        ExternalChatPersonRef {
            name: known
                .map(|known| known.name.clone())
                .unwrap_or_else(|| self.unknown.to_owned()),
            user_id: person.user_id.clone(),
            picture_file_id: known.and_then(|known| known.picture_file_id),
        }
    }
}

/// One person's current vote on a poll.
#[derive(Debug, Clone)]
pub struct StoredVote {
    /// The poll message.
    pub message_id: Uuid,
    /// Hashes of the options chosen.
    pub selected: Vec<String>,
    /// Who voted.
    pub voter: StoredPerson,
}

/// The mentions of a body, by name.
pub fn mentions_view(mentions: &[String], people: &People) -> Vec<ExternalChatMention> {
    mentions
        .iter()
        .map(|id| ExternalChatMention {
            // WhatsApp ids are `<token>@<server>`; Slack's are the token.
            token: id
                .split_once('@')
                .map_or(id.as_str(), |(token, _)| token)
                .to_owned(),
            person: people.get(id),
        })
        .collect()
}

fn poll_option(
    option: &PollOption,
    votes: &[&StoredVote],
    viewer: &str,
    people: &People,
) -> ExternalChatPollOption {
    let voters: Vec<ExternalChatPersonRef> = votes
        .iter()
        .filter(|vote| vote.selected.contains(&option.hash))
        .map(|vote| people.person(&vote.voter))
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
        actor: (!line.by_provider).then(|| sender.clone()),
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
                .map(|option| poll_option(option, votes, viewer, people))
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
    let sender = people.person(&message.sender);
    let votes: Vec<&StoredVote> = message.votes.iter().collect();
    ExternalChatMessage {
        id: message.id,
        mentions: mentions_view(&message.mentions, people),
        rich: message
            .rich
            .and_then(|content| rich_view(content, &sender, &votes, viewer, people)),
        sender: ExternalChatSender {
            person_id: message.sender.person_id,
            user_id: sender.user_id,
            name: sender.name,
            picture_file_id: sender.picture_file_id,
        },
        body: message.body,
        reply_to: message.reply_to,
        sent_at: message.sent_at,
        received_at: message.received_at,
        edited_at: message.edited_at,
        deleted: message.deleted,
        reactions: message
            .reactions
            .into_iter()
            .map(|reaction| ExternalChatReaction {
                emoji: reaction.emoji,
                reactors: reaction
                    .reactors
                    .iter()
                    .map(|reactor| people.person(reactor))
                    .collect(),
                mine: reaction.mine,
            })
            .collect(),
        attachments: message.attachments,
        delivery_state,
        kind: message.kind,
        forwarded: message.forwarded,
        view_once: message.view_once,
        thread_root: message.thread_root,
        thread_broadcast: message.thread_broadcast,
        thread: message.thread,
    }
}

/// The stored people a message names by person: its sender, reactors and
/// voters.
pub fn stored_people(message: &StoredMessage) -> impl Iterator<Item = Uuid> + '_ {
    let reactors = message
        .reactions
        .iter()
        .flat_map(|reaction| &reaction.reactors);
    let voters = message.votes.iter().map(|vote| &vote.voter);
    std::iter::once(&message.sender)
        .chain(reactors)
        .chain(voters)
        .map(|person| person.person_id)
}
