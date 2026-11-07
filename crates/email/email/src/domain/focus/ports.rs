//! Capabilities the Focus service needs from the outside.

use std::{collections::HashMap, future::Future};

use chrono::{DateTime, NaiveDate, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde_json::Value;
use uuid::Uuid;

use super::models::{DueDateInput, FocusInbox, FocusMail, FocusRecord, StaleThread, ThreadFocus};

/// Focus storage and the thread reads classification needs.
pub trait FocusStore: Send + Sync + 'static {
    /// Where a thread lives and how it stands, or `None` when it no longer
    /// exists. A single-row read: every email event starts here.
    fn thread_inbox(
        &self,
        thread_id: Uuid,
    ) -> impl Future<Output = Result<Option<FocusInbox>, Report>> + Send;

    /// A thread's messages and the owner's sent mail to its senders.
    fn thread_mail(
        &self,
        inbox: &FocusInbox,
    ) -> impl Future<Output = Result<FocusMail, Report>> + Send;

    /// Store a thread's classification unless one of a later message is
    /// already stored. Returns whether it was stored.
    fn save(&self, record: &FocusRecord) -> impl Future<Output = Result<bool, Report>> + Send;

    /// Inbox threads that may belong in Focus with mail since `since` and no
    /// classification of their latest message under the current rule, newest
    /// first, from inboxes whose address is at one of `domains`. `after` is the
    /// last thread of the previous page.
    fn stale_threads(
        &self,
        since: DateTime<Utc>,
        domains: &[String],
        after: Option<StaleThread>,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<StaleThread>, Report>> + Send;

    /// The owner's Focus threads still in the inbox with mail since `since`,
    /// newest first by latest message time, in either direction. Threads whose
    /// owner has been awaiting a reply since at or before `waiting_before` count,
    /// as do threads a calendar change still holds at `now`.
    fn focus_thread_ids(
        &self,
        owner: &MacroUserIdStr<'static>,
        since: DateTime<Utc>,
        waiting_before: DateTime<Utc>,
        now: DateTime<Utc>,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<Uuid>, Report>> + Send;

    /// Classifications of the owner's threads among `thread_ids`, as they stand
    /// at `now`: who wrote last settles the labels, a thread whose owner has been
    /// awaiting a reply since at or before `waiting_before` is in Focus, one a
    /// calendar change still holds is in Focus as Calendar, and importance has moved
    /// at its stored rate since the classified message, until newer mail stops it.
    fn focus_for_threads(
        &self,
        owner: &MacroUserIdStr<'static>,
        thread_ids: &[Uuid],
        waiting_before: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<HashMap<Uuid, ThreadFocus>, Report>> + Send;
}

/// What the system holds about the owner: a short description Jev reads as
/// context, and the time zone their days run in.
pub trait ProfileSource: Send + Sync + 'static {
    /// The owner's stored profile, or `None` when there isn't one. Never
    /// generates a profile.
    fn profile(
        &self,
        owner: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<String>, Report>> + Send;

    /// The IANA name of the owner's time zone, or `None` when none is stored.
    fn time_zone(
        &self,
        owner: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<String>, Report>> + Send;
}

/// Tells the people reading an inbox that its Focus changed.
pub trait FocusNotifier: Send + Sync + 'static {
    /// A classification was stored for a thread in `link_id`, an inbox `owner`
    /// holds. Returns at once: delivery is best effort and never holds up or
    /// fails a classification.
    fn focus_changed(&self, owner: &MacroUserIdStr<'static>, link_id: Uuid);
}

/// Why the classifier gave no answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum FocusClassifierError {
    /// A timeout, rate limit or outage; the sweep will try again.
    #[error("the classifier is temporarily unavailable")]
    Unavailable,
    /// The classifier refused the request or answered unusably.
    #[error("the classifier rejected the request")]
    Rejected,
}

/// Yes/no answers about a thread, metered against its owner.
pub trait FocusClassifier: Send + Sync + 'static {
    /// The probability of "yes" for each question, in question order.
    fn answer(
        &self,
        owner: &MacroUserIdStr<'static>,
        thread_id: Uuid,
        input: &Value,
        questions: &[&'static str],
    ) -> impl Future<Output = Result<Vec<f32>, FocusClassifierError>> + Send;

    /// Model identifier stored with each classification.
    fn model(&self) -> &'static str;
}

/// Reads the day a thread is due out of its mail, metered against its owner.
pub trait DueDateExtractor: Send + Sync + 'static {
    /// The day the thread is due, or `None` when its mail names no open deadline.
    /// Errors carry no mail text.
    fn due_on(
        &self,
        owner: &MacroUserIdStr<'static>,
        thread_id: Uuid,
        input: &DueDateInput,
    ) -> impl Future<Output = Result<Option<NaiveDate>, Report>> + Send;
}
