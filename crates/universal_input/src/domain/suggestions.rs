//! Intent-specific suggestions: fields cannot be attached to the wrong destination.
use super::{InputIntent, InputPropertySuggestion, SearchSuggestions};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A single inferred destination together with only its applicable fields.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "intent", content = "suggestions", rename_all = "snake_case")]
pub enum InputSuggestions {
    /// Editable ai fields.
    Ai(AiSuggestions),
    /// Editable search fields.
    Search(SearchSuggestions),
    /// Editable email fields.
    Email(EmailSuggestions),
    /// Editable note fields.
    Note(NoteSuggestions),
    /// Editable task fields.
    Task(TaskSuggestions),
    /// Editable calendar fields.
    Calendar(CalendarSuggestions),
    /// Editable message fields.
    Message(MessageSuggestions),
}

impl InputSuggestions {
    /// The destination is determined by the suggestion variant.
    pub fn intent(&self) -> InputIntent {
        match self {
            Self::Ai(..) => InputIntent::Ai,
            Self::Search(..) => InputIntent::Search,
            Self::Email(..) => InputIntent::Email,
            Self::Note(..) => InputIntent::Note,
            Self::Task(..) => InputIntent::Task,
            Self::Calendar(..) => InputIntent::Calendar,
            Self::Message(..) => InputIntent::Message,
        }
    }
}

/// Editable fields for ai inference, before submission and identity resolution.
#[derive(Debug, Default, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AiSuggestions {}

/// Editable fields for email inference, before submission and identity resolution.
#[derive(Debug, Default, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EmailSuggestions {
    /// Suggested outgoing email subject.
    pub subject: Option<String>,
    /// Suggested Markdown content or outgoing message body.
    pub body: Option<String>,
    /// Person or channel names for the client to resolve.
    #[serde(default)]
    pub recipients: Vec<String>,
    /// Explicit carbon-copy recipient names or supplied email addresses.
    #[serde(default)]
    pub cc: Vec<String>,
    /// Explicit blind-carbon-copy recipient names or supplied email addresses.
    #[serde(default)]
    pub bcc: Vec<String>,
}

/// Editable fields for note inference, before submission and identity resolution.
#[derive(Debug, Default, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct NoteSuggestions {
    /// Suggested note, task, or event title.
    pub title: Option<String>,
    /// Suggested Markdown content or outgoing message body.
    pub body: Option<String>,
}

/// Editable fields for task inference, before submission and identity resolution.
#[derive(Debug, Default, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TaskSuggestions {
    /// Suggested note, task, or event title.
    pub title: Option<String>,
    /// Suggested Markdown content or outgoing message body.
    pub body: Option<String>,
    /// Task deadline as a local ISO date.
    pub due_date: Option<String>,
    /// Display names/values that the client resolves against available task fields.
    #[serde(default)]
    pub properties: Vec<InputPropertySuggestion>,
}

/// Editable fields for calendar inference, before submission and identity resolution.
#[derive(Debug, Default, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CalendarSuggestions {
    /// Suggested note, task, or event title.
    pub title: Option<String>,
    /// Suggested Markdown content or outgoing message body.
    pub body: Option<String>,
    /// Local wall-clock values, interpreted in the request's IANA timezone.
    pub start: Option<String>,
    /// Event end as a local wall-clock value in the request's timezone.
    pub end: Option<String>,
    /// Verbatim clock phrase whose missing AM/PM required an editable assumption.
    pub start_assumption: Option<String>,
    /// Human-readable event venue or meeting URL.
    pub location: Option<String>,
    /// Only populated when an invitation was explicitly requested.
    #[serde(default)]
    pub guests: Vec<String>,
    /// Validated repetition values for the shared calendar composer.
    pub recurrence: Option<super::temporal::RecurrenceSuggestion>,
}

/// Editable fields for message inference, before submission and identity resolution.
#[derive(Debug, Default, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MessageSuggestions {
    /// Suggested Markdown content or outgoing message body.
    pub body: Option<String>,
    /// Person or channel names for the client to resolve.
    #[serde(default)]
    pub recipients: Vec<String>,
}
