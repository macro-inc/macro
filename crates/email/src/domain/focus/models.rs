//! Focus value objects.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use strum::{Display, EnumString};
use uuid::Uuid;

use super::questions::FocusQuestion;

/// Why a thread is in or out of Focus. The first four, and Calendar for
/// scheduling notices, are Focus categories; the rest name the reason a thread
/// was left out. None depends on the owner's line of work: who the mail is from
/// comes from their own history.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Display, EnumString)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum FocusCategory {
    /// A customer, client or user asking for help or giving feedback.
    Customer,
    /// Mail from someone at the owner's own company.
    Team,
    /// Mail from someone the owner corresponds with.
    Known,
    /// Relevant mail that fits no narrower category.
    Other,
    /// A calendar invite, update, reschedule or cancellation, in Focus; or an
    /// RSVP notice, left out.
    Calendar,
    /// Unsolicited outreach: a pitch, recruiting or a job application.
    Outreach,
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
    /// Is it unsolicited outreach from a stranger?
    pub outreach: f32,
    /// Is it automated, bulk or templated mail?
    pub automated: f32,
    /// Is it a customer, client or user asking for help or giving feedback?
    pub customer: f32,
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
            outreach,
            automated,
            customer,
            calendar_rsvp,
            needs_decision,
            needs_response,
            needs_follow_up,
        ] = <[f32; FocusQuestion::ALL.len()]>::try_from(probabilities).ok()?;
        Some(Self {
            focus,
            outreach,
            automated,
            customer,
            calendar_rsvp,
            needs_decision,
            needs_response,
            needs_follow_up,
        })
    }
}

/// A calendar notice in a thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CalendarNotice {
    /// An invite, update, reschedule or cancellation: the owner's time moves.
    Scheduling,
    /// An attendee's accepted, declined or tentative notice.
    Rsvp,
}

/// What a message's calendar content says, before its subject is considered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CalendarPart {
    /// A saved component that invites, updates or cancels.
    Scheduling,
    /// Saved components that are only attendees' replies.
    Rsvp,
    /// A calendar file with no saved component.
    Unparsed,
}

/// What the owner's history says about a thread, independent of its words.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FocusSignals {
    /// The owner corresponds with the sender: they wrote to them for real,
    /// replied in this thread, or a teammate is on it. Brushed-off senders
    /// never count, and neither does a teammate on bulk mail.
    pub contact: bool,
    /// The owner wrote to a sender for real within the recent window. Stricter
    /// than `contact`: dated, and bulk or automated senders never count, even
    /// ones the owner once replied to.
    pub recent_contact: bool,
    /// The owner has only ever turned the thread's first sender away.
    pub brushed_off: bool,
    /// The owner sent anything in the thread after its first incoming message.
    pub replied: bool,
    /// A sender shares the owner's company domain.
    pub teammate: bool,
    /// The thread's latest message is the owner's.
    pub latest_from_owner: bool,
    /// The calendar notice the thread's mail amounts to.
    pub calendar: Option<CalendarNotice>,
    /// Someone wrote to the owner, the owner answered last, and that answer
    /// expects a reply from someone who can give one. "Thanks!" does not.
    pub awaiting_reply: bool,
}

impl FocusSignals {
    /// Mail worth classifying even when it isn't in the signal inbox.
    pub fn is_key_mail(&self) -> bool {
        self.calendar == Some(CalendarNotice::Scheduling)
            || self.recent_contact
            || self.awaiting_reply
    }
}

/// The rule's decision about one thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct FocusVerdict {
    /// Whether the thread belongs in Focus at classification time. A thread
    /// awaiting a reply also joins once it has waited long enough.
    pub is_focus: bool,
    /// Key mail: in Focus even when the thread is not in the signal inbox.
    pub pinned: bool,
    /// The Focus category, or why the thread was left out.
    pub category: FocusCategory,
    /// A Focus thread whose latest message is someone else's and waits on the
    /// owner. Never set together with `needs_follow_up`.
    pub needs_reply: bool,
    /// A Focus thread whose latest message is the owner's, with an open loop to
    /// come back to. Never set together with `needs_reply`.
    pub needs_follow_up: bool,
    /// The owner sent the latest message and expects an answer.
    pub awaiting_reply: bool,
    /// How much the thread matters, 0 to 100.
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
    /// Calendar content the message carries.
    pub calendar_part: Option<CalendarPart>,
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
    /// When it was sent.
    pub at: DateTime<Utc>,
    /// Plain-text body, truncated by the store.
    pub body: Option<String>,
}

/// The classification stored for a thread.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredClassification {
    /// The message it is based on.
    pub message_id: Uuid,
    /// The rule version that decided it.
    pub rule_version: i16,
    /// Jev's answers, when they still decode.
    pub answers: Option<FocusAnswers>,
    /// The model that answered.
    pub model: String,
}

/// Where a thread lives and how it stands; read before any message content.
#[derive(Debug, Clone, PartialEq)]
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
    /// The stored classification, when one exists.
    pub classified: Option<StoredClassification>,
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
    /// The stored classification, when one exists.
    pub classified: Option<StoredClassification>,
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
            classified: inbox.classified,
            messages: mail.messages,
            sent_notes: mail.sent_notes,
        }
    }
}

/// An inbox thread whose stored classification may be out of date.
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

/// A stored classification as it stands when read: who wrote last and how long
/// the owner has waited are applied to what was stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadFocus {
    /// Whether the thread belongs in Focus.
    pub is_focus: bool,
    /// The Focus category, or why the thread was left out.
    pub category: FocusCategory,
    /// How much the thread matters, 0 to 100.
    pub importance: u8,
    /// The latest message is someone else's and waits on the owner's answer.
    pub needs_reply: bool,
    /// The latest message is the owner's, and the thread has an open loop or
    /// has waited past the threshold for an answer.
    pub needs_follow_up: bool,
    /// When the classification was made.
    pub classified_at: DateTime<Utc>,
}
