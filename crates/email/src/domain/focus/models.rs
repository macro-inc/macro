//! Focus value objects.

use chrono::{DateTime, NaiveDate, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use strum::{Display, EnumString};
use uuid::Uuid;

use super::questions::FocusQuestion;

/// Why a thread is in or out of Focus. The first four, and Calendar for a change
/// to an event that isn't over, are Focus categories; the rest name the reason a
/// thread was left out. None depends on the owner's line of work: who the mail is
/// from comes from their own history.
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
    /// In Focus: a reschedule, update, cancellation or proposed new time for an
    /// event that isn't over. Left out: a new invite or an RSVP notice.
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
    /// Is it only a calendar invite, update or RSVP? Stored, but the rule doesn't
    /// read it: the one question can't tell a change from a new invite or an RSVP.
    pub calendar_rsvp: f32,
    /// Does it ask for a decision only the owner can make?
    pub needs_decision: f32,
    /// Does the latest message ask the owner something unanswered?
    pub needs_response: f32,
    /// Is there an open loop the owner should come back to?
    pub needs_follow_up: f32,
    /// Does it get more pressing the longer it sits untouched? Reads 0 on rows
    /// stored before Jev was asked, which leaves them flat.
    #[serde(default)]
    pub grows_with_time: f32,
    /// Does it matter less the longer it sits untouched? Reads 0 on rows stored
    /// before Jev was asked, which leaves them flat.
    #[serde(default)]
    pub fades_with_time: f32,
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
            grows_with_time,
            fades_with_time,
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
            grows_with_time,
            fades_with_time,
        })
    }
}

/// The calendar notice a thread's latest message is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CalendarNotice {
    /// A reschedule, update, cancellation or proposed new time: the owner's
    /// time moves.
    Change {
        /// When the event is over, or a fixed while after the notice when
        /// nothing says.
        until: DateTime<Utc>,
    },
    /// A first invitation to an event.
    NewInvite,
    /// An attendee's accepted, declined or tentative notice.
    Rsvp,
}

/// What a message's calendar content says, before its subject is considered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CalendarPart {
    /// A saved component that cancels an event, proposes a new time, or updates
    /// one past its first revision.
    Change {
        /// When the event is over, or a fixed while after the notice when
        /// nothing says.
        until: DateTime<Utc>,
    },
    /// Saved components that invite or publish, and change nothing.
    NewInvite {
        /// When the event is over, should the message's subject say it changed.
        until: DateTime<Utc>,
    },
    /// Saved components that are only attendees' replies.
    Rsvp,
    /// A calendar file with no saved component to read.
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
    /// The notice the thread's latest message is. Anyone writing after a notice
    /// makes the thread a conversation, so it counts only as the latest message.
    pub calendar: Option<CalendarNotice>,
    /// Someone wrote to the owner, the owner answered last, and that answer
    /// expects a reply from someone who can give one. "Thanks!" does not.
    pub awaiting_reply: bool,
}

impl FocusSignals {
    /// When the calendar change that is the thread's latest message stops holding
    /// it in Focus.
    pub fn calendar_change_until(&self) -> Option<DateTime<Utc>> {
        match self.calendar {
            Some(CalendarNotice::Change { until }) => Some(until),
            Some(CalendarNotice::NewInvite | CalendarNotice::Rsvp) | None => None,
        }
    }

    /// Mail worth classifying even when it isn't in the signal inbox. A new
    /// invite or a change to an event already over is not.
    pub fn is_key_mail(&self, now: DateTime<Utc>) -> bool {
        self.calendar_change_until()
            .is_some_and(|until| until > now)
            || self.recent_contact
            || self.awaiting_reply
    }
}

/// The rule's decision about one thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct FocusVerdict {
    /// Whether the thread belongs in Focus whatever the time. A thread awaiting
    /// a reply also joins once it has waited long enough, and a calendar change
    /// holds one until `calendar_hold_until`.
    pub is_focus: bool,
    /// Key mail: in Focus even when the thread is not in the signal inbox.
    pub pinned: bool,
    /// A calendar change holds the thread in Focus until this time, in the signal
    /// inbox or not, as long as nobody writes after it.
    pub calendar_hold_until: Option<DateTime<Utc>>,
    /// The Focus category, or why the thread was left out, apart from a calendar
    /// hold: the read calls a thread Calendar while one lasts.
    pub category: FocusCategory,
    /// A Focus thread whose latest message is someone else's and waits on the
    /// owner. Never set together with `needs_follow_up`.
    pub needs_reply: bool,
    /// A Focus thread whose latest message is the owner's, with an open loop to
    /// come back to. Never set together with `needs_reply`.
    pub needs_follow_up: bool,
    /// The owner sent the latest message and expects an answer.
    pub awaiting_reply: bool,
    /// How much the thread matters at its classified message, 0 to 100.
    pub importance: u8,
    /// How fast importance moves after that message, as a percent of the distance
    /// left per day: positive towards 100, negative towards 0, 0 is flat.
    pub importance_rate: i8,
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
    /// The `Date` header, whose offset tells which day the sender's clock showed.
    pub date_header: Option<String>,
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
    /// The day the classified mail says the thread is due.
    pub due_on: Option<NaiveDate>,
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
    /// The day the classified mail says the thread is due. No mail text or
    /// extracted span is ever stored with it.
    pub due_on: Option<NaiveDate>,
}

/// Which way a thread's importance is moving.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportanceTrend {
    /// Rising, towards 100.
    Up,
    /// Falling, towards 0.
    Down,
    /// Not moving.
    Flat,
}

/// A stored classification as it stands when read: who wrote last, how long the
/// owner has waited, whether a changed event is over and how far importance has
/// moved are applied to what was stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadFocus {
    /// Whether the thread belongs in Focus.
    pub is_focus: bool,
    /// The Focus category, or why the thread was left out.
    pub category: FocusCategory,
    /// How much the thread matters right now, 0 to 100.
    pub importance: u8,
    /// The latest message is someone else's and waits on the owner's answer.
    pub needs_reply: bool,
    /// The latest message is the owner's, and the thread has an open loop or
    /// has waited past the threshold for an answer.
    pub needs_follow_up: bool,
    /// When the classification was made.
    pub classified_at: DateTime<Utc>,
    /// Which way `importance` is moving.
    pub importance_trend: ImportanceTrend,
    /// The day the classified mail says the thread is due, as a calendar date so no
    /// time zone can shift it.
    pub due_on: Option<NaiveDate>,
}

/// One message as the due date extractor reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DueDateMessage {
    /// The local calendar day it was written; its relative dates count from here.
    pub written_on: NaiveDate,
    /// Sent by the owner.
    pub from_owner: bool,
    /// Its own words, without quoted history.
    pub text: String,
}

/// What the due date extractor reads about a thread.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DueDateInput {
    /// The thread's subject, as context.
    pub subject: Option<String>,
    /// The messages Jev is shown that have words of their own, oldest first.
    pub messages: Vec<DueDateMessage>,
}
