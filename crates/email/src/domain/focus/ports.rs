//! Capabilities the Focus service needs from the outside.

use std::{collections::HashMap, future::Future};

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde_json::Value;
use uuid::Uuid;

use super::models::{FocusInbox, FocusMail, FocusRecord, StaleThread, ThreadFocus};

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

    /// Inbox signal threads with mail since `since` and no classification of
    /// their latest message, newest first, from inboxes whose address is at
    /// one of `domains`.
    fn stale_threads(
        &self,
        since: DateTime<Utc>,
        domains: &[String],
        limit: i64,
    ) -> impl Future<Output = Result<Vec<StaleThread>, Report>> + Send;

    /// The owner's Focus threads still in the inbox with mail since `since`,
    /// most important first.
    fn focus_thread_ids(
        &self,
        owner: &MacroUserIdStr<'static>,
        since: DateTime<Utc>,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<Uuid>, Report>> + Send;

    /// Stored classifications of the owner's threads among `thread_ids`.
    fn focus_for_threads(
        &self,
        owner: &MacroUserIdStr<'static>,
        thread_ids: &[Uuid],
    ) -> impl Future<Output = Result<HashMap<Uuid, ThreadFocus>, Report>> + Send;
}

/// A short description of the owner that Jev reads as context.
pub trait ProfileSource: Send + Sync + 'static {
    /// The owner's stored profile, or `None` when there isn't one. Never
    /// generates a profile.
    fn profile(
        &self,
        owner: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<String>, Report>> + Send;
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
