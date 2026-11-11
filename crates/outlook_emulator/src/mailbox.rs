//! One mailbox: folders, messages, categories, rules, contacts, and the
//! change sequence that delta queries and change notifications read.

use std::collections::{BTreeMap, HashMap, VecDeque};

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::EmulatorError;
use crate::error::GraphError;
use crate::seed::{NewMessage, SeedMailbox};

/// Graph's limit for one application and mailbox.
const GRAPH_REQUESTS_PER_TEN_MINUTES: u32 = 10_000;
const THROTTLE_WINDOW_MS: i64 = 600_000;
const DAY_MS: i64 = 86_400_000;

/// `PidTagInternetReferences` and `PidTagInReplyToId`, which a draft's reply
/// headers are written to.
pub(crate) const REFERENCES_PROPERTY: &str = "String 0x1039";
pub(crate) const IN_REPLY_TO_PROPERTY: &str = "String 0x1042";
/// `PidTagMessageFlags`, as Graph spells it in responses.
pub(crate) const MESSAGE_FLAGS_PROPERTY: &str = "Integer 0xe07";

const WELL_KNOWN_FOLDERS: [(&str, &str); 7] = [
    ("inbox", "Inbox"),
    ("drafts", "Drafts"),
    ("sentitems", "Sent Items"),
    ("deleteditems", "Deleted Items"),
    ("junkemail", "Junk Email"),
    ("outbox", "Outbox"),
    ("archive", "Archive"),
];
const ROOT_FOLDER: &str = "msgfolderroot";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Address {
    pub(crate) address: String,
    pub(crate) name: Option<String>,
}

impl Address {
    /// Graph fills a missing name with the address.
    pub(crate) fn json(&self) -> Value {
        json!({"emailAddress": {
            "name": self.name.as_deref().unwrap_or(&self.address),
            "address": self.address,
        }})
    }

    pub(crate) fn from_json(value: &Value) -> Option<Self> {
        let address = value.pointer("/emailAddress/address")?.as_str()?;
        let name = value
            .pointer("/emailAddress/name")
            .and_then(Value::as_str)
            .filter(|name| !name.is_empty());
        Some(Self {
            address: address.to_string(),
            name: name.map(str::to_string),
        })
    }

    pub(crate) fn header(&self) -> String {
        match &self.name {
            Some(name) => format!("{name} <{}>", self.address),
            None => self.address.clone(),
        }
    }

    /// The addresses of a header value such as `Ada <ada@example.com>, b@c.d`.
    pub(crate) fn parse_list(header: &str) -> Result<Vec<Self>, EmulatorError> {
        let invalid = || EmulatorError::InvalidMessage(format!("not an address list: {header}"));
        let parsed = mailparse::addrparse(header).map_err(|_| invalid())?;
        let mut addresses = Vec::new();
        for entry in parsed.iter() {
            let singles = match entry {
                mailparse::MailAddr::Single(single) => std::slice::from_ref(single),
                mailparse::MailAddr::Group(group) => group.addrs.as_slice(),
            };
            for single in singles {
                addresses.push(Self {
                    address: single.addr.clone(),
                    name: single.display_name.clone().filter(|name| !name.is_empty()),
                });
            }
        }
        if addresses.is_empty() {
            return Err(invalid());
        }
        Ok(addresses)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BodyType {
    Html,
    Text,
}

#[derive(Clone, Debug)]
pub(crate) struct Attachment {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) content_type: String,
    pub(crate) bytes: Vec<u8>,
    pub(crate) content_id: Option<String>,
    pub(crate) inline: bool,
    pub(crate) modified: DateTime<Utc>,
}

#[derive(Clone, Debug)]
pub(crate) struct Message {
    pub(crate) id: String,
    pub(crate) conversation_id: String,
    pub(crate) folder_id: String,
    /// Bumped on every change; the etag and change key are made from it.
    pub(crate) version: u64,
    /// The mailbox sequence number of its last change.
    pub(crate) changed_seq: u64,
    pub(crate) internet_message_id: String,
    pub(crate) subject: String,
    pub(crate) body_type: BodyType,
    pub(crate) body: String,
    pub(crate) from: Option<Address>,
    pub(crate) to: Vec<Address>,
    pub(crate) cc: Vec<Address>,
    pub(crate) bcc: Vec<Address>,
    pub(crate) reply_to: Vec<Address>,
    pub(crate) is_read: bool,
    pub(crate) is_draft: bool,
    pub(crate) flagged: bool,
    pub(crate) categories: Vec<String>,
    /// Focused Inbox: `focused`, or `other` when false.
    pub(crate) focused: bool,
    pub(crate) received: DateTime<Utc>,
    pub(crate) sent: Option<DateTime<Utc>>,
    pub(crate) created: DateTime<Utc>,
    pub(crate) modified: DateTime<Utc>,
    /// `internetMessageHeaders`: empty for a draft.
    pub(crate) headers: Vec<(String, String)>,
    /// Extended properties a client wrote, by id.
    pub(crate) properties: BTreeMap<String, String>,
    pub(crate) attachments: Vec<Attachment>,
    /// Sent by the mailbox owner (`mfFromMe`), which survives folder moves.
    pub(crate) from_me: bool,
    /// An iCalendar body: the message is a meeting request.
    pub(crate) calendar: Option<String>,
}

impl Message {
    pub(crate) fn change_key(&self) -> String {
        format!(
            "CQAAABYAAAA{}",
            URL_SAFE_NO_PAD.encode(format!("{:012}", self.version))
        )
    }

    pub(crate) fn etag(&self) -> String {
        format!("W/\"{}\"", self.change_key())
    }

    /// `PidTagMessageFlags`: read 0x1, unsent 0x8, has attachments 0x10,
    /// from me 0x20.
    pub(crate) fn message_flags(&self) -> u32 {
        let mut flags = 0;
        if self.is_read {
            flags |= 0x1;
        }
        if self.is_draft {
            flags |= 0x8;
        }
        if !self.attachments.is_empty() {
            flags |= 0x10;
        }
        if self.from_me {
            flags |= 0x20;
        }
        flags
    }

    /// The value of an extended property, written or computed.
    pub(crate) fn property(&self, id: &str) -> Option<String> {
        if id.eq_ignore_ascii_case("Integer 0x0E07")
            || id.eq_ignore_ascii_case(MESSAGE_FLAGS_PROPERTY)
        {
            return Some(self.message_flags().to_string());
        }
        self.properties
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(id))
            .map(|(_, value)| value.clone())
    }

    pub(crate) fn plain_text(&self) -> String {
        match self.body_type {
            BodyType::Text => self.body.clone(),
            BodyType::Html => strip_tags(&self.body),
        }
    }
}

/// The text of an HTML body, for `bodyPreview`.
fn strip_tags(html: &str) -> String {
    let mut text = String::new();
    let mut in_tag = false;
    for character in html.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                text.push(' ');
            }
            other if !in_tag => text.push(other),
            _ => {}
        }
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[derive(Clone, Debug)]
pub(crate) struct Folder {
    pub(crate) id: String,
    pub(crate) name: String,
    /// `None` only for the mailbox root.
    pub(crate) parent: Option<String>,
    pub(crate) well_known: Option<&'static str>,
    pub(crate) properties: BTreeMap<String, String>,
}

#[derive(Clone, Debug)]
pub(crate) struct Category {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) color: String,
}

#[derive(Clone, Debug)]
pub(crate) struct Contact {
    pub(crate) id: String,
    pub(crate) name: Option<String>,
    pub(crate) emails: Vec<String>,
    pub(crate) changed_seq: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ChangeKind {
    Created,
    Updated,
    Deleted,
}

/// A message change, for the subscriptions watching the mailbox.
#[derive(Clone, Debug)]
pub(crate) struct Change {
    pub(crate) kind: ChangeKind,
    pub(crate) message_id: String,
    pub(crate) folder_id: String,
    pub(crate) etag: String,
}

/// Where a folder's delta round stands. A skip token and a delta token both
/// carry one.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct DeltaCursor {
    /// The folder id.
    pub(crate) f: String,
    /// Changes up to this sequence number were already reported.
    pub(crate) s: u64,
    /// The sequence number the round reads up to.
    pub(crate) n: u64,
    /// The last entry of the previous page.
    pub(crate) a: Option<(u64, String)>,
    /// The mailbox's sync state generation when the token was made.
    pub(crate) e: u64,
    /// When the token was made, in emulator milliseconds.
    pub(crate) t: i64,
    /// The round's `$select`.
    pub(crate) q: Option<String>,
    /// The round's page size.
    pub(crate) p: usize,
}

pub(crate) enum DeltaEntry<'a> {
    Changed(&'a Message),
    Removed(String),
}

pub(crate) struct DeltaPage<'a> {
    pub(crate) entries: Vec<DeltaEntry<'a>>,
    pub(crate) cursor: DeltaCursor,
    /// Whether the round is over, so `cursor` is a delta token.
    pub(crate) done: bool,
}

pub(crate) struct Mailbox {
    pub(crate) user_id: String,
    pub(crate) tenant_id: String,
    pub(crate) email: String,
    pub(crate) name: String,
    pub(crate) refresh_token: String,
    pub(crate) revoked: bool,
    /// The sequence number of the last change.
    pub(crate) seq: u64,
    /// Bumped when the mailbox's sync state is dropped, which expires every
    /// delta token.
    pub(crate) delta_epoch: u64,
    delta_token_lifetime_ms: Option<i64>,
    next_id: u64,
    pub(crate) folders: Vec<Folder>,
    pub(crate) messages: BTreeMap<String, Message>,
    /// Messages that left a folder: sequence number, folder, message.
    removed: Vec<(u64, String, String)>,
    /// The conversation of each `Message-ID` the mailbox has seen.
    conversations: HashMap<String, String>,
    pub(crate) categories: Vec<Category>,
    pub(crate) rules: Vec<Value>,
    pub(crate) contact_folder_id: String,
    pub(crate) contacts: BTreeMap<String, Contact>,
    removed_contacts: Vec<(u64, String)>,
    pub(crate) photo: Option<(String, Vec<u8>)>,
    requests_per_ten_minutes: u32,
    window: VecDeque<i64>,
    /// Changes not yet turned into notifications.
    pub(crate) changes: Vec<Change>,
}

impl Mailbox {
    pub(crate) fn new(seed: &SeedMailbox, now: DateTime<Utc>) -> Result<Self, EmulatorError> {
        let email = seed.email.to_lowercase();
        let user_id = uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_DNS, email.as_bytes());
        let tenant_id = uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_DNS, b"outlook-emulator-tenant");
        let mut mailbox = Self {
            user_id: user_id.to_string(),
            tenant_id: tenant_id.to_string(),
            name: seed.name.clone().unwrap_or_else(|| email.clone()),
            refresh_token: seed
                .refresh_token
                .clone()
                .unwrap_or_else(|| format!("refresh-{email}")),
            email,
            revoked: false,
            seq: 0,
            delta_epoch: 0,
            delta_token_lifetime_ms: seed
                .delta_token_lifetime_days
                .map(|days| i64::from(days) * DAY_MS),
            next_id: 0,
            folders: Vec::new(),
            messages: BTreeMap::new(),
            removed: Vec::new(),
            conversations: HashMap::new(),
            categories: Vec::new(),
            rules: Vec::new(),
            contact_folder_id: String::new(),
            contacts: BTreeMap::new(),
            removed_contacts: Vec::new(),
            photo: None,
            requests_per_ten_minutes: seed
                .requests_per_ten_minutes
                .unwrap_or(GRAPH_REQUESTS_PER_TEN_MINUTES),
            window: VecDeque::new(),
            changes: Vec::new(),
        };

        let root = mailbox.new_id("folder");
        mailbox.folders.push(Folder {
            id: root.clone(),
            name: "Top of Information Store".to_string(),
            parent: None,
            well_known: Some(ROOT_FOLDER),
            properties: BTreeMap::new(),
        });
        for (well_known, name) in WELL_KNOWN_FOLDERS {
            if well_known == "archive" && seed.without_archive_folder {
                continue;
            }
            let id = mailbox.new_id("folder");
            mailbox.folders.push(Folder {
                id,
                name: name.to_string(),
                parent: Some(root.clone()),
                well_known: Some(well_known),
                properties: BTreeMap::new(),
            });
        }
        for folder in &seed.folders {
            let parent = match &folder.parent {
                Some(parent) => mailbox
                    .folder(parent)
                    .map(|parent| parent.id.clone())
                    .ok_or_else(|| EmulatorError::UnknownFolder(parent.clone()))?,
                None => root.clone(),
            };
            mailbox
                .create_folder(&folder.name, &parent, BTreeMap::new())
                .map_err(|error| EmulatorError::InvalidMessage(error.message))?;
        }

        mailbox.contact_folder_id = mailbox.new_id("contactfolder");
        for name in &seed.categories {
            mailbox.add_category(name, "preset0");
        }
        for contact in &seed.contacts {
            mailbox.upsert_contact(None, contact.name.clone(), vec![contact.email.clone()]);
        }
        for message in &seed.messages {
            mailbox.add_message(message, now)?;
        }
        // Seeding is not a change a subscriber could have watched.
        mailbox.changes.clear();
        Ok(mailbox)
    }

    /// An opaque id in the alphabet of Graph's immutable ids.
    pub(crate) fn new_id(&mut self, kind: &str) -> String {
        self.next_id += 1;
        let plain = format!("{}/{kind}/{:06}", self.email, self.next_id);
        format!("AAMkAD{}", URL_SAFE_NO_PAD.encode(plain))
    }

    // -- folders --

    /// A folder by id, well-known name, or (for seeds) display name.
    pub(crate) fn folder(&self, key: &str) -> Option<&Folder> {
        let by_id = self.folders.iter().find(|folder| folder.id == key);
        let by_well_known = || {
            self.folders.iter().find(|folder| {
                folder
                    .well_known
                    .is_some_and(|name| name.eq_ignore_ascii_case(key))
            })
        };
        let by_name = || self.folders.iter().find(|folder| folder.name == key);
        by_id.or_else(by_well_known).or_else(by_name)
    }

    pub(crate) fn well_known(&self, name: &str) -> Option<&Folder> {
        self.folders
            .iter()
            .find(|folder| folder.well_known == Some(name))
    }

    fn well_known_id(&self, name: &str) -> Result<String, GraphError> {
        self.well_known(name)
            .map(|folder| folder.id.clone())
            .ok_or_else(GraphError::item_not_found)
    }

    pub(crate) fn child_folders(&self, parent: &str) -> Vec<&Folder> {
        self.folders
            .iter()
            .filter(|folder| folder.parent.as_deref() == Some(parent))
            .collect()
    }

    pub(crate) fn create_folder(
        &mut self,
        name: &str,
        parent: &str,
        properties: BTreeMap<String, String>,
    ) -> Result<Folder, GraphError> {
        let taken = self
            .child_folders(parent)
            .iter()
            .any(|folder| folder.name.eq_ignore_ascii_case(name));
        if taken {
            return Err(GraphError::folder_exists());
        }
        let folder = Folder {
            id: self.new_id("folder"),
            name: name.to_string(),
            parent: Some(parent.to_string()),
            well_known: None,
            properties,
        };
        self.folders.push(folder.clone());
        Ok(folder)
    }

    // -- messages --

    fn next_seq(&mut self) -> u64 {
        self.seq += 1;
        self.seq
    }

    fn record(&mut self, kind: ChangeKind, message: &Message) {
        self.changes.push(Change {
            kind,
            message_id: message.id.clone(),
            folder_id: message.folder_id.clone(),
            etag: message.etag(),
        });
    }

    /// The conversation a message with these reply headers joins.
    pub(crate) fn conversation_of(&mut self, replies_to: &[String]) -> String {
        let known = replies_to
            .iter()
            .find_map(|id| self.conversations.get(bare_message_id(id)).cloned());
        known.unwrap_or_else(|| self.new_id("conversation"))
    }

    /// Stores a new message and reports it as created.
    pub(crate) fn insert(&mut self, mut message: Message) -> String {
        message.changed_seq = self.next_seq();
        self.conversations.insert(
            bare_message_id(&message.internet_message_id).to_string(),
            message.conversation_id.clone(),
        );
        self.record(ChangeKind::Created, &message);
        let id = message.id.clone();
        self.messages.insert(id.clone(), message);
        id
    }

    /// Marks a message as changed, after mutating it.
    pub(crate) fn touch(&mut self, id: &str, now: DateTime<Utc>) {
        let seq = self.next_seq();
        let Some(message) = self.messages.get_mut(id) else {
            return;
        };
        message.version += 1;
        message.changed_seq = seq;
        message.modified = now;
        let message = message.clone();
        self.record(ChangeKind::Updated, &message);
    }

    pub(crate) fn move_message(
        &mut self,
        id: &str,
        folder: &str,
        now: DateTime<Utc>,
    ) -> Result<(), GraphError> {
        let destination = self
            .folder(folder)
            .map(|folder| folder.id.clone())
            .ok_or_else(GraphError::item_not_found)?;
        let message = self
            .messages
            .get_mut(id)
            .ok_or_else(GraphError::item_not_found)?;
        let source = std::mem::replace(&mut message.folder_id, destination.clone());
        if source != destination {
            let seq = self.next_seq();
            self.removed.push((seq, source, id.to_string()));
        }
        self.touch(id, now);
        Ok(())
    }

    /// Deletes a message for good.
    pub(crate) fn remove_message(&mut self, id: &str) -> Result<(), GraphError> {
        let message = self
            .messages
            .remove(id)
            .ok_or_else(GraphError::item_not_found)?;
        let seq = self.next_seq();
        self.removed
            .push((seq, message.folder_id.clone(), message.id.clone()));
        self.record(ChangeKind::Deleted, &message);
        Ok(())
    }

    /// Builds and stores a seeded or delivered message.
    pub(crate) fn add_message(
        &mut self,
        new: &NewMessage,
        now: DateTime<Utc>,
    ) -> Result<String, EmulatorError> {
        let folder_key = new.folder.as_deref().unwrap_or("inbox");
        let folder = self
            .folder(folder_key)
            .ok_or_else(|| EmulatorError::UnknownFolder(folder_key.to_string()))?;
        let folder_id = folder.id.clone();
        let is_draft = folder.well_known == Some("drafts");
        let is_sent = folder.well_known == Some("sentitems");
        let in_inbox = folder.well_known == Some("inbox");

        let owner = Address {
            address: self.email.clone(),
            name: Some(self.name.clone()),
        };
        let from = match &new.from {
            Some(from) => Address::parse_list(from)?.into_iter().next(),
            None if is_draft || is_sent => Some(owner.clone()),
            None => Some(Address {
                address: "sender@emulator.example".to_string(),
                name: Some("Emulator Sender".to_string()),
            }),
        };
        let to = match &new.to {
            Some(to) => Address::parse_list(to)?,
            None if is_draft => Vec::new(),
            None => vec![owner],
        };
        let cc = match &new.cc {
            Some(cc) => Address::parse_list(cc)?,
            None => Vec::new(),
        };

        let date = new.date.unwrap_or(now);
        let id = self.new_id("message");
        let internet_message_id = match &new.message_id {
            Some(message_id) => format!("<{}>", bare_message_id(message_id)),
            None => format!("<{}@emulator.example>", id.to_lowercase()),
        };
        let replies_to: Vec<String> = new.in_reply_to.iter().cloned().collect();
        let conversation_id = match &new.conversation_id {
            Some(conversation) => conversation.clone(),
            None => self.conversation_of(&replies_to),
        };
        let (body_type, body) = match (&new.html, &new.text) {
            (Some(html), _) => (BodyType::Html, normalize_html(html)),
            (None, text) => (BodyType::Text, text.clone().unwrap_or_default()),
        };
        let from_me = is_sent
            || from
                .as_ref()
                .is_some_and(|from| from.address.eq_ignore_ascii_case(&self.email));

        let mut attachments = Vec::new();
        for attachment in &new.attachments {
            let bytes = match (&attachment.base64, &attachment.text) {
                (Some(encoded), _) => STANDARD.decode(encoded).map_err(|_| {
                    EmulatorError::InvalidMessage(format!(
                        "attachment {} is not base64",
                        attachment.filename
                    ))
                })?,
                (None, text) => text.clone().unwrap_or_default().into_bytes(),
            };
            attachments.push(Attachment {
                id: self.new_id("attachment"),
                name: attachment.filename.clone(),
                content_type: attachment
                    .mime_type
                    .clone()
                    .unwrap_or_else(|| "application/octet-stream".to_string()),
                bytes,
                inline: attachment.content_id.is_some(),
                content_id: attachment.content_id.clone(),
                modified: date,
            });
        }

        let mut message = Message {
            id,
            conversation_id,
            folder_id,
            version: 1,
            changed_seq: 0,
            internet_message_id,
            subject: new.subject.clone().unwrap_or_default(),
            body_type,
            body,
            from,
            to,
            cc,
            bcc: Vec::new(),
            reply_to: Vec::new(),
            is_read: new.read.unwrap_or(!in_inbox),
            is_draft,
            flagged: new.flagged,
            categories: new.categories.clone(),
            focused: !new.other,
            received: date,
            sent: Some(date),
            created: date,
            modified: date,
            headers: Vec::new(),
            properties: BTreeMap::new(),
            attachments,
            from_me,
            calendar: new.calendar.clone(),
        };
        if let Some(parent) = &new.in_reply_to {
            let parent = format!("<{}>", bare_message_id(parent));
            message
                .properties
                .insert(IN_REPLY_TO_PROPERTY.to_string(), parent.clone());
            message
                .properties
                .insert(REFERENCES_PROPERTY.to_string(), parent);
        }
        if !is_draft {
            message.headers = transport_headers(&message);
        }
        Ok(self.insert(message))
    }

    // -- delta --

    /// The first cursor of a folder's delta round.
    pub(crate) fn delta_start(
        &self,
        folder: &str,
        select: Option<String>,
        page_size: usize,
        now_ms: i64,
    ) -> DeltaCursor {
        DeltaCursor {
            f: folder.to_string(),
            s: 0,
            n: self.seq,
            a: None,
            e: self.delta_epoch,
            t: now_ms,
            q: select,
            p: page_size,
        }
    }

    /// Whether Graph still holds the sync state a token names.
    pub(crate) fn delta_token_valid(&self, cursor: &DeltaCursor, now_ms: i64) -> bool {
        let fresh = self
            .delta_token_lifetime_ms
            .is_none_or(|lifetime| now_ms - cursor.t <= lifetime);
        cursor.e == self.delta_epoch && cursor.n <= self.seq && fresh
    }

    /// Drops the mailbox's sync state: every delta token now answers 410.
    pub(crate) fn expire_delta_tokens(&mut self) {
        self.delta_epoch += 1;
    }

    /// One page of a folder's changes. A cursor without a position starts a
    /// new round from its delta token, reading up to the present.
    pub(crate) fn folder_delta(&self, mut cursor: DeltaCursor, now_ms: i64) -> DeltaPage<'_> {
        if cursor.a.is_none() && cursor.n < self.seq && cursor.s == cursor.n {
            cursor.n = self.seq;
            cursor.t = now_ms;
        }
        let in_round = |seq: u64| seq > cursor.s && seq <= cursor.n;

        let mut entries: Vec<(u64, &str, Option<&Message>)> = self
            .messages
            .values()
            .filter(|message| message.folder_id == cursor.f && in_round(message.changed_seq))
            .map(|message| (message.changed_seq, message.id.as_str(), Some(message)))
            .collect();
        // A first sync lists what the folder holds; it has no removals.
        if cursor.s > 0 {
            let mut removals: BTreeMap<&str, u64> = BTreeMap::new();
            for (seq, folder, message) in &self.removed {
                let back = self.messages.get(message).is_some_and(|current| {
                    current.folder_id == cursor.f && current.changed_seq <= cursor.n
                });
                if folder == &cursor.f && in_round(*seq) && !back {
                    removals.insert(message.as_str(), *seq);
                }
            }
            entries.extend(removals.into_iter().map(|(id, seq)| (seq, id, None)));
        }
        entries.sort_by(|a, b| (a.0, a.1).cmp(&(b.0, b.1)));

        let after = cursor.a.clone();
        let mut remaining = entries
            .into_iter()
            .filter(|(seq, id, _)| {
                after
                    .as_ref()
                    .is_none_or(|(last_seq, last_id)| (*seq, *id) > (*last_seq, last_id.as_str()))
            })
            .peekable();

        let mut page = Vec::new();
        let mut last = None;
        while page.len() < cursor.p.max(1) {
            let Some((seq, id, message)) = remaining.next() else {
                break;
            };
            last = Some((seq, id.to_string()));
            page.push(match message {
                Some(message) => DeltaEntry::Changed(message),
                None => DeltaEntry::Removed(id.to_string()),
            });
        }

        let done = remaining.peek().is_none();
        if done {
            cursor.s = cursor.n;
            cursor.a = None;
        } else {
            cursor.a = last;
        }
        DeltaPage {
            entries: page,
            cursor,
            done,
        }
    }

    // -- categories and contacts --

    pub(crate) fn add_category(&mut self, name: &str, color: &str) -> Category {
        let category = Category {
            id: uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, name.as_bytes()).to_string(),
            name: name.to_string(),
            color: color.to_string(),
        };
        self.categories.push(category.clone());
        category
    }

    /// Adds a contact, or changes the one with this id.
    pub(crate) fn upsert_contact(
        &mut self,
        id: Option<String>,
        name: Option<String>,
        emails: Vec<String>,
    ) -> String {
        let id = id.unwrap_or_else(|| self.new_id("contact"));
        let changed_seq = self.next_seq();
        self.contacts.insert(
            id.clone(),
            Contact {
                id: id.clone(),
                name,
                emails,
                changed_seq,
            },
        );
        id
    }

    pub(crate) fn remove_contact(&mut self, id: &str) -> bool {
        if self.contacts.remove(id).is_none() {
            return false;
        }
        let seq = self.next_seq();
        self.removed_contacts.push((seq, id.to_string()));
        true
    }

    /// Contacts changed and removed after a sequence number.
    pub(crate) fn contact_changes(&self, since: u64) -> (Vec<&Contact>, Vec<&str>) {
        let changed = self
            .contacts
            .values()
            .filter(|contact| contact.changed_seq > since)
            .collect();
        let removed = self
            .removed_contacts
            .iter()
            .filter(|(seq, id)| since > 0 && *seq > since && !self.contacts.contains_key(id))
            .map(|(_, id)| id.as_str())
            .collect();
        (changed, removed)
    }

    // -- throttling --

    /// Counts a request against the mailbox's ten-minute limit. When over
    /// it, answers the seconds until the oldest request leaves the window.
    pub(crate) fn admit(&mut self, now_ms: i64) -> Result<(), u64> {
        while self
            .window
            .front()
            .is_some_and(|at| now_ms - at >= THROTTLE_WINDOW_MS)
        {
            self.window.pop_front();
        }
        if self.window.len() >= self.requests_per_ten_minutes as usize {
            let oldest = self.window.front().copied().unwrap_or(now_ms);
            let wait_ms = (oldest + THROTTLE_WINDOW_MS - now_ms).max(1000);
            return Err(u64::try_from(wait_ms).unwrap_or(1000).div_ceil(1000));
        }
        self.window.push_back(now_ms);
        Ok(())
    }

    // -- sending --

    /// Turns a draft into a sent message in Sent Items. The id stays, as
    /// with immutable ids.
    pub(crate) fn mark_sent(
        &mut self,
        id: &str,
        now: DateTime<Utc>,
    ) -> Result<Message, GraphError> {
        let sent_items = self.well_known_id("sentitems")?;
        let owner = Address {
            address: self.email.clone(),
            name: Some(self.name.clone()),
        };
        let message = self
            .messages
            .get_mut(id)
            .ok_or_else(GraphError::item_not_found)?;
        if !message.is_draft {
            return Err(GraphError::invalid_request(
                "The message is not a draft and cannot be sent.",
            ));
        }
        if message.to.is_empty() && message.cc.is_empty() && message.bcc.is_empty() {
            return Err(GraphError::invalid_request(
                "At least one recipient is required.",
            ));
        }
        message.is_draft = false;
        message.is_read = true;
        message.from_me = true;
        message.from.get_or_insert(owner);
        message.sent = Some(now);
        message.received = now;
        message.headers = transport_headers(message);
        let sent = message.clone();
        self.move_message(id, &sent_items, now)?;
        Ok(sent)
    }

    /// Puts a copy of a message another mailbox sent into the inbox.
    pub(crate) fn receive(&mut self, sent: &Message, now: DateTime<Utc>) -> String {
        let mut replies_to = Vec::new();
        for property in [IN_REPLY_TO_PROPERTY, REFERENCES_PROPERTY] {
            if let Some(value) = sent.property(property) {
                replies_to.extend(value.split_whitespace().map(str::to_string));
            }
        }
        let inbox = self
            .well_known("inbox")
            .map(|folder| folder.id.clone())
            .unwrap_or_default();
        let attachments = sent
            .attachments
            .iter()
            .map(|attachment| Attachment {
                id: self.new_id("attachment"),
                ..attachment.clone()
            })
            .collect();
        let message = Message {
            id: self.new_id("message"),
            conversation_id: self.conversation_of(&replies_to),
            folder_id: inbox,
            version: 1,
            changed_seq: 0,
            is_read: false,
            is_draft: false,
            flagged: false,
            categories: Vec::new(),
            focused: true,
            bcc: Vec::new(),
            received: now,
            created: now,
            modified: now,
            from_me: false,
            attachments,
            ..sent.clone()
        };
        self.insert(message)
    }
}

/// A `Message-ID` without its angle brackets.
pub(crate) fn bare_message_id(id: &str) -> &str {
    id.trim().trim_start_matches('<').trim_end_matches('>')
}

/// Exchange stores an HTML body as a whole document.
pub(crate) fn normalize_html(html: &str) -> String {
    if html.to_ascii_lowercase().contains("<html") {
        return html.to_string();
    }
    format!(
        "<html><head>\r\n<meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\"></head><body>{html}</body></html>"
    )
}

/// The headers Graph reports for a message that went through transport.
pub(crate) fn transport_headers(message: &Message) -> Vec<(String, String)> {
    let mut headers = vec![
        ("MIME-Version".to_string(), "1.0".to_string()),
        (
            "Date".to_string(),
            message.sent.unwrap_or(message.received).to_rfc2822(),
        ),
        (
            "Message-ID".to_string(),
            message.internet_message_id.clone(),
        ),
        ("Subject".to_string(), message.subject.clone()),
    ];
    if let Some(from) = &message.from {
        headers.push(("From".to_string(), from.header()));
    }
    if !message.to.is_empty() {
        let to: Vec<String> = message.to.iter().map(Address::header).collect();
        headers.push(("To".to_string(), to.join(", ")));
    }
    if let Some(parent) = message.property(IN_REPLY_TO_PROPERTY) {
        headers.push(("In-Reply-To".to_string(), parent));
    }
    if let Some(references) = message.property(REFERENCES_PROPERTY) {
        headers.push(("References".to_string(), references));
    }
    headers
}
