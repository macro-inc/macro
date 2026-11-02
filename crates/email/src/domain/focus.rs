//! Focus: which signal threads deserve the owner's attention.
//!
//! Each signal thread is classified on every new message. Jev, a yes/no
//! classifier, answers a fixed set of questions about the thread with the
//! owner's stored memory as context; a deterministic rule then turns those
//! answers and the owner's relationship with the sender into a verdict: in or
//! out of Focus, a category, reply-needed and follow-up flags, and a 0-100
//! importance score. Only inboxes on the worker's allowlist are classified.

mod input;
mod models;
mod ports;
mod questions;
mod rule;
mod service;
mod signals;

pub use input::{is_dismissive_reply, new_text};
pub use models::{
    FocusAnswers, FocusCategory, FocusInbox, FocusMail, FocusMessage, FocusRecord, FocusSignals,
    FocusThread, FocusVerdict, SentNote, StaleThread, ThreadFocus,
};
pub use ports::{FocusClassifier, FocusClassifierError, FocusStore, ProfileSource};
pub use questions::{FOCUS_QUESTIONS, FocusQuestion};
pub use rule::{decide, is_calendar_subject};
pub use service::{ClassifyOutcome, FocusQueries, FocusService, SweepReport};
