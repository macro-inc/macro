//! Composer inference policy, independent of HTTP and provider implementations.
use std::{future::Future, sync::Arc};

use ai_billing::{AiAdmissionError, AiAdmissionService};
use ai_usage::{AiFeature, UsageContext};
use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
use jev::domain::{YesNoClassifier, YesNoQuestion};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[cfg(test)]
mod test;

/// A destination the composer can prepare, but never execute through inference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum InputIntent {
    Ai,
    Search,
    Email,
    Note,
    Task,
    Calendar,
    Message,
}

/// Fixed questions keep the public API from becoming an arbitrary model proxy.
pub const INTENT_QUESTIONS: [(InputIntent, &str); 7] = [
    (
        InputIntent::Ai,
        "Is the author asking an AI assistant to answer, explain, research, generate, or do work, rather than directly composing a note, task, event, email, or message? Explicit requests to an assistant take priority over mentions of those content types.",
    ),
    (
        InputIntent::Search,
        "Is the author trying to find existing content in Macro (documents, emails, tasks, messages), rather than asking for an explanation or web research?",
    ),
    (
        InputIntent::Email,
        "Is this an email being composed, or a direct instruction to send an email, rather than a request for an AI to draft one? Email-specific addressing, subject lines, greetings and signatures are evidence; a greeting alone is not enough.",
    ),
    (
        InputIntent::Note,
        "Is this content to keep as a Markdown note or document, such as observations, prose, an outline or reference material, rather than a question, a message to someone, or an action to perform?",
    ),
    (
        InputIntent::Task,
        "Is this a to-do or deliverable to track, possibly with a deadline? A deadline such as 'finish the report by Friday' is a task; a scheduled activity such as 'Call John at 3pm tomorrow' is a calendar event instead.",
    ),
    (
        InputIntent::Calendar,
        "Is this an activity to put on a calendar at a particular time, such as 'Call John at 3pm tomorrow', a meeting or appointment? A timed call is an event even without the word schedule. A deliverable with a deadline is a task instead.",
    ),
    (
        InputIntent::Message,
        "Is the author composing a chat message or asking to DM someone or post to a channel, rather than composing email or asking an AI for help? There should be evidence of a chat recipient or conversational message intent.",
    ),
];

/// A draft snapshot. Revisions are opaque to the server and echoed to the client.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ClassifyInputRequest {
    pub text: String,
    pub revision: u32,
}

/// Independent yes/no probabilities; these do not sum to one.
#[derive(Debug, Serialize, ToSchema)]
pub struct IntentScore {
    pub intent: InputIntent,
    pub score: f32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ClassifyInputResponse {
    pub revision: u32,
    pub scores: Vec<IntentScore>,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct ExtractInputRequest {
    pub text: String,
    pub intent: InputIntent,
    pub revision: u32,
    pub reference_time: DateTime<Utc>,
    pub time_zone: String,
}

/// Suggestions are text, never authorized recipient, channel or calendar IDs.
#[derive(Debug, Default, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InputSuggestions {
    pub title: Option<String>,
    pub body: Option<String>,
    pub subject: Option<String>,
    #[serde(default)]
    pub recipients: Vec<String>,
    pub query: Option<String>,
    /// Local wall-clock values, interpreted in the request's IANA timezone.
    pub start: Option<String>,
    pub end: Option<String>,
    pub due_date: Option<String>,
    pub location: Option<String>,
    /// Only populated when an invitation was explicitly requested.
    #[serde(default)]
    pub guests: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ExtractInputResponse {
    pub revision: u32,
    pub intent: InputIntent,
    pub suggestions: InputSuggestions,
}

#[derive(Debug, thiserror::Error)]
pub enum InputError {
    #[error("Enter between 1 and 16000 characters")]
    InvalidText,
    #[error("Choose a valid timezone")]
    InvalidTimeZone,
    #[error("Automatic detection is unavailable; choose a type to continue")]
    Unavailable,
    #[error("Could not extract fields; fill them in to continue")]
    Extraction,
    #[error(transparent)]
    Admission(#[from] AiAdmissionError),
}

/// The capability needed to suggest fields without tools or writes.
pub trait FieldExtractor: Send + Sync {
    fn extract(
        &self,
        input: &ExtractInputRequest,
        usage: UsageContext,
    ) -> impl Future<Output = Result<InputSuggestions, InputError>> + Send;
}

pub struct UniversalInputService<C, E> {
    classifier: Option<C>,
    extractor: E,
    admission: Arc<dyn AiAdmissionService>,
}

impl<C: YesNoClassifier, E: FieldExtractor> UniversalInputService<C, E> {
    pub fn new(
        classifier: Option<C>,
        extractor: E,
        admission: Arc<dyn AiAdmissionService>,
    ) -> Self {
        Self {
            classifier,
            extractor,
            admission,
        }
    }

    #[tracing::instrument(skip_all, err)]
    pub async fn classify(
        &self,
        user: MacroUserIdStr<'static>,
        input: ClassifyInputRequest,
    ) -> Result<ClassifyInputResponse, InputError> {
        validate_text(&input.text)?;
        let classifier = self.classifier.as_ref().ok_or(InputError::Unavailable)?;
        self.admission
            .admit(&user, AiFeature::DynamicCompletionsApi)
            .await?;
        let questions = INTENT_QUESTIONS
            .iter()
            .map(|(_, text)| {
                YesNoQuestion::try_from(*text).expect("fixed intent question is valid")
            })
            .collect::<Vec<_>>();
        let scores = classifier
            .classify(
                UsageContext::new(AiFeature::DynamicCompletionsApi, user),
                &serde_json::json!({ "draft": input.text }),
                &questions,
            )
            .await
            .map_err(|_| InputError::Unavailable)?;
        if scores.len() != INTENT_QUESTIONS.len() {
            return Err(InputError::Unavailable);
        }
        Ok(ClassifyInputResponse {
            revision: input.revision,
            scores: INTENT_QUESTIONS
                .iter()
                .zip(scores)
                .map(|((intent, _), score)| IntentScore {
                    intent: *intent,
                    score: score.get(),
                })
                .collect(),
        })
    }

    #[tracing::instrument(skip_all, err)]
    pub async fn extract(
        &self,
        user: MacroUserIdStr<'static>,
        input: ExtractInputRequest,
    ) -> Result<ExtractInputResponse, InputError> {
        validate_text(&input.text)?;
        let zone = input
            .time_zone
            .parse::<chrono_tz::Tz>()
            .map_err(|_| InputError::InvalidTimeZone)?;
        self.admission
            .admit(&user, AiFeature::DynamicCompletionsApi)
            .await?;
        let mut suggestions = self
            .extractor
            .extract(
                &input,
                UsageContext::new(AiFeature::DynamicCompletionsApi, user),
            )
            .await?;
        // Reject nonexistent/ambiguous wall times rather than silently shifting an event at DST.
        for value in [&mut suggestions.start, &mut suggestions.end] {
            if value.as_ref().is_some_and(|text| {
                NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M")
                    .ok()
                    .and_then(|date| zone.from_local_datetime(&date).single())
                    .is_none()
            }) {
                *value = None;
            }
        }
        Ok(ExtractInputResponse {
            revision: input.revision,
            intent: input.intent,
            suggestions,
        })
    }
}

fn validate_text(text: &str) -> Result<(), InputError> {
    if text.trim().is_empty() || text.chars().count() > 16_000 {
        return Err(InputError::InvalidText);
    }
    Ok(())
}
