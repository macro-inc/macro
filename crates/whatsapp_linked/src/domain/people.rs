//! What WhatsApp people are called in a chat: the chat owner's own name for
//! them (their address book, as the owner's chat list holds it), else their
//! WhatsApp name, else their phone number. Pictures are the ones the chat
//! owner's account can see.

use super::{
    jid::phone_number,
    models::{GroupInfo, Identity},
};
use external_chat::domain::timeline::{ExternalChatPersonRef, view::People};
use std::collections::HashMap;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// A person who wrote, reacted or voted in a chat, as stored.
#[derive(Debug, Clone)]
pub struct SeenPerson {
    /// External person identity.
    pub person_id: Uuid,
    /// Verified Macro user association.
    pub user_id: Option<String>,
    /// Their WhatsApp name, from their messages or the address book's
    /// copy of it.
    pub whatsapp_name: Option<String>,
    /// Their phone-number and LID JIDs in the chat.
    pub jids: Vec<String>,
}

/// The names and pictures a chat's people go by.
#[derive(Debug)]
pub struct ChatNames {
    /// The owner's chat-list names, by JID.
    contacts: HashMap<String, String>,
    /// The profile pictures the owner's account has stored, by JID.
    pictures: HashMap<String, Uuid>,
    seen: Vec<SeenPerson>,
}

impl ChatNames {
    /// From the owner's chat-list names and pictures and the people seen in
    /// the chat.
    pub fn new(
        contacts: HashMap<String, String>,
        pictures: HashMap<String, Uuid>,
        seen: Vec<SeenPerson>,
    ) -> Self {
        Self {
            contacts,
            pictures,
            seen,
        }
    }

    /// The owner's stored picture of someone with these JIDs.
    fn picture(&self, jids: &[&str]) -> Option<Uuid> {
        jids.iter().find_map(|jid| self.pictures.get(*jid).copied())
    }

    /// The seen person behind any of `jids`.
    fn seen_by(&self, jids: &[&str]) -> Option<&SeenPerson> {
        self.seen
            .iter()
            .find(|person| person.jids.iter().any(|jid| jids.contains(&jid.as_str())))
    }

    /// What someone with these JIDs is called: the owner's contact name for
    /// any of them, else `whatsapp_name`, else the phone number of any.
    fn name(&self, jids: &[&str], whatsapp_name: Option<&str>) -> Option<String> {
        let nonempty = |name: &&str| !name.trim().is_empty();
        let contact = jids
            .iter()
            .filter_map(|jid| self.contacts.get(*jid).map(String::as_str))
            .find(nonempty);
        if let Some(name) = contact.or(whatsapp_name.filter(nonempty)) {
            return Some(name.trim().to_owned());
        }
        jids.iter().find_map(|jid| phone_number(jid))
    }

    /// The JIDs and WhatsApp name of a roster member, with what is known of
    /// them from having written in the chat.
    fn member<'a>(
        &'a self,
        identity: &'a Identity,
    ) -> (Vec<&'a str>, Option<&'a str>, Option<&'a SeenPerson>) {
        let jids: Vec<&str> = [
            Some(identity.jid.as_str()),
            identity.alternate_jid.as_deref(),
        ]
        .into_iter()
        .flatten()
        .collect();
        let seen = self.seen_by(&jids);
        let whatsapp_name = identity
            .display_name
            .as_deref()
            .or_else(|| seen.and_then(|person| person.whatsapp_name.as_deref()));
        (jids, whatsapp_name, seen)
    }

    /// Names for the seen people and, through `roster`, everyone in the chat.
    pub fn people(&self, roster: Option<&GroupInfo>) -> People {
        let mut people = People::new(phone_number);
        for person in &self.seen {
            let jids: Vec<&str> = person.jids.iter().map(String::as_str).collect();
            let Some(name) = self.name(&jids, person.whatsapp_name.as_deref()) else {
                continue;
            };
            let picture = self.picture(&jids);
            people.name_person(person.person_id, name.clone(), picture);
            for jid in jids {
                people.learn(
                    jid,
                    ExternalChatPersonRef {
                        name: name.clone(),
                        user_id: person.user_id.clone(),
                        picture_file_id: picture,
                    },
                );
            }
        }
        for participant in roster.iter().flat_map(|roster| &roster.participants) {
            let (jids, whatsapp_name, seen) = self.member(&participant.identity);
            let Some(name) = self.name(&jids, whatsapp_name) else {
                continue;
            };
            let picture = self.picture(&jids);
            for jid in jids {
                people.learn(
                    jid,
                    ExternalChatPersonRef {
                        name: name.clone(),
                        user_id: seen.and_then(|person| person.user_id.clone()),
                        picture_file_id: picture,
                    },
                );
            }
        }
        people
    }

    /// Names every member of `roster` that has a name, with the pictures of
    /// those that have one, by their roster JID.
    pub fn name_members(&self, mut roster: GroupInfo) -> ChatRoster {
        let mut pictures = HashMap::new();
        for participant in &mut roster.participants {
            let (jids, whatsapp_name, _) = self.member(&participant.identity);
            let name = self.name(&jids, whatsapp_name);
            if let Some(picture) = self.picture(&jids) {
                pictures.insert(participant.identity.jid.clone(), picture);
            }
            participant.identity.display_name = name;
        }
        ChatRoster {
            info: roster,
            pictures,
        }
    }
}

/// A chat's roster with its members named.
#[derive(Debug, Clone)]
pub struct ChatRoster {
    /// The roster; each member's display name is what to call them.
    pub info: GroupInfo,
    /// Members' pictures as the owner's account sees them, by roster JID.
    pub pictures: HashMap<String, Uuid>,
}

impl ChatRoster {
    /// The picture of the member with this roster JID.
    pub fn picture(&self, jid: &str) -> Option<Uuid> {
        self.pictures.get(jid).copied()
    }
}
