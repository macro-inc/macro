//! GraphQL input types and the listing-request boundary.

use async_graphql::{Enum, InputObject};
use chrono::{DateTime, Utc};
use email::domain::models::PreviewView;
use filter_ast::Expr;
use graphql_soup_filter_input::{
    GraphqlCalendarEventExpr, GraphqlCallExpr, GraphqlChannelExpr, GraphqlChannelThreadExpr,
    GraphqlChatExpr, GraphqlDocumentExpr, GraphqlEmailExpr, GraphqlFilterPropertiesExpr,
    GraphqlForeignEntityExpr, GraphqlProjectExpr, materialize_graphql_filter,
};
use item_filters::ast::document::DocumentLiteral;
use models_pagination::SimpleSortMethod;
use models_properties::service::tag_sets::{TagFilter, TagMatch};
use non_empty::NonEmpty;
use soup::domain::models::SoupSortDirection;

use crate::listing::{EmailScope, InboxSelector, Limit, ListingRequest, TagSelection};

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

/// High-level email filter preset.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
#[graphql(name = "SoupEmailPreset")]
pub(crate) enum SoupEmailPreset {
    /// Important and not shared.
    Signal,
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

impl SoupSortMethod {
    fn into_model(self) -> SimpleSortMethod {
        match self {
            Self::ViewedAt => SimpleSortMethod::ViewedAt,
            Self::CreatedAt => SimpleSortMethod::CreatedAt,
            Self::UpdatedAt => SimpleSortMethod::UpdatedAt,
            Self::ViewedUpdated => SimpleSortMethod::ViewedUpdated,
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

impl From<models_properties::service::tag_sets::TagScope> for SoupTagScope {
    fn from(scope: models_properties::service::tag_sets::TagScope) -> Self {
        match scope {
            models_properties::service::tag_sets::TagScope::Personal => Self::Personal,
            models_properties::service::tag_sets::TagScope::Team => Self::Team,
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

/// Half-open RFC 3339 window: `from <= t < until`.
#[derive(InputObject, Clone, Debug)]
pub(crate) struct DateRange {
    /// Inclusive start.
    pub(crate) from: Option<String>,
    /// Exclusive end.
    pub(crate) until: Option<String>,
}

impl DateRange {
    pub(crate) fn document_literals(
        &self,
        updated: bool,
    ) -> Result<Vec<Expr<DocumentLiteral>>, crate::listing::ListingError> {
        let parse = |value: &str| {
            DateTime::parse_from_rfc3339(value)
                .map(|date| date.with_timezone(&Utc))
                .map_err(|error| {
                    crate::listing::ListingError::Task(format!(
                        "invalid RFC3339 date `{value}`: {error}"
                    ))
                })
        };
        let mut out = Vec::new();
        if let Some(from) = &self.from {
            let date = item_filters::ast::date::DateLiteral::GreaterThanOrEqual(parse(from)?);
            out.push(Expr::val(if updated {
                DocumentLiteral::UpdatedAt(date)
            } else {
                DocumentLiteral::CreatedAt(date)
            }));
        }
        if let Some(until) = &self.until {
            let date = item_filters::ast::date::DateLiteral::LessThan(parse(until)?);
            out.push(Expr::val(if updated {
                DocumentLiteral::UpdatedAt(date)
            } else {
                DocumentLiteral::CreatedAt(date)
            }));
        }
        Ok(out)
    }
}

/// Tasks by status, assignee, priority, and date. No property ids needed.
#[derive(InputObject, Clone, Debug)]
pub(crate) struct TaskFilter {
    /// Status options to include.
    pub(crate) status: Option<Vec<TaskStatus>>,
    /// Priority options to include.
    pub(crate) priority: Option<Vec<TaskPriority>>,
    /// Tasks assigned to the current user.
    pub(crate) assigned_to_me: Option<bool>,
    /// Assignee entity refs (`macro|<email>`) or emails.
    pub(crate) assigned_to: Option<Vec<String>>,
    /// Updated-at window.
    pub(crate) updated_at: Option<DateRange>,
    /// Created-at window.
    pub(crate) created_at: Option<DateRange>,
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

/// `input SoupQueryInput`. Every field optional; `Default` gives `= {}`.
#[derive(InputObject, Default)]
#[graphql(name = "SoupQueryInput")]
pub(crate) struct SoupQueryInput {
    /// Kinds to return. Omit for all.
    entity_types: Option<Vec<SoupKind>>,
    /// Per-kind filter trees.
    filters: Option<SoupFilterInput>,
    /// Task sugar over the well-known Status / Assignees / Priority properties.
    task_filter: Option<TaskFilter>,
    /// Default UPDATED_AT.
    sort_method: Option<SoupSortMethod>,
    /// Default DESC.
    sort_direction: Option<SoupSortDir>,
    /// Default 50, max 500.
    limit: Option<u16>,
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
    /// Limit outside 1..=500.
    #[error("limit must be between 1 and 500 (got {0})")]
    Limit(u16),
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
    /// GraphQL input → validated `ListingRequest`. Pure besides filter materialization.
    pub(crate) fn into_listing(self) -> Result<ListingRequest, InputRejected> {
        let limit = Limit::new(self.limit.unwrap_or(50)).map_err(InputRejected::Limit)?;
        let kinds = match self.entity_types {
            Some(types) => Some(NonEmpty::new(types).map_err(|_| InputRejected::EmptyEntityTypes)?),
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
                            scope: tag.scope.map(|scope| match scope {
                                SoupTagScope::Personal => {
                                    models_properties::service::tag_sets::TagScope::Personal
                                }
                                SoupTagScope::Team => {
                                    models_properties::service::tag_sets::TagScope::Team
                                }
                            }),
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
        Ok(ListingRequest {
            kinds,
            filters,
            task: self.task_filter,
            sort: self
                .sort_method
                .map(SoupSortMethod::into_model)
                .unwrap_or(SimpleSortMethod::UpdatedAt),
            direction: match self.sort_direction {
                Some(SoupSortDir::Asc) => SoupSortDirection::Asc,
                Some(SoupSortDir::Desc) | None => SoupSortDirection::Desc,
            },
            limit,
            email: EmailScope {
                view,
                inbox: self.inbox.and_then(InboxSelector::new),
                preset: self.email_preset,
            },
            tags,
        })
    }
}
