//! Focus value objects.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use strum::{Display, EnumString};
use uuid::Uuid;

use super::questions::FocusQuestion;

/// Why a thread is in or out of Focus. The first five are Focus categories;
/// the rest name the reason a thread was left out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Display, EnumString)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum FocusCategory {
    /// A specific, credible vulnerability report.
    Security,
    /// A customer or user asking for help or giving feedback.
    Customer,
    /// Mail from someone at the owner's own company.
    Team,
    /// Mail from someone the owner corresponds with.
    Known,
    /// Relevant mail that fits no narrower category.
    Other,
    /// A calendar invite, update or RSVP.
    Calendar,
    /// An unsolicited pitch.
    ColdPitch,
    /// An unsolicited job application.
    JobApplication,
    /// Automated, bulk or templated mail.
    Automated,
    /// Nothing marks the thread as relevant.
    LowRelevance,
}

/// Jev's probability of "yes", from 0 to 1, for each Focus question.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct FocusAnswers {
    /// Would the owner want this in a short Focus inbox?
    pub focus: f32,
    /// Is it an unsolicited pitch from a stranger?
    pub cold_pitch: f32,
    /// Is it automated, bulk or templated mail?
    pub automated: f32,
    /// Is it an unsolicited job application?
    pub job_application: f32,
    /// Is it a customer or user asking for help or giving feedback?
    pub customer: f32,
    /// Is it a specific, credible vulnerability report?
    pub security_report: f32,
    /// Does the mail itself show an existing relationship?
    pub existing_relationship: f32,
    /// Is it only a calendar invite, update or RSVP?
    pub calendar_rsvp: f32,
    /// Does it ask for a decision only the owner can make?
    pub needs_decision: f32,
    /// Does the latest message ask the owner something unanswered?
    pub needs_response: f32,
    /// Is there an open loop the owner should come back to?
    pub needs_follow_up: f32,
}

impl FocusAnswers {
    /// Answers in [`FocusQuestion::ALL`] order, or `None` when the count is wrong.
    pub fn from_probabilities(probabilities: &[f32]) -> Option<Self> {
        let [
            focus,
            cold_pitch,
            automated,
            job_application,
            customer,
            security_report,
            existing_relationship,
            calendar_rsvp,
            needs_decision,
            needs_response,
            needs_follow_up,
        ] = <[f32; FocusQuestion::ALL.len()]>::try_from(probabilities).ok()?;
        Some(Self {
            focus,
            cold_pitch,
            automated,
            job_application,
            customer,
            security_report,
            existing_relationship,
            calendar_rsvp,
            needs_decision,
            needs_response,
            needs_follow_up,
        })
    }
}

/// What the owner's history says about a thread, independent of its words.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FocusSignals {
    /// The owner corresponds with the sender: they wrote to them for real,
    /// replied in this thread, or a teammate is on it. Brushed-off senders
    /// never count, and neither does a teammate on bulk mail.
    pub contact: bool,
    /// The owner sent anything in the thread after its first incoming message.
    pub replied: bool,
    /// A sender shares the owner's company domain.
    pub teammate: bool,
    /// The thread's latest message is the owner's.
    pub latest_from_owner: bool,
    /// The subject reads as a calendar invite or RSVP.
    pub calendar_subject: bool,
}

/// The rule's decision about one thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct FocusVerdict {
    /// Whether the thread belongs in Focus.
    pub is_focus: bool,
    /// The Focus category, or why the thread was left out.
    pub category: FocusCategory,
    /// A Focus thread whose latest message waits on the owner's answer.
    pub needs_reply: bool,
    /// A Focus thread with an open loop to come back to.
    pub needs_follow_up: bool,
    /// Sort key for the Focus list, 0 to 100.
    pub importance: u8,
}

/// One message as the classifier needs it.
#[derive(Debug, Clone, PartialEq)]
pub struct FocusMessage {
    /// Message row id.
    pub id: Uuid,
    /// Provider receive time.
    pub at: DateTime<Utc>,
    /// Sent by the owner.
    pub is_sent: bool,
    /// Sender address.
    pub from_email: Option<String>,
    /// Sender display name.
    pub from_name: Option<String>,
    /// `To` addresses.
    pub to: Vec<String>,
    /// `Cc` addresses.
    pub cc: Vec<String>,
    /// Subject header.
    pub subject: Option<String>,
    /// Whether the message carries attachments.
    pub has_attachments: bool,
    /// Whether its headers mark it as mailing-list or bulk mail.
    pub bulk: bool,
    /// Plain-text body, truncated by the store.
    pub body: Option<String>,
    /// Provider snippet.
    pub snippet: Option<String>,
}

/// A message the owner sent to one of the thread's senders, anywhere in the inbox.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SentNote {
    /// The recipient, lowercased.
    pub recipient: String,
    /// Plain-text body, truncated by the store.
    pub body: Option<String>,
}

/// Where a thread lives and how it stands; read before any message content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusInbox {
    /// Thread row id.
    pub thread_id: Uuid,
    /// Inbox that holds the thread.
    pub link_id: Uuid,
    /// Owner of that inbox.
    pub owner: MacroUserIdStr<'static>,
    /// The inbox's address, lowercased.
    pub owner_email: String,
    /// Whether the thread is in the signal inbox.
    pub is_signal: bool,
    /// Whether the thread is still in the inbox.
    pub inbox_visible: bool,
    /// Message the stored result is based on, when one exists.
    pub classified_message_id: Option<Uuid>,
}

/// A thread's mail and the owner's sent mail to its senders.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FocusMail {
    /// Non-draft, non-trashed messages, oldest first.
    pub messages: Vec<FocusMessage>,
    /// The owner's sent mail to this thread's senders, newest first.
    pub sent_notes: Vec<SentNote>,
}

/// Everything the classifier reads about one thread.
#[derive(Debug, Clone, PartialEq)]
pub struct FocusThread {
    /// Thread row id.
    pub thread_id: Uuid,
    /// Inbox that holds the thread.
    pub link_id: Uuid,
    /// Owner of that inbox.
    pub owner: MacroUserIdStr<'static>,
    /// The inbox's address.
    pub owner_email: String,
    /// Whether the thread is in the signal inbox.
    pub is_signal: bool,
    /// Whether the thread is still in the inbox.
    pub inbox_visible: bool,
    /// Message the stored result is based on, when one exists.
    pub classified_message_id: Option<Uuid>,
    /// Non-draft, non-trashed messages, oldest first.
    pub messages: Vec<FocusMessage>,
    /// The owner's sent mail to this thread's senders, newest first.
    pub sent_notes: Vec<SentNote>,
}

impl FocusThread {
    /// Join a thread's inbox facts with its mail.
    pub fn new(inbox: FocusInbox, mail: FocusMail) -> Self {
        Self {
            thread_id: inbox.thread_id,
            link_id: inbox.link_id,
            owner: inbox.owner,
            owner_email: inbox.owner_email,
            is_signal: inbox.is_signal,
            inbox_visible: inbox.inbox_visible,
            classified_message_id: inbox.classified_message_id,
            messages: mail.messages,
            sent_notes: mail.sent_notes,
        }
    }
}

/// A signal thread whose stored classification may be out of date.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StaleThread {
    /// Thread row id.
    pub thread_id: Uuid,
    /// The thread's latest mail activity, as the thread row records it.
    pub latest_at: DateTime<Utc>,
}

/// A classification to store.
#[derive(Debug, Clone, PartialEq)]
pub struct FocusRecord {
    /// Classified thread.
    pub thread_id: Uuid,
    /// Inbox that holds the thread.
    pub link_id: Uuid,
    /// The thread's latest message when it was classified.
    pub classified_message_id: Uuid,
    /// That message's receive time.
    pub classified_message_ts: DateTime<Utc>,
    /// The rule's decision.
    pub verdict: FocusVerdict,
    /// Jev's raw answers.
    pub answers: FocusAnswers,
    /// Model that answered.
    pub model: String,
    /// When the classification was made.
    pub classified_at: DateTime<Utc>,
}

/// A stored classification, as the Focus view reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadFocus {
    /// Whether the thread belongs in Focus.
    pub is_focus: bool,
    /// The Focus category, or why the thread was left out.
    pub category: FocusCategory,
    /// Sort key, 0 to 100.
    pub importance: u8,
    /// The latest message waits on the owner's answer.
    pub needs_reply: bool,
    /// An open loop to come back to.
    pub needs_follow_up: bool,
    /// When the classification was made.
    pub classified_at: DateTime<Utc>,
}
