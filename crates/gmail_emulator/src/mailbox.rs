//! One mailbox: its messages, labels and history, and the changes Gmail lets
//! a client or the mailbox's owner make to them.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde_json::{Value, json};

use crate::error::ApiError;
use crate::mime::{self, Format, Parsed};
use crate::people::ContactBook;
use crate::seed::{SeedMailbox, SeedSendAs};

/// Gmail's system labels, in the order `labels.list` returns them.
const SYSTEM_LABELS: [&str; 14] = [
    "CHAT",
    "SENT",
    "INBOX",
    "IMPORTANT",
    "TRASH",
    "DRAFT",
    "SPAM",
    "CATEGORY_FORUMS",
    "CATEGORY_UPDATES",
    "CATEGORY_PERSONAL",
    "CATEGORY_PROMOTIONS",
    "CATEGORY_SOCIAL",
    "STARRED",
    "UNREAD",
];
/// Labels only Gmail sets.
const IMMUTABLE_LABELS: [&str; 2] = ["SENT", "DRAFT"];
/// The scopes Macro asks a Gmail link for.
pub(crate) const DEFAULT_SCOPES: [&str; 8] = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.settings.basic",
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/contacts.other.readonly",
    "https://www.googleapis.com/auth/calendar",
];
const DEFAULT_HISTORY_ID: u64 = 1000;
/// Gmail keeps history for about a week.
pub(crate) const HISTORY_RETENTION_MS: i64 = 7 * 24 * 60 * 60 * 1000;
/// A watch lasts seven days unless renewed.
const WATCH_LIFETIME_MS: i64 = 7 * 24 * 60 * 60 * 1000;
const QUOTA_WINDOW_MS: i64 = 60_000;

/// Source of message and thread ids, shared by every mailbox so an id names
/// one message across the emulator.
#[derive(Debug)]
pub(crate) struct Ids {
    next: u64,
}

impl Default for Ids {
    fn default() -> Self {
        Self {
            next: 0x19a7_0000_0000_0000,
        }
    }
}

impl Ids {
    /// The next id, shaped like Gmail's 16 hex digits.
    pub(crate) fn next(&mut self) -> String {
        self.next += 1;
        format!("{:016x}", self.next)
    }

    pub(crate) fn nonce(&mut self) -> u64 {
        self.next += 1;
        self.next
    }
}

#[derive(Clone, Debug)]
pub(crate) struct StoredMessage {
    pub(crate) id: String,
    pub(crate) thread_id: String,
    pub(crate) labels: BTreeSet<String>,
    pub(crate) raw: Vec<u8>,
    pub(crate) parsed: Parsed,
    pub(crate) internal_date_ms: i64,
    pub(crate) history_id: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Change {
    MessageAdded,
    MessageDeleted,
    LabelsAdded(Vec<String>),
    LabelsRemoved(Vec<String>),
}

impl Change {
    /// The `historyTypes` value that selects this change.
    fn history_type(&self) -> &'static str {
        match self {
            Self::MessageAdded => "messageAdded",
            Self::MessageDeleted => "messageDeleted",
            Self::LabelsAdded(_) => "labelAdded",
            Self::LabelsRemoved(_) => "labelRemoved",
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct HistoryRecord {
    pub(crate) id: u64,
    at_ms: i64,
    message_id: String,
    thread_id: String,
    /// The message's labels after the change.
    labels: Vec<String>,
    pub(crate) change: Change,
}

#[derive(Clone, Debug)]
pub(crate) struct Label {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) system: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct Watch {
    pub(crate) topic: String,
    pub(crate) expires_at_ms: i64,
}

#[derive(Debug)]
pub(crate) struct Mailbox {
    pub(crate) email: String,
    pub(crate) name: Option<String>,
    pub(crate) scopes: Vec<String>,
    pub(crate) refresh_token: String,
    /// A revoked grant refuses token refreshes and every access token.
    pub(crate) revoked: bool,
    pub(crate) messages: BTreeMap<String, StoredMessage>,
    pub(crate) labels: Vec<Label>,
    next_label: u32,
    pub(crate) history: Vec<HistoryRecord>,
    pub(crate) history_id: u64,
    /// `history.list` from before this id answers 404.
    pub(crate) history_floor: u64,
    /// The history id of the last push notification queued.
    pub(crate) notified_history_id: u64,
    pub(crate) filters: Vec<(String, Value)>,
    pub(crate) send_as: Vec<SeedSendAs>,
    /// Draft id to the id of the message holding its current revision.
    pub(crate) drafts: BTreeMap<String, String>,
    pub(crate) contacts: ContactBook,
    pub(crate) other_contacts: ContactBook,
    pub(crate) watch: Option<Watch>,
    quota_units_per_minute: Option<u32>,
    quota_spent: VecDeque<(i64, u32)>,
}

impl Mailbox {
    pub(crate) fn new(seed: &SeedMailbox) -> Self {
        let history_id = seed.history_id.unwrap_or(DEFAULT_HISTORY_ID);
        let mut mailbox = Self {
            email: seed.email.to_lowercase(),
            name: seed.name.clone(),
            scopes: seed
                .scopes
                .clone()
                .unwrap_or_else(|| DEFAULT_SCOPES.map(str::to_string).to_vec()),
            refresh_token: seed
                .refresh_token
                .clone()
                .unwrap_or_else(|| format!("refresh-{}", seed.email.to_lowercase())),
            revoked: false,
            messages: BTreeMap::new(),
            labels: SYSTEM_LABELS
                .iter()
                .map(|id| Label {
                    id: id.to_string(),
                    name: id.to_string(),
                    system: true,
                })
                .collect(),
            next_label: 1,
            history: Vec::new(),
            history_id,
            history_floor: history_id,
            notified_history_id: history_id,
            filters: Vec::new(),
            send_as: seed.send_as.clone(),
            drafts: BTreeMap::new(),
            contacts: ContactBook::new("people/c", &seed.contacts),
            other_contacts: ContactBook::new("otherContacts/c", &seed.other_contacts),
            watch: None,
            quota_units_per_minute: seed.quota_units_per_minute,
            quota_spent: VecDeque::new(),
        };

        for label in &seed.labels {
            mailbox.add_label(label.id.clone(), &label.name);
        }

        mailbox
    }

    pub(crate) fn has_scope(&self, scope: &str) -> bool {
        self.scopes.iter().any(|granted| granted == scope)
    }

    // -- labels --

    fn add_label(&mut self, id: Option<String>, name: &str) -> Label {
        let id = id.unwrap_or_else(|| {
            let id = format!("Label_{}", self.next_label);
            self.next_label += 1;
            id
        });
        let label = Label {
            id,
            name: name.to_string(),
            system: false,
        };
        self.labels.push(label.clone());
        label
    }

    pub(crate) fn label(&self, id: &str) -> Option<&Label> {
        self.labels.iter().find(|label| label.id == id)
    }

    pub(crate) fn create_label(&mut self, name: &str) -> Result<Label, ApiError> {
        if name.is_empty() {
            return Err(ApiError::invalid_argument("Invalid label name"));
        }
        if self
            .labels
            .iter()
            .any(|label| label.name.eq_ignore_ascii_case(name))
        {
            return Err(ApiError::conflict("Label name exists or conflicts"));
        }

        Ok(self.add_label(None, name))
    }

    pub(crate) fn rename_label(&mut self, id: &str, name: &str) -> Result<Label, ApiError> {
        let label = self
            .labels
            .iter_mut()
            .find(|label| label.id == id && !label.system)
            .ok_or_else(ApiError::not_found)?;
        label.name = name.to_string();
        Ok(label.clone())
    }

    /// Deletes a user label and takes it off every message. Gmail records no
    /// history for the removal.
    pub(crate) fn delete_label(&mut self, id: &str) -> Result<(), ApiError> {
        let index = self
            .labels
            .iter()
            .position(|label| label.id == id)
            .ok_or_else(ApiError::not_found)?;
        if self.labels[index].system {
            return Err(ApiError::invalid_argument("Invalid delete request"));
        }

        self.labels.remove(index);
        for message in self.messages.values_mut() {
            message.labels.remove(id);
        }
        Ok(())
    }

    // -- history --

    fn record(&mut self, now_ms: i64, message_id: &str, change: Change) -> u64 {
        self.history_id += 1;
        let id = self.history_id;
        if let Some(message) = self.messages.get_mut(message_id) {
            message.history_id = id;
            self.history.push(HistoryRecord {
                id,
                at_ms: now_ms,
                message_id: message.id.clone(),
                thread_id: message.thread_id.clone(),
                labels: message.labels.iter().cloned().collect(),
                change,
            });
        }
        id
    }

    /// Forgets history older than Gmail keeps it.
    pub(crate) fn prune_history(&mut self, now_ms: i64) {
        let cutoff = now_ms - HISTORY_RETENTION_MS;
        let expired = self
            .history
            .iter()
            .take_while(|record| record.at_ms < cutoff)
            .count();
        if let Some(last) = self.history.drain(..expired).last() {
            self.history_floor = last.id;
        }
    }

    /// Forgets all history, so every stored `startHistoryId` is too old.
    /// Nothing in the mailbox changed, so no watch is notified.
    pub(crate) fn expire_history(&mut self) {
        self.history.clear();
        self.history_id += 1;
        self.history_floor = self.history_id;
        self.notified_history_id = self.history_id;
    }

    /// `users.history.list`.
    pub(crate) fn list_history(
        &mut self,
        now_ms: i64,
        start: u64,
        types: &[String],
        label_id: Option<&str>,
        max_results: usize,
        offset: usize,
    ) -> Result<Value, ApiError> {
        self.prune_history(now_ms);
        if start < self.history_floor {
            return Err(ApiError::not_found());
        }

        let matching: Vec<&HistoryRecord> = self
            .history
            .iter()
            .filter(|record| record.id > start)
            .filter(|record| {
                types.is_empty()
                    || types
                        .iter()
                        .any(|kind| kind == record.change.history_type())
            })
            .filter(|record| {
                label_id.is_none_or(|label| record.labels.iter().any(|held| held == label))
            })
            .collect();
        let page: Vec<Value> = matching
            .iter()
            .skip(offset)
            .take(max_results)
            .map(|record| history_json(record))
            .collect();

        let mut response = json!({ "historyId": self.history_id.to_string() });
        if !page.is_empty() {
            response["history"] = Value::Array(page);
        }
        if offset + max_results < matching.len() {
            response["nextPageToken"] = json!((offset + max_results).to_string());
        }
        Ok(response)
    }

    // -- messages --

    /// The thread a new message joins: the one named, else the thread of a
    /// message it replies to, else none (a new thread).
    fn thread_for(
        &self,
        parsed: &Parsed,
        thread_id: Option<&str>,
    ) -> Result<Option<String>, ApiError> {
        if let Some(thread_id) = thread_id {
            return match self.thread(thread_id).is_empty() {
                true => Err(ApiError::not_found()),
                false => Ok(Some(thread_id.to_string())),
            };
        }

        Ok(self
            .messages
            .values()
            .find(|message| {
                message
                    .parsed
                    .message_id
                    .as_ref()
                    .is_some_and(|id| parsed.replies_to.contains(id))
            })
            .map(|message| message.thread_id.clone()))
    }

    /// Stores a message and records it in history.
    pub(crate) fn insert(
        &mut self,
        ids: &mut Ids,
        now_ms: i64,
        raw: Vec<u8>,
        labels: &[String],
        thread_id: Option<&str>,
        internal_date_ms: Option<i64>,
    ) -> Result<(String, String), ApiError> {
        let parsed =
            mime::parse(&raw).map_err(|error| ApiError::invalid_argument(&error.to_string()))?;
        for label in labels {
            if self.label(label).is_none() {
                return Err(ApiError::invalid_argument(&format!(
                    "Invalid label: {label}"
                )));
            }
        }

        let id = ids.next();
        let thread_id = self
            .thread_for(&parsed, thread_id)?
            .unwrap_or_else(|| id.clone());
        self.messages.insert(
            id.clone(),
            StoredMessage {
                id: id.clone(),
                thread_id: thread_id.clone(),
                labels: labels.iter().cloned().collect(),
                raw,
                parsed,
                internal_date_ms: internal_date_ms.unwrap_or(now_ms),
                history_id: self.history_id,
            },
        );
        self.record(now_ms, &id, Change::MessageAdded);
        Ok((id, thread_id))
    }

    /// The labels the mailbox's filters put on, and take off, an arriving
    /// message.
    pub(crate) fn filtered_labels(&self, raw: &[u8], labels: &mut BTreeSet<String>) {
        let Ok(parsed) = mime::parse(raw) else {
            return;
        };

        for (_, filter) in &self.filters {
            if !crate::query::filter_matches(&filter["criteria"], &parsed) {
                continue;
            }
            for label in label_list(&filter["action"]["addLabelIds"]) {
                labels.insert(label);
            }
            for label in label_list(&filter["action"]["removeLabelIds"]) {
                labels.remove(&label);
            }
        }
    }

    /// `users.messages.modify`: unknown and immutable labels are refused,
    /// and only real changes reach history.
    pub(crate) fn modify(
        &mut self,
        now_ms: i64,
        id: &str,
        add: &[String],
        remove: &[String],
    ) -> Result<(), ApiError> {
        self.check_labels(add, remove)?;
        let message = self.messages.get_mut(id).ok_or_else(ApiError::not_found)?;

        let added: Vec<String> = add
            .iter()
            .filter(|label| message.labels.insert((*label).clone()))
            .cloned()
            .collect();
        let removed: Vec<String> = remove
            .iter()
            .filter(|label| message.labels.remove(*label))
            .cloned()
            .collect();

        if !added.is_empty() {
            self.record(now_ms, id, Change::LabelsAdded(added));
        }
        if !removed.is_empty() {
            self.record(now_ms, id, Change::LabelsRemoved(removed));
        }
        Ok(())
    }

    pub(crate) fn check_labels(&self, add: &[String], remove: &[String]) -> Result<(), ApiError> {
        for label in add.iter().chain(remove) {
            if self.label(label).is_none() || IMMUTABLE_LABELS.contains(&label.as_str()) {
                return Err(ApiError::invalid_argument(&format!(
                    "Invalid label: {label}"
                )));
            }
        }
        Ok(())
    }

    /// Deletes a message for good, as `users.messages.delete` does.
    pub(crate) fn delete(&mut self, now_ms: i64, id: &str) -> Result<(), ApiError> {
        if !self.messages.contains_key(id) {
            return Err(ApiError::not_found());
        }

        self.record(now_ms, id, Change::MessageDeleted);
        self.messages.remove(id);
        self.drafts.retain(|_, message_id| message_id != id);
        Ok(())
    }

    /// A thread's messages, oldest first.
    pub(crate) fn thread(&self, thread_id: &str) -> Vec<&StoredMessage> {
        let mut messages: Vec<&StoredMessage> = self
            .messages
            .values()
            .filter(|message| message.thread_id == thread_id)
            .collect();
        messages.sort_by_key(|message| (message.internal_date_ms, message.id.clone()));
        messages
    }

    /// Messages matching a list request, newest first.
    pub(crate) fn search(
        &self,
        label_ids: &[String],
        query: Option<&crate::query::Query>,
        include_spam_trash: bool,
    ) -> Vec<&StoredMessage> {
        let names_spam_or_trash = label_ids
            .iter()
            .any(|label| label == "SPAM" || label == "TRASH")
            || query.is_some_and(crate::query::Query::names_spam_or_trash);
        let mut messages: Vec<&StoredMessage> = self
            .messages
            .values()
            .filter(|message| label_ids.iter().all(|label| message.labels.contains(label)))
            .filter(|message| {
                include_spam_trash
                    || names_spam_or_trash
                    || !(message.labels.contains("SPAM") || message.labels.contains("TRASH"))
            })
            .filter(|message| query.is_none_or(|query| query.matches(message, &self.labels)))
            .collect();
        messages.sort_by(|a, b| (b.internal_date_ms, &b.id).cmp(&(a.internal_date_ms, &a.id)));
        messages
    }

    pub(crate) fn thread_count(&self) -> usize {
        self.messages
            .values()
            .map(|message| &message.thread_id)
            .collect::<BTreeSet<_>>()
            .len()
    }

    // -- watch and quota --

    /// `users.watch`: (re)starts the watch and returns its expiry.
    pub(crate) fn start_watch(&mut self, now_ms: i64, topic: &str) -> i64 {
        let expires_at_ms = now_ms + WATCH_LIFETIME_MS;
        self.watch = Some(Watch {
            topic: topic.to_string(),
            expires_at_ms,
        });
        self.notified_history_id = self.history_id;
        expires_at_ms
    }

    /// The history id to notify the watch about, when it has moved since the
    /// last notification and the watch is live.
    pub(crate) fn take_notification(&mut self, now_ms: i64) -> Option<u64> {
        let watch = self.watch.as_ref()?;
        if watch.expires_at_ms <= now_ms || self.history_id == self.notified_history_id {
            return None;
        }

        self.notified_history_id = self.history_id;
        Some(self.history_id)
    }

    /// Spends quota units, or says how many seconds until they are free.
    pub(crate) fn spend_quota(&mut self, now_ms: i64, units: u32) -> Result<(), u64> {
        let Some(limit) = self.quota_units_per_minute else {
            return Ok(());
        };

        while self
            .quota_spent
            .front()
            .is_some_and(|(at_ms, _)| *at_ms <= now_ms - QUOTA_WINDOW_MS)
        {
            self.quota_spent.pop_front();
        }

        let spent: u32 = self.quota_spent.iter().map(|(_, units)| units).sum();
        if spent + units > limit {
            let oldest_ms = self.quota_spent.front().map_or(now_ms, |(at_ms, _)| *at_ms);
            let wait_ms = (oldest_ms + QUOTA_WINDOW_MS - now_ms).max(1);
            return Err(u64::try_from(wait_ms).unwrap_or(1).div_ceil(1000));
        }

        self.quota_spent.push_back((now_ms, units));
        Ok(())
    }
}

fn label_list(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|label| label.as_str().map(str::to_string))
        .collect()
}

fn history_json(record: &HistoryRecord) -> Value {
    let message = json!({ "id": record.message_id, "threadId": record.thread_id });
    let labelled = json!({
        "id": record.message_id,
        "threadId": record.thread_id,
        "labelIds": record.labels,
    });
    let mut value = json!({ "id": record.id.to_string(), "messages": [message] });

    match &record.change {
        Change::MessageAdded => value["messagesAdded"] = json!([{ "message": labelled }]),
        Change::MessageDeleted => value["messagesDeleted"] = json!([{ "message": labelled }]),
        Change::LabelsAdded(labels) => {
            value["labelsAdded"] = json!([{ "message": labelled, "labelIds": labels }]);
        }
        Change::LabelsRemoved(labels) => {
            value["labelsRemoved"] = json!([{ "message": labelled, "labelIds": labels }]);
        }
    }
    value
}

/// A label as Gmail's `Label` JSON.
pub(crate) fn label_json(label: &Label) -> Value {
    match label.system {
        true => json!({ "id": label.id, "name": label.name, "type": "system" }),
        false => json!({
            "id": label.id,
            "name": label.name,
            "type": "user",
            "messageListVisibility": "show",
            "labelListVisibility": "labelShow",
        }),
    }
}

/// A message as Gmail's `Message` JSON.
pub(crate) fn message_json(message: &StoredMessage, format: Format, nonce: u64) -> Value {
    let mut value = json!({
        "id": message.id,
        "threadId": message.thread_id,
        "labelIds": message.labels,
        "snippet": message.parsed.snippet,
        "historyId": message.history_id.to_string(),
        "internalDate": message.internal_date_ms.to_string(),
        "sizeEstimate": message.raw.len(),
    });

    match format {
        Format::Minimal => {}
        Format::Raw => value["raw"] = json!(mime::encode_body(&message.raw)),
        Format::Full | Format::Metadata => {
            value["payload"] = mime::part_json(&message.parsed.payload, format, nonce);
        }
    }
    value
}
