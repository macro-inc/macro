//! Focus: which inbox threads deserve the owner's attention.
//!
//! Each signal thread is classified on every new message, as is key mail outside
//! the signal inbox: scheduling notices, mail from recent contacts, and threads
//! the owner answered last. Jev, a yes/no classifier, answers a fixed set of
//! questions about the thread with the owner's stored memory as context; a
//! deterministic rule then turns those answers and the owner's relationship with
//! the sender into a verdict: in or out of Focus, a category, reply-needed and
//! follow-up flags, and a 0-100 importance score. A thread the owner has waited
//! on past a threshold joins Focus when it is read, since nothing reclassifies a
//! thread as it ages. Threads holding only the owner's own sent mail stay out:
//! they are not inbox threads, and nothing marks one Done. Only inboxes on the
//! worker's allowlist are classified.

mod input;
mod models;
mod ports;
mod questions;
mod rule;
mod service;
mod signals;

pub use input::{is_dismissive_reply, new_text};
pub use models::{
    CalendarNotice, CalendarPart, FocusAnswers, FocusCategory, FocusInbox, FocusMail, FocusMessage,
    FocusRecord, FocusSignals, FocusThread, FocusVerdict, SentNote, StaleThread,
    StoredClassification, ThreadFocus,
};
pub use ports::{FocusClassifier, FocusClassifierError, FocusStore, ProfileSource};
pub use questions::{FOCUS_QUESTIONS, FocusQuestion};
pub use rule::{FOCUS_RULE_VERSION, decide};
pub use service::{ClassifyOutcome, FocusQueries, FocusService, SweepReport};
