//! The work a person's mail shows: the streams of mail they act on, found
//! in one model call over their last month of mail (what reached them and
//! what they sent), for the sessions that draft routines for them at
//! onboarding.
//!
//! The list is hidden: it is passed into those sessions' briefs and stored
//! nowhere. Each stream says who sends it, how often, what it asks and what
//! the person does with it (answers it, forwards it to whom, files it,
//! leaves it to someone, or starts it themselves), so suggestions for setting up the rest of the
//! workspace (tags, a wiki, a database, a CRM, channels) could read it too.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::ports::InboxMessage;
use super::prompt::truncate;

#[cfg(test)]
mod test;

/// What the finding call is told, before the mail.
pub const INSTRUCTIONS: &str = include_str!("work.md");
/// Days of mail the finding call reads.
pub const WORK_DAYS: u16 = 30;
/// Most messages it reads.
pub const WORK_MESSAGES: u16 = 500;
/// Newest messages it reads the text of; the rest by sender, subject and
/// date alone.
pub const WORK_TEXTS: u16 = 100;
/// Most messages it reads of what the person sent in those days: what they
/// do with their mail shows there.
pub const SENT_MESSAGES: u16 = 200;
/// Newest sent messages it reads the text of.
pub const SENT_TEXTS: u16 = 50;
/// The model the finding call runs on, thinking little: as good at finding
/// streams as a larger model, in a third of the time.
pub const WORK_MODEL: &str = "google/gemini-3.8-flash";
/// Finding calls one list may take: the model is held to the list's shape
/// by its prompt alone, and about one answer in four strays from it.
pub const WORK_TRIES: u32 = 2;
/// Most streams a list keeps, the first listed first.
pub const MAX_STREAMS: usize = 20;

/// Longest subject the finding call reads, in characters.
const MAX_SUBJECT_CHARS: usize = 200;
/// Longest sender it reads, in characters.
const MAX_SENDER_CHARS: usize = 120;
/// Recipients it reads per sent message.
const MAX_RECIPIENTS: usize = 3;
/// Longest text it reads of a message, in characters.
const MAX_TEXT_CHARS: usize = 500;
/// Labels it reads per message.
const MAX_LABELS: usize = 5;
/// Labels every message in an inbox carries, which say nothing of its kind.
const PLAIN_LABELS: [&str; 2] = ["INBOX", "UNREAD"];

/// Longest name of a stream passed on, in characters.
const MAX_NAME_CHARS: usize = 80;
/// Longest description passed on, in characters.
const MAX_TEXT_FIELD_CHARS: usize = 400;
/// Longest short field (a cadence, a sender, a label) passed on.
const MAX_SHORT_CHARS: usize = 120;
/// Senders, labels and examples passed on per stream.
const MAX_ITEMS: usize = 5;

/// The streams of work found in a person's month of mail, the ones they
/// would most regret missing first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkList {
    /// Who they are and what their job is, in one sentence.
    pub person: String,
    pub streams: Vec<WorkStream>,
}

/// Mail of one kind that keeps arriving, where each message asks a step of
/// the person or feeds work they do.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkStream {
    /// A few words for the work.
    pub name: String,
    /// Who sends it, most frequent first.
    pub senders: Vec<Sender>,
    /// Its messages in the month.
    pub count: u32,
    /// How often and when it comes.
    pub cadence: String,
    /// What each message says or asks, and the facts it carries.
    pub what: String,
    /// What the person does with each message; "not shown" when the mail
    /// doesn't show it.
    pub action: String,
    /// What the person does with it, in one word.
    pub does: Does,
    /// Whom they forward it to, who handles it for them, or whom they send
    /// it to.
    pub to: Vec<String>,
    /// Messages of it they sent in the month: replies, forwards, or the
    /// mail they started.
    pub sent: u32,
    /// Who or what already handles it; empty when nobody does.
    pub handled_by: String,
    /// Labels of their own its messages carry.
    pub labels: Vec<String>,
    /// What its messages add up to that they keep track of; empty when
    /// nothing.
    pub keeps: String,
    /// Subjects of a few of its messages, newest first.
    pub examples: Vec<String>,
}

/// What a person does with a stream of mail, as what they sent shows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Does {
    /// They reply to the sender.
    Answers,
    /// They send it on to someone.
    Forwards,
    /// They label or keep it and send nothing.
    Files,
    /// A colleague or a tool handles it and they send nothing.
    Leaves,
    /// They start this mail themselves.
    Sends,
    /// The mail doesn't show it; also any word the call answers outside
    /// these.
    #[serde(other)]
    Unknown,
}

impl Does {
    const WORDS: [&str; 6] = ["answers", "forwards", "files", "leaves", "sends", "unknown"];
}

/// One who sends a stream.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sender {
    pub name: String,
    pub email: String,
}

/// The shape the finding call answers in.
pub fn schema() -> Value {
    let string = json!({ "type": "string" });
    let strings = json!({ "type": "array", "items": string });
    let object = |properties: Value| {
        let required: Vec<Value> = properties
            .as_object()
            .map(|fields| fields.keys().cloned().map(Value::String).collect())
            .unwrap_or_default();
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": required,
            "properties": properties,
        })
    };
    let sender = object(json!({ "name": string, "email": string }));
    let stream = object(json!({
        "name": string,
        "senders": { "type": "array", "items": sender },
        "count": { "type": "integer" },
        "cadence": string,
        "what": string,
        "action": string,
        "does": { "type": "string", "enum": Does::WORDS },
        "to": strings,
        "sent": { "type": "integer" },
        "handled_by": string,
        "labels": strings,
        "keeps": string,
        "examples": strings,
    }));
    object(json!({
        "person": string,
        "streams": { "type": "array", "items": stream },
    }))
}

/// What the finding call reads: the instructions, then the mail that
/// reached the person (`messages`) and what they sent (`sent`), each newest
/// first, as untrusted data, a line each and the text under the newest.
pub fn prompt(messages: &[InboxMessage], sent: &[InboxMessage], now: DateTime<Utc>) -> String {
    let lines: Vec<String> = messages
        .iter()
        .map(|message| line(message, Who::Sender))
        .collect();
    let sent_lines: Vec<String> = sent
        .iter()
        .map(|message| line(message, Who::Recipients))
        .collect();
    format!(
        "{INSTRUCTIONS}
It is now {now} UTC. The mail that reached them in the last {WORK_DAYS} days, newest first: a line per message (when, from, subject and labels), and the text of the newest {WORK_TEXTS} under its line.

<untrusted>
{mail}
</untrusted>

What they sent in those days, newest first: a line per message (when, to whom, subject), and the text of the newest {SENT_TEXTS} under its line.

<untrusted>
{sent}
</untrusted>",
        now = now.format("%Y-%m-%d %H:%M"),
        mail = lines.join("\n"),
        sent = if sent_lines.is_empty() { "(nothing)".to_owned() } else { sent_lines.join("\n") },
    )
}

/// Who a message's line names: its sender, for mail that reached the
/// person, or its recipients, for mail they sent.
#[derive(Clone, Copy)]
enum Who {
    Sender,
    Recipients,
}

/// One message as the finding call reads it.
fn line(message: &InboxMessage, who: Who) -> String {
    let at = message
        .received_at
        .map(|at| at.format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_else(|| "undated".to_owned());
    let from = match who {
        Who::Sender => message
            .from
            .as_deref()
            .map_or_else(String::new, |from| truncate(from, MAX_SENDER_CHARS)),
        Who::Recipients => {
            let to: Vec<String> = message
                .to
                .iter()
                .take(MAX_RECIPIENTS)
                .map(|to| truncate(to, MAX_SENDER_CHARS))
                .collect();
            format!("to {}", to.join(", "))
        }
    };
    let subject = message
        .subject
        .as_deref()
        .map_or_else(String::new, |subject| truncate(subject, MAX_SUBJECT_CHARS));
    let labels: Vec<String> = message
        .labels
        .iter()
        .filter(|label| !PLAIN_LABELS.contains(&label.as_str()))
        .take(MAX_LABELS)
        .map(|label| truncate(label, MAX_SHORT_CHARS))
        .collect();
    let mut head = format!("{at} · {from} · {subject}");
    if !labels.is_empty() {
        head.push_str(" · ");
        head.push_str(&labels.join(", "));
    }
    match message.snippet.as_deref().map(str::trim) {
        Some(text) if !text.is_empty() => {
            format!("{head}\n    {}", truncate(text, MAX_TEXT_CHARS))
        }
        _ => head,
    }
}

impl WorkList {
    /// The list as the finding call answered it, bounded: at most
    /// [`MAX_STREAMS`] streams, every text on one line, cut short, and
    /// unable to close the tag it is passed in. Its words come from the
    /// person's mail, so an answer that doesn't fit is refused without
    /// them: serde's message can quote the value it couldn't read.
    pub fn from_answer(answer: Value) -> anyhow::Result<Self> {
        let list: Self = serde_json::from_value(answer).map_err(|error| {
            anyhow::anyhow!(
                "the finding call's answer doesn't fit the work list ({:?} error)",
                error.classify()
            )
        })?;
        Ok(Self {
            person: truncate(&list.person, MAX_TEXT_FIELD_CHARS),
            streams: list
                .streams
                .into_iter()
                .filter(|stream| !stream.name.trim().is_empty())
                .take(MAX_STREAMS)
                .map(WorkStream::bounded)
                .collect(),
        })
    }

    /// The first `streams` streams dealt into at most `shares` lists, in
    /// turn, so each share starts with a stream the person would most regret
    /// missing; none when the list has no stream.
    pub fn shares(&self, shares: usize, streams: usize) -> Vec<Self> {
        let kept = &self.streams[..self.streams.len().min(streams)];
        let count = shares.min(kept.len());
        (0..count)
            .map(|share| Self {
                person: self.person.clone(),
                streams: kept.iter().skip(share).step_by(count).cloned().collect(),
            })
            .collect()
    }

    /// The list as a session reads it: one JSON value, for a fenced block,
    /// which the harness's Markdown round trip leaves as written. It writes
    /// `&` as `&amp;` there, and a run of backticks would close the fence, so
    /// both are JSON escapes (they only occur inside strings).
    pub fn to_brief(&self) -> String {
        serde_json::to_string(self)
            .unwrap_or_default()
            .replace('&', "\\u0026")
            .replace('`', "\\u0060")
    }
}

impl WorkStream {
    fn bounded(self) -> Self {
        let short = |text: &str| truncate(text, MAX_SHORT_CHARS);
        let list = |items: Vec<String>| -> Vec<String> {
            items
                .iter()
                .take(MAX_ITEMS)
                .map(|item| truncate(item, MAX_SUBJECT_CHARS))
                .collect()
        };
        Self {
            name: truncate(&self.name, MAX_NAME_CHARS),
            senders: self
                .senders
                .into_iter()
                .take(MAX_ITEMS)
                .map(|sender| Sender {
                    name: short(&sender.name),
                    email: short(&sender.email),
                })
                .collect(),
            count: self.count,
            cadence: short(&self.cadence),
            what: truncate(&self.what, MAX_TEXT_FIELD_CHARS),
            action: truncate(&self.action, MAX_TEXT_FIELD_CHARS),
            does: self.does,
            to: self.to.iter().take(MAX_ITEMS).map(|to| short(to)).collect(),
            sent: self.sent,
            handled_by: short(&self.handled_by),
            labels: list(self.labels),
            keeps: truncate(&self.keeps, MAX_TEXT_FIELD_CHARS),
            examples: list(self.examples),
        }
    }
}
