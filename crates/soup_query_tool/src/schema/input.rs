//! GraphQL input types and their translation into the domain listing request.

use async_graphql::{Enum, InputObject};
use email::domain::models::PreviewView;
use graphql_soup_filter_input::{
    GraphqlCalendarEventExpr, GraphqlCallExpr, GraphqlChannelExpr, GraphqlChannelThreadExpr,
    GraphqlChatExpr, GraphqlDocumentExpr, GraphqlEmailExpr, GraphqlFilterPropertiesExpr,
    GraphqlForeignEntityExpr, GraphqlProjectExpr, materialize_graphql_filter,
};
use models_pagination::SimpleSortMethod;
use models_properties::service::tag_sets::{TagFilter, TagMatch, TagScope};
use non_empty::NonEmpty;
use soup::domain::agent_listing::{
    AgentListingRequest, AgentSoupKind, EmailPreset, EmailScope, InboxSelector, Limit,
    TagSelection, TaskSelection,
};
use soup::domain::models::SoupSortDirection;
use system_properties::{PriorityOption, StatusOption};

/// `enum GraphqlSoupEntityType`, curated to the nine kinds this tool serves.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Hash, Debug)]
#[graphql(name = "GraphqlSoupEntityType")]
pub(crate) enum SoupKind {
    /// A Macro document, including tasks, snippets, and skills.
    Document,
    /// An AI chat.
    Chat,
    /// A project.
    Project,
    /// An email thread.
    EmailThread,
    /// A channel.
    Channel,
    /// A channel thread root.
    ChannelMessage,
    /// A call record.
    Call,
    /// A calendar event.
    CalendarEvent,
    /// A connected foreign record.
    ForeignEntity,
}

impl SoupKind {
    /// Every kind, in schema order.
    pub(crate) const ALL: [SoupKind; 9] = [
        SoupKind::Document,
        SoupKind::Chat,
        SoupKind::Project,
        SoupKind::EmailThread,
        SoupKind::Channel,
        SoupKind::ChannelMessage,
        SoupKind::Call,
        SoupKind::CalendarEvent,
        SoupKind::ForeignEntity,
    ];
}

impl From<SoupKind> for AgentSoupKind {
    fn from(kind: SoupKind) -> Self {
        match kind {
            SoupKind::Document => Self::Document,
            SoupKind::Chat => Self::Chat,
            SoupKind::Project => Self::Project,
            SoupKind::EmailThread => Self::EmailThread,
            SoupKind::Channel => Self::Channel,
            SoupKind::ChannelMessage => Self::ChannelMessage,
            SoupKind::Call => Self::Call,
            SoupKind::CalendarEvent => Self::CalendarEvent,
            SoupKind::ForeignEntity => Self::ForeignEntity,
        }
    }
}

/// High-level email filter preset.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
#[graphql(name = "SoupEmailPreset")]
pub(crate) enum SoupEmailPreset {
    /// Important and not shared.
    Signal,
}

impl From<SoupEmailPreset> for EmailPreset {
    fn from(preset: SoupEmailPreset) -> Self {
        match preset {
            SoupEmailPreset::Signal => Self::Signal,
        }
    }
}

/// Sort field. Default UPDATED_AT.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
#[graphql(name = "GraphqlSimpleSortMethod")]
pub(crate) enum SoupSortMethod {
    /// Most recently viewed.
    ViewedAt,
    /// Creation timestamp.
    CreatedAt,
    /// Update timestamp.
    UpdatedAt,
    /// Viewed, falling back to updated.
    ViewedUpdated,
}

impl From<SoupSortMethod> for SimpleSortMethod {
    fn from(sort: SoupSortMethod) -> Self {
        match sort {
            SoupSortMethod::ViewedAt => Self::ViewedAt,
            SoupSortMethod::CreatedAt => Self::CreatedAt,
            SoupSortMethod::UpdatedAt => Self::UpdatedAt,
            SoupSortMethod::ViewedUpdated => Self::ViewedUpdated,
        }
    }
}

/// Sort direction. Default DESC.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
#[graphql(name = "GraphqlSortDirection")]
pub(crate) enum SoupSortDir {
    /// Oldest first.
    Asc,
    /// Newest first.
    Desc,
}

/// How multiple tag filters combine.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
#[graphql(name = "SoupTagMatch")]
pub(crate) enum SoupTagMatch {
    /// At least one tag.
    Any,
    /// Every tag.
    All,
}

/// Whose tag set a label came from.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
#[graphql(name = "SoupTagScope")]
pub(crate) enum SoupTagScope {
    /// The caller's personal tags.
    Personal,
    /// A team tag set.
    Team,
}

impl From<TagScope> for SoupTagScope {
    fn from(scope: TagScope) -> Self {
        match scope {
            TagScope::Personal => Self::Personal,
            TagScope::Team => Self::Team,
        }
    }
}

impl From<SoupTagScope> for TagScope {
    fn from(scope: SoupTagScope) -> Self {
        match scope {
            SoupTagScope::Personal => Self::Personal,
            SoupTagScope::Team => Self::Team,
        }
    }
}

/// System task status.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum TaskStatus {
    /// Not started.
    NotStarted,
    /// In progress.
    InProgress,
    /// In review.
    InReview,
    /// Completed.
    Completed,
    /// Canceled.
    Canceled,
}

impl From<TaskStatus> for StatusOption {
    fn from(status: TaskStatus) -> Self {
        match status {
            TaskStatus::NotStarted => Self::NotStarted,
            TaskStatus::InProgress => Self::InProgress,
            TaskStatus::InReview => Self::InReview,
            TaskStatus::Completed => Self::Completed,
            TaskStatus::Canceled => Self::Canceled,
        }
    }
}

/// System task priority.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum TaskPriority {
    /// Low.
    Low,
    /// Medium.
    Medium,
    /// High.
    High,
    /// Urgent.
    Urgent,
}

impl From<TaskPriority> for PriorityOption {
    fn from(priority: TaskPriority) -> Self {
        match priority {
            TaskPriority::Low => Self::Low,
            TaskPriority::Medium => Self::Medium,
            TaskPriority::High => Self::High,
            TaskPriority::Urgent => Self::Urgent,
        }
    }
}

/// Tasks by status, assignee, and priority. No property ids needed. Date
/// windows go in `filters.documentFilter` like every other kind.
#[derive(InputObject, Clone, Debug)]
pub(crate) struct TaskFilter {
    /// Status options to include.
    pub(crate) status: Option<Vec<TaskStatus>>,
    /// Priority options to include.
    pub(crate) priority: Option<Vec<TaskPriority>>,
    /// Tasks assigned to the current user.
    pub(crate) assigned_to_me: Option<bool>,
    /// Assignees as `macro|<email>` refs or plain emails.
    pub(crate) assigned_to: Option<Vec<String>>,
}

impl From<TaskFilter> for TaskSelection {
    fn from(filter: TaskFilter) -> Self {
        Self {
            status: filter
                .status
                .unwrap_or_default()
                .into_iter()
                .map(Into::into)
                .collect(),
            priority: filter
                .priority
                .unwrap_or_default()
                .into_iter()
                .map(Into::into)
                .collect(),
            assigned_to_me: filter.assigned_to_me.unwrap_or(false),
            assigned_to: filter.assigned_to.unwrap_or_default(),
        }
    }
}

/// One tag selector by label.
#[derive(InputObject)]
#[graphql(name = "SoupTagFilterInput")]
struct SoupTagFilterInput {
    label: String,
    scope: Option<SoupTagScope>,
}

/// `input GraphqlEmailFilterAst` minus `crmScope`.
#[derive(InputObject, serde::Serialize)]
#[graphql(name = "GraphqlEmailFilterAst")]
#[serde(rename_all = "camelCase")]
struct SoupEmailFilterInput {
    tree: Option<GraphqlEmailExpr>,
}

/// `input GraphqlEntityFilterAst` minus CRM and reminder trees.
#[derive(InputObject, serde::Serialize)]
#[graphql(name = "GraphqlEntityFilterAst")]
#[serde(rename_all = "camelCase")]
struct SoupFilterInput {
    document_filter: Option<GraphqlDocumentExpr>,
    project_filter: Option<GraphqlProjectExpr>,
    chat_filter: Option<GraphqlChatExpr>,
    email_filter: Option<SoupEmailFilterInput>,
    channel_filter: Option<GraphqlChannelExpr>,
    channel_thread_filter: Option<GraphqlChannelThreadExpr>,
    call_filter: Option<GraphqlCallExpr>,
    calendar_event_filter: Option<GraphqlCalendarEventExpr>,
    foreign_entity_filter: Option<GraphqlForeignEntityExpr>,
    properties_filter: Option<GraphqlFilterPropertiesExpr>,
}

/// `input SoupQueryInput`. Every field optional.
#[derive(InputObject, Default)]
#[graphql(name = "SoupQueryInput")]
pub(crate) struct SoupQueryInput {
    /// Kinds to return. Omit for all.
    entity_types: Option<Vec<SoupKind>>,
    /// Per-kind filter trees. DescribeSoup shows each kind's literal.
    filters: Option<SoupFilterInput>,
    /// Task sugar over the well-known Status / Assignees / Priority properties.
    task_filter: Option<TaskFilter>,
    /// Default UPDATED_AT.
    sort_method: Option<SoupSortMethod>,
    /// Default DESC.
    sort_direction: Option<SoupSortDir>,
    /// Default 50, max 500.
    limit: Option<i32>,
    /// SIGNAL = important threads, shared threads excluded.
    email_preset: Option<SoupEmailPreset>,
    /// Mailbox view: inbox, sent, drafts, starred, all, important, other, or user:<label>.
    email_view: Option<String>,
    /// Restrict email results to one connected inbox by address.
    inbox: Option<String>,
    /// Only items carrying these tags, by label.
    tags: Option<Vec<SoupTagFilterInput>>,
    /// ANY unless set.
    tags_match: Option<SoupTagMatch>,
}

/// Why GraphQL input could not become a listing request.
#[derive(Debug, thiserror::Error)]
pub(crate) enum InputRejected {
    /// Limit outside the accepted range.
    #[error("limit must be between {min} and {max} (got {0})", min = Limit::MIN, max = Limit::MAX)]
    Limit(i64),
    /// Empty `entityTypes`.
    #[error("entityTypes must not be empty; omit it to return every kind")]
    EmptyEntityTypes,
    /// Filter tree failed ingress bounds or conversion.
    #[error("{0}")]
    Filters(#[from] graphql_soup_filter_input::MaterializeError),
    /// `emailView` did not parse.
    #[error("invalid emailView: {0}")]
    EmailView(String),
    /// Filter JSON could not be serialized.
    #[error("failed to encode filters: {0}")]
    Encode(#[from] serde_json::Error),
}

impl SoupQueryInput {
    /// GraphQL input → validated domain request. Pure besides filter materialization.
    pub(crate) fn into_listing(self) -> Result<AgentListingRequest, InputRejected> {
        let limit = match self.limit {
            None => Limit::default(),
            Some(value) => u16::try_from(value)
                .ok()
                .and_then(|value| Limit::new(value).ok())
                .ok_or(InputRejected::Limit(i64::from(value)))?,
        };
        let kinds = match self.entity_types {
            Some(types) => Some(
                NonEmpty::new(types.into_iter().map(AgentSoupKind::from).collect())
                    .map_err(|_| InputRejected::EmptyEntityTypes)?,
            ),
            None => None,
        };
        let filters = match self.filters {
            None => item_filters::ast::EntityFilterAst::default(),
            Some(input) => materialize_graphql_filter(serde_json::to_value(input)?)?,
        };
        let tags = match self.tags.filter(|tags| !tags.is_empty()) {
            None => None,
            Some(tags) => Some(TagSelection {
                filters: NonEmpty::new(
                    tags.into_iter()
                        .map(|tag| TagFilter {
                            label: tag.label,
                            scope: tag.scope.map(TagScope::from),
                        })
                        .collect(),
                )
                .expect("non-empty tags already filtered"),
                mode: match self.tags_match.unwrap_or(SoupTagMatch::Any) {
                    SoupTagMatch::Any => TagMatch::Any,
                    SoupTagMatch::All => TagMatch::All,
                },
            }),
        };
        let view = self
            .email_view
            .as_deref()
            .map(str::trim)
            .filter(|view| !view.is_empty())
            .map(|view| view.parse::<PreviewView>())
            .transpose()
            .map_err(|error| InputRejected::EmailView(error.to_string()))?
            .unwrap_or_default();
        Ok(AgentListingRequest {
            kinds,
            filters,
            task: self.task_filter.map(TaskSelection::from),
            sort: self
                .sort_method
                .map(SimpleSortMethod::from)
                .unwrap_or(SimpleSortMethod::UpdatedAt),
            direction: match self.sort_direction {
                Some(SoupSortDir::Asc) => SoupSortDirection::Asc,
                Some(SoupSortDir::Desc) | None => SoupSortDirection::Desc,
            },
            limit,
            email: EmailScope {
                view,
                inbox: self.inbox.and_then(InboxSelector::new),
                preset: self.email_preset.map(EmailPreset::from),
            },
            tags,
        })
    }
}
