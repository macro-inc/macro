//! Focus: which inbox threads deserve the owner's attention.
//!
//! Each signal thread is classified on every new message, as is key mail outside
//! the signal inbox: changes to events that aren't over, mail from recent contacts,
//! and threads the owner answered last. Jev, a yes/no classifier, answers a fixed set of
//! questions about the thread with the owner's stored memory as context; a
//! deterministic rule then turns those answers and the owner's relationship with
//! the sender into a verdict: in or out of Focus, a category, reply-needed and
//! follow-up flags, and a 0-100 importance score. When it is read, a thread the
//! owner wrote last on is out until it has waited past a threshold for an answer
//! or its due day comes, a calendar change leaves when its event is over, so does
//! any thread once the meeting its mail is about is over, and importance moves at
//! a rate judged per thread until newer mail arrives, since nothing reclassifies a
//! thread as it ages. A thread that can be in Focus also gets the day its mail
//! says it is due and the day of the meeting it is about.
//! Threads holding only the owner's own sent mail stay out:
//! they are not inbox threads, and nothing marks one Done. Only inboxes whose
//! owner is in the Focus rollout are classified.

mod calendar;
mod dates;
mod importance;
mod input;
mod models;
mod ports;
mod questions;
mod rule;
mod service;
mod signals;

pub use calendar::change_subject_pattern;
pub use importance::importance_at;
pub use input::{is_dismissive_reply, new_text};
pub use models::{
    CalendarNotice, CalendarPart, DueDateInput, DueDateMessage, FocusAnswers, FocusCategory,
    FocusDates, FocusInbox, FocusInboxOwner, FocusMail, FocusMessage, FocusRecord, FocusSignals,
    FocusThread, FocusVerdict, ImportanceTrend, SentNote, StaleThread, StoredClassification,
    ThreadDates, ThreadFocus,
};
pub use ports::{
    DueDateExtractor, FocusClassifier, FocusClassifierError, FocusEnrollment, FocusNotifier,
    FocusStore, ProfileSource,
};
pub use questions::{FOCUS_QUESTIONS, FocusQuestion};
pub use rule::{FOCUS_RULE_VERSION, decide};
pub use service::{
    ClassifyOutcome, DueDates, EnrolledInboxes, FocusQueries, FocusService, SweepReport,
};
pub use signals::RECENT_CONTACT_DAYS;
