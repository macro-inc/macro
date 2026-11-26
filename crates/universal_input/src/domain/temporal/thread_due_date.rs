//! The day an email thread is due, and the day of the meeting it is about. The
//! model states deadline and event facts per message; Rust resolves each against
//! the day its own message was written and decides which one still stands. Wrong
//! dates cost more than missing ones, so anything uncertain resolves to no date.
use super::{DateExpression, WeekRelation, resolve};
use crate::domain::InputError;
use ai_billing::AiAdmissionService;
use ai_usage::{AiFeature, UsageContext};
use chrono::NaiveDate;
use macro_user_id::user_id::MacroUserIdStr;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{future::Future, sync::Arc};
use tracing::field::Empty;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Most messages one request reads.
pub const MAX_THREAD_MESSAGES: usize = 10;
/// Most characters of text one message carries.
pub const MAX_MESSAGE_CHARS: usize = 4_000;
/// Most characters of a thread's subject.
pub const MAX_SUBJECT_CHARS: usize = 1_000;
/// How far past its message a deadline can fall. A written month and day with no
/// year always resolves to its next occurrence, so a date already past ("the
/// invoice from Oct 3") lands about a year out; this also bounds what injected
/// text can claim.
const MAX_DAYS_AHEAD: i64 = 183;
/// How long before a message an event can have been held and still be what the
/// message is about: a message can follow a meeting just past (its notes, thanks
/// for it), but one further back is more likely a misread, and mail written
/// later than that in the same thread is taken to be about something else.
const MAX_EVENT_DAYS_BEHIND: i64 = 14;

/// One message of a thread, as the model reads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThreadMessage {
    /// The local calendar day it was written; its relative dates count from here.
    pub written_on: NaiveDate,
    /// Whether the thread's owner wrote it.
    pub from_owner: bool,
    /// Its own words, without quoted history.
    pub text: String,
}

/// A thread to read a due date from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThreadDueDateRequest {
    /// Thread the usage is attributed to.
    pub thread_id: Uuid,
    /// Subject, as context only: no fact can cite it.
    pub subject: Option<String>,
    /// Messages to read, oldest first.
    pub messages: Vec<ThreadMessage>,
}

/// The thread's due date, and the day of the meeting it is about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThreadDueDateResponse {
    /// The day it is due, as `YYYY-MM-DD`; absent when no open deadline stands.
    pub due_on: Option<NaiveDate>,
    /// The day of the meeting, call or other event the thread is about, as
    /// `YYYY-MM-DD`, still to come or just past; absent when it names none it is
    /// about, or one that can't be trusted. Absent from a harness that predates
    /// it.
    #[serde(default)]
    pub event_on: Option<NaiveDate>,
    /// What reading it cost, for the caller's own cost tracking; the request is
    /// metered here either way. Absent when the model reported no token usage.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<DueDateUsage>,
    /// Whether the model's deadlines or closures cited a message or text the
    /// thread doesn't have, so nothing it read is trusted and both days are
    /// absent. Absent from a harness that predates it, which failed the request
    /// instead.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub rejected: bool,
}

/// The tokens one due date read took, as the usage journal records them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DueDateUsage {
    /// The model that read the thread, as recorded with its usage.
    pub model: String,
    /// Input tokens neither read from nor written to a prompt cache.
    pub input_tokens: u64,
    /// Output tokens.
    pub output_tokens: u64,
    /// Input tokens read from a prompt cache.
    pub cache_read_tokens: u64,
    /// Input tokens written to a prompt cache.
    pub cache_write_tokens: u64,
}

/// What the model read in a thread, and what reading it took.
#[derive(Debug, Clone)]
pub struct ExtractedFacts {
    /// The facts the model stated.
    pub facts: ThreadFacts,
    /// The tokens it took, when the model reported them.
    pub usage: Option<DueDateUsage>,
}

/// A deadline a message states, never a model-computed date.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DeadlineFact {
    /// Number of the message that states it, from zero.
    pub message: usize,
    /// The date as written; its span is an exact substring of that message's text.
    pub date: DateExpression,
}

/// A message saying the work is done or the deadline no longer applies.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ClosureFact {
    /// Number of the message that says so, from zero.
    pub message: usize,
    /// Exact substring of that message's text.
    pub span: String,
}

/// A meeting, call or other event a message is about, on one day still to come or
/// just past when it is written, never a model-computed date.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EventFact {
    /// Number of the message that states it, from zero.
    pub message: usize,
    /// The event's day as written; its span is an exact substring of that message's text.
    pub date: DateExpression,
    /// Where the event lies from the message; it decides which way from the
    /// message its day is counted.
    pub when: EventTime,
}

/// Where an event lies from the message that states it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EventTime {
    /// Still to come: the next such day, on or after the message's own.
    ToCome,
    /// Already held, as its notes, recording or thanks say: the latest such day
    /// on or before the message's own.
    Held,
    /// Held on a day the wording puts before the message's own ("last Friday",
    /// "yesterday"): the latest such day before it.
    HeldEarlier,
}

/// What the model read in a thread, before Rust resolves any date.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ThreadFacts {
    /// Every deadline stated, in source order; empty when none is.
    pub deadlines: Vec<DeadlineFact>,
    /// Every closure stated, in source order; empty when none is.
    pub closures: Vec<ClosureFact>,
    /// Every event a message is about, in source order; empty when none is.
    pub events: Vec<EventFact>,
}

/// Reads deadline facts out of a thread without calculating any date.
pub trait ThreadFactExtractor: Send + Sync {
    /// Extract what the thread's messages state, metered through `usage`.
    fn extract_thread_facts(
        &self,
        request: &ThreadDueDateRequest,
        usage: UsageContext,
    ) -> impl Future<Output = Result<ExtractedFacts, InputError>> + Send;
}

fn validate(request: &ThreadDueDateRequest) -> Result<(), InputError> {
    let messages_fit = !request.messages.is_empty()
        && request.messages.len() <= MAX_THREAD_MESSAGES
        && request.messages.iter().all(|message| {
            !message.text.trim().is_empty() && message.text.chars().count() <= MAX_MESSAGE_CHARS
        });
    let subject_fits = request
        .subject
        .as_ref()
        .is_none_or(|subject| subject.chars().count() <= MAX_SUBJECT_CHARS);
    if !messages_fit || !subject_fits {
        return Err(InputError::InvalidText);
    }
    Ok(())
}

/// Whether a resolved day still to come can be what its message means: on or after
/// the day it was written, and within reach of it.
fn within_reach(date: &DateExpression, day: NaiveDate, written_on: NaiveDate) -> bool {
    let days_ahead = (day - written_on).num_days();
    // Bare "by Friday", written on a Friday, could mean today or next week.
    let names_its_own_day = days_ahead == 0
        && matches!(
            date,
            DateExpression::Weekday {
                week: WeekRelation::Upcoming,
                ..
            }
        );
    (0..=MAX_DAYS_AHEAD).contains(&days_ahead) && !names_its_own_day
}

/// The deadline that still stands. A fact citing no real message or text fails
/// the whole answer rather than leaving the rest to be trusted. A closure ends
/// every deadline stated up to its own message. The latest message still stating
/// a deadline replaces earlier ones even when its own date can't be trusted, so a
/// replaced date never comes back, and of several in one message the nearest counts.
fn resolve_due_date(
    facts: &ThreadFacts,
    messages: &[ThreadMessage],
) -> Result<Option<NaiveDate>, InputError> {
    let mut closed_through = None;
    for closure in &facts.closures {
        let message = messages
            .get(closure.message)
            .ok_or(InputError::Extraction)?;
        if closure.span.trim().is_empty() || !message.text.contains(&closure.span) {
            return Err(InputError::Extraction);
        }
        closed_through = closed_through.max(Some(closure.message));
    }
    let mut open = Vec::new();
    for fact in &facts.deadlines {
        let message = messages.get(fact.message).ok_or(InputError::Extraction)?;
        let due = resolve::date(&fact.date, &message.text, message.written_on)?;
        if closed_through.is_none_or(|closed| fact.message > closed) {
            open.push((fact, message.written_on, due));
        }
    }
    let latest = open.iter().map(|(fact, _, _)| fact.message).max();
    Ok(open
        .iter()
        .filter(|(fact, written_on, due)| {
            Some(fact.message) == latest && within_reach(&fact.date, *due, *written_on)
        })
        .map(|(_, _, due)| *due)
        .min())
}

/// The day an event fact names, or `None` when that day can't be what its message
/// means. An event still to come is the next such day, at most `MAX_DAYS_AHEAD`
/// after the message; one already held is the latest such day on or before it
/// (before it, when the wording puts it on an earlier day), at most
/// `MAX_EVENT_DAYS_BEHIND` back. So what the mail says, not how far each
/// occurrence lies, decides which one a month and day or a bare weekday names,
/// and a day on the other side of the message counts for nothing.
fn event_day(fact: &EventFact, message: &ThreadMessage) -> Result<Option<NaiveDate>, InputError> {
    let written_on = message.written_on;
    let latest = match fact.when {
        EventTime::ToCome => {
            let next = resolve::date(&fact.date, &message.text, written_on)?;
            return Ok(Some(next).filter(|on| within_reach(&fact.date, *on, written_on)));
        }
        EventTime::Held => Some(written_on),
        EventTime::HeldEarlier => written_on.pred_opt(),
    };
    let Some(latest) = latest else {
        return Ok(None);
    };
    Ok(
        resolve::past_date(&fact.date, &message.text, written_on, latest)?
            .filter(|on| (written_on - *on).num_days() <= MAX_EVENT_DAYS_BEHIND),
    )
}

/// The day of the event the thread is about. As with deadlines, a fact citing no
/// real message or text fails every event of the answer (the due date stands),
/// and the latest message stating an event replaces earlier ones even when its
/// own day can't be trusted. Of several in that message the last day counts, so
/// the thread is past none of them until all are over. The day stands when mail
/// was written after it too, as long as the thread's latest message is no more
/// than two weeks past it: what that mail means for the thread is the caller's to
/// judge, and mail written later is about something else.
fn resolve_event_date(
    facts: &ThreadFacts,
    messages: &[ThreadMessage],
) -> Result<Option<NaiveDate>, InputError> {
    let mut events = Vec::new();
    for fact in &facts.events {
        let message = messages.get(fact.message).ok_or(InputError::Extraction)?;
        events.push((fact.message, event_day(fact, message)?));
    }

    let Some(latest) = events.iter().map(|(message, _)| *message).max() else {
        return Ok(None);
    };
    let last_day = events
        .iter()
        .filter(|(message, _)| *message == latest)
        .try_fold(None, |last: Option<NaiveDate>, (_, on)| {
            on.map(|on| last.max(Some(on)))
        })
        .flatten();
    let last_written = messages.iter().map(|message| message.written_on).max();
    Ok(last_day.filter(|on| {
        last_written.is_none_or(|written_on| (written_on - *on).num_days() <= MAX_EVENT_DAYS_BEHIND)
    }))
}

/// Reads due dates for the owner of a thread, as background Focus usage: the owner
/// asked for nothing, so it never draws on their AI allowance.
pub struct ThreadDueDateService<E> {
    extractor: E,
    admission: Arc<dyn AiAdmissionService>,
}

impl<E: ThreadFactExtractor> ThreadDueDateService<E> {
    /// Compose fact extraction with the shared admission policy.
    pub fn new(extractor: E, admission: Arc<dyn AiAdmissionService>) -> Self {
        Self {
            extractor,
            admission,
        }
    }

    /// The day the thread is due, or `None` when no open deadline stands.
    #[tracing::instrument(
        name = "universal_input.thread_due_date",
        skip_all,
        err,
        fields(
            thread_id = %request.thread_id,
            messages = request.messages.len(),
            deadlines = Empty,
            closures = Empty,
            events = Empty,
            rejected = Empty,
            due_date_found = Empty,
            event_found = Empty,
            event_rejected = Empty,
            input.prompt_version = crate::telemetry::PROMPT_VERSION,
            input.recipe_version = crate::telemetry::RECIPE_VERSION,
        )
    )]
    pub async fn due_date(
        &self,
        owner: MacroUserIdStr<'static>,
        request: ThreadDueDateRequest,
    ) -> Result<ThreadDueDateResponse, InputError> {
        validate(&request)?;
        self.admission.admit(&owner, AiFeature::EmailFocus).await?;
        let usage =
            UsageContext::new(AiFeature::EmailFocus, owner).with_entity(Some(request.thread_id));
        let ExtractedFacts { facts, usage } =
            self.extractor.extract_thread_facts(&request, usage).await?;
        let span = tracing::Span::current();
        span.record("deadlines", facts.deadlines.len());
        span.record("closures", facts.closures.len());
        span.record("events", facts.events.len());
        // The model answered, so this is an answer, not a failure: the caller
        // learns it holds no days it can trust, and what reading it cost.
        let due_on = resolve_due_date(&facts, &request.messages);
        span.record("rejected", due_on.is_err());
        let Ok(due_on) = due_on else {
            return Ok(ThreadDueDateResponse {
                due_on: None,
                event_on: None,
                usage,
                rejected: true,
            });
        };
        // Unreadable events cost only the event: the due date stands on its own.
        let event = resolve_event_date(&facts, &request.messages);
        span.record("event_rejected", event.is_err());
        let event_on = event.unwrap_or_default();
        span.record("due_date_found", due_on.is_some());
        span.record("event_found", event_on.is_some());
        Ok(ThreadDueDateResponse {
            due_on,
            event_on,
            usage,
            rejected: false,
        })
    }
}
