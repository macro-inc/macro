//! Select a search type before extracting only the filters supported by that type.
use super::{ExtractInputRequest, FieldExtractor, InputError, InputIntent, InputSuggestions};
use ai_usage::UsageContext;
use schemars::{JsonSchema, generate::SchemaSettings};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::future::Future;
use utoipa::ToSchema;

/// Search indexes supported by the shared search editor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum SearchType {
    /// Mixed content without type-specific filters.
    All,
    /// Channel messages.
    Channels,
    /// Documents and files.
    DocumentOrFile,
    /// Tracked tasks.
    Task,
    /// Email threads.
    Email,
    /// Recorded calls.
    Calls,
    /// Folders.
    Folders,
    /// AI conversations.
    Agent,
    /// Calendar events.
    Calendar,
}

impl SearchType {
    /// Normalize a provider-selected category span, never the source draft itself.
    pub fn from_scope(scope: Option<&str>) -> Result<Self, InputError> {
        match scope.map(str::trim).map(str::to_lowercase).as_deref() {
            None | Some("all") => Ok(Self::All),
            Some(
                "channel" | "channels" | "message" | "messages" | "channel message"
                | "channel messages" | "dm" | "dms" | "direct message" | "direct messages",
            ) => Ok(Self::Channels),
            Some(
                "document" | "documents" | "file" | "files" | "note" | "notes" | "document-or-file",
            ) => Ok(Self::DocumentOrFile),
            Some("task" | "tasks") => Ok(Self::Task),
            Some("email" | "emails") => Ok(Self::Email),
            Some("call" | "calls") => Ok(Self::Calls),
            Some("folder" | "folders") => Ok(Self::Folders),
            Some("agent" | "agents" | "ai chat" | "ai chats") => Ok(Self::Agent),
            Some("calendar" | "event" | "events" | "calendar event" | "calendar events") => {
                Ok(Self::Calendar)
            }
            _ => Err(InputError::Extraction),
        }
    }

    /// Generate the extraction schema directly from the selected response model.
    pub fn schema(self) -> Value {
        fn schema<T: JsonSchema>() -> Value {
            let settings = SchemaSettings::draft2020_12().with(|settings| {
                settings.meta_schema = None;
                settings.inline_subschemas = true;
            });
            let mut schema = settings
                .into_generator()
                .into_root_schema_for::<T>()
                .to_value();
            if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
                schema["required"] = properties.keys().cloned().collect::<Vec<_>>().into();
            }
            schema
        }
        match self {
            Self::Channels => schema::<ChannelSearchSuggestions>(),
            Self::Task => schema::<TaskSearchSuggestions>(),
            Self::Calls => schema::<CallSearchSuggestions>(),
            Self::Email => schema::<EmailSearchSuggestions>(),
            _ => schema::<QuerySearchSuggestions>(),
        }
    }

    /// Field names come from the typed response schema, not a second registry.
    pub fn fields(self) -> Vec<String> {
        self.schema()["properties"]
            .as_object()
            .map(|properties| properties.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// Meaning of a field in this search type, shared by extraction adapters.
    pub fn guidance(self, field: &str) -> Option<&'static str> {
        match (self, field) {
            (
                Self::All | Self::DocumentOrFile | Self::Folders | Self::Agent | Self::Calendar,
                "query",
            ) => Some(include_str!(
                "../../prompts/extract_search_unfiltered_query_prompt.txt"
            )),
            (_, "query") => Some(include_str!(
                "../../prompts/extract_search_query_prompt.txt"
            )),
            (Self::Channels, "from") => {
                Some(include_str!("../../prompts/typed_search_from_prompt.txt"))
            }
            (Self::Calls, "from") => {
                Some(include_str!("../../prompts/search_call_from_prompt.txt"))
            }
            (Self::Channels | Self::Calls, "in") => {
                Some(include_str!("../../prompts/typed_search_in_prompt.txt"))
            }
            (Self::Task, "status") => {
                Some(include_str!("../../prompts/search_task_status_prompt.txt"))
            }
            (Self::Task, "priority") => Some(include_str!(
                "../../prompts/search_task_priority_prompt.txt"
            )),
            (Self::Task, "assignees") => Some(include_str!(
                "../../prompts/search_task_assignees_prompt.txt"
            )),
            (Self::Task, "created_by") => Some(include_str!(
                "../../prompts/search_task_created_by_prompt.txt"
            )),
            (Self::Calls, "status") => {
                Some(include_str!("../../prompts/search_call_status_prompt.txt"))
            }
            (Self::Email, "importance") => Some(include_str!(
                "../../prompts/search_email_importance_prompt.txt"
            )),
            (Self::Email, "inboxes") => Some(include_str!(
                "../../prompts/search_email_inboxes_prompt.txt"
            )),
            _ => None,
        }
    }
}

/// Only the selected type's fields can appear in a search suggestion.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum SearchSuggestions {
    /// Query across content types.
    All(QuerySearchSuggestions),
    /// Message topic, senders and channels.
    Channels(ChannelSearchSuggestions),
    /// Document or file topic.
    DocumentOrFile(QuerySearchSuggestions),
    /// Task topic and supported task facets.
    Task(TaskSearchSuggestions),
    /// Email topic, importance and inbox addresses.
    Email(EmailSearchSuggestions),
    /// Call topic, speakers, channels and attendance.
    Calls(CallSearchSuggestions),
    /// Folder topic.
    Folders(QuerySearchSuggestions),
    /// AI conversation topic.
    Agent(QuerySearchSuggestions),
    /// Calendar event topic.
    Calendar(QuerySearchSuggestions),
}

impl SearchSuggestions {
    /// Type fixed before field extraction; providers cannot change it afterward.
    pub fn search_type(&self) -> SearchType {
        match self {
            Self::All(_) => SearchType::All,
            Self::Channels(_) => SearchType::Channels,
            Self::DocumentOrFile(_) => SearchType::DocumentOrFile,
            Self::Task(_) => SearchType::Task,
            Self::Email(_) => SearchType::Email,
            Self::Calls(_) => SearchType::Calls,
            Self::Folders(_) => SearchType::Folders,
            Self::Agent(_) => SearchType::Agent,
            Self::Calendar(_) => SearchType::Calendar,
        }
    }
}

/// A topic for search types without additional supported facets.
#[derive(Debug, Default, Clone, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct QuerySearchSuggestions {
    /// Remaining keyword phrase after supported filters and instructions.
    pub query: Option<String>,
}

/// Message filters remain display names until resolved against the user's directory.
#[derive(Debug, Default, Clone, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ChannelSearchSuggestions {
    /// Remaining keyword phrase.
    pub query: Option<String>,
    /// Explicit message sender names or addresses.
    pub from: Vec<String>,
    /// Explicit channel names.
    pub r#in: Vec<String>,
}

/// Task facets match the shared search editor; assignee and creator are distinct.
#[derive(Debug, Default, Clone, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TaskSearchSuggestions {
    /// Remaining keyword phrase.
    pub query: Option<String>,
    /// Status display values for client-side option resolution.
    pub status: Vec<String>,
    /// Priority display values for client-side option resolution.
    pub priority: Vec<String>,
    /// Assigned people's names or supplied addresses.
    pub assignees: Vec<String>,
    /// Task creators' names or supplied addresses.
    pub created_by: Vec<String>,
}

/// Call search supports speakers, channels and attendance status.
#[derive(Debug, Default, Clone, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CallSearchSuggestions {
    /// Remaining keyword phrase.
    pub query: Option<String>,
    /// Speaker names or supplied addresses.
    pub from: Vec<String>,
    /// Channel names.
    pub r#in: Vec<String>,
    /// Attendance display value, resolved against supported options by the client.
    pub status: Option<String>,
}

/// Email search exposes importance and connected inbox addresses, not sender filters.
#[derive(Debug, Default, Clone, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EmailSearchSuggestions {
    /// Remaining keyword phrase.
    pub query: Option<String>,
    /// Explicit importance wording, resolved by the client.
    pub importance: Option<String>,
    /// Explicit connected inbox addresses, resolved by the client.
    pub inboxes: Vec<String>,
}

/// Search-specific model capabilities, independent of provider wire formats.
pub trait SearchExtractor: Send + Sync {
    /// Identify the content type without extracting any type-specific fields.
    fn select_search_type(
        &self,
        input: &ExtractInputRequest,
        usage: UsageContext,
    ) -> impl Future<Output = Result<SearchType, InputError>> + Send;
    /// Extract only fields supported by the previously selected type.
    fn extract_search(
        &self,
        input: &ExtractInputRequest,
        search_type: SearchType,
        usage: UsageContext,
    ) -> impl Future<Output = Result<SearchSuggestions, InputError>> + Send;
}

/// Orchestrate search stages while preserving ordinary extraction for other intents.
pub struct WithSearchExtraction<F> {
    fields: F,
}

impl<F> WithSearchExtraction<F> {
    /// Compose a provider or fallback implementing both extraction ports.
    pub fn new(fields: F) -> Self {
        Self { fields }
    }
}

impl<F: FieldExtractor + SearchExtractor> FieldExtractor for WithSearchExtraction<F> {
    #[tracing::instrument(name = "universal_input.search", skip_all, err, fields(search_type = tracing::field::Empty, manual_type = input.search_type.is_some()))]
    async fn extract(
        &self,
        input: &ExtractInputRequest,
        usage: UsageContext,
    ) -> Result<InputSuggestions, InputError> {
        if input.intent != InputIntent::Search {
            return self.fields.extract(input, usage).await;
        }
        let mut scoped = input.clone();
        let task_options = std::mem::take(&mut scoped.property_definitions);
        let search_type = match input.search_type {
            Some(selected) => selected,
            None => {
                self.fields
                    .select_search_type(&scoped, usage.clone())
                    .await?
            }
        };
        if search_type == SearchType::Task {
            scoped.property_definitions = task_options;
        }
        tracing::Span::current().record("search_type", tracing::field::debug(search_type));
        let fields = self
            .fields
            .extract_search(&scoped, search_type, usage)
            .await?;
        if fields.search_type() != search_type {
            return Err(InputError::Extraction);
        }
        Ok(InputSuggestions::Search(fields))
    }
}

#[cfg(test)]
mod test;
