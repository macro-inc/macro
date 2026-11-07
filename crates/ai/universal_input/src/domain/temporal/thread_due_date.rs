//! The day an email thread is due. The model states deadline facts per message;
//! Rust resolves each against the day its own message was written and decides
//! which one still stands. Wrong dates cost more than missing ones, so anything
//! uncertain resolves to no date.
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

/// The thread's due date.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThreadDueDateResponse {
    /// The day it is due, as `YYYY-MM-DD`; absent when no open deadline stands.
    pub due_on: Option<NaiveDate>,
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

/// What the model read in a thread, before Rust resolves any date.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ThreadFacts {
    /// Every deadline stated, in source order; empty when none is.
    pub deadlines: Vec<DeadlineFact>,
    /// Every closure stated, in source order; empty when none is.
    pub closures: Vec<ClosureFact>,
}

/// Reads deadline facts out of a thread without calculating any date.
pub trait ThreadFactExtractor: Send + Sync {
    /// Extract what the thread's messages state, metered through `usage`.
    fn extract_thread_facts(
        &self,
        request: &ThreadDueDateRequest,
        usage: UsageContext,
    ) -> impl Future<Output = Result<ThreadFacts, InputError>> + Send;
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

/// Whether a resolved day can be what its message means as a deadline.
fn can_be_due(date: &DateExpression, due: NaiveDate, written_on: NaiveDate) -> bool {
    let days_ahead = (due - written_on).num_days();
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
            Some(fact.message) == latest && can_be_due(&fact.date, *due, *written_on)
        })
        .map(|(_, _, due)| *due)
        .min())
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
            due_date_found = Empty,
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
        let facts = self.extractor.extract_thread_facts(&request, usage).await?;
        let span = tracing::Span::current();
        span.record("deadlines", facts.deadlines.len());
        span.record("closures", facts.closures.len());
        let due_on = resolve_due_date(&facts, &request.messages)?;
        span.record("due_date_found", due_on.is_some());
        Ok(ThreadDueDateResponse { due_on })
    }
}
