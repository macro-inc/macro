//! GraphQL-free listing request, policy composition, and Soup execution.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use email::domain::models::PreviewView;
use email::domain::ports::EmailService;
use filter_ast::Expr;
use item_filters::SharedEmailFilter;
use item_filters::ast::{
    EntityFilterAst,
    calendar_event::CalendarEventLiteral,
    call::CallLiteral,
    channel::{ChannelLiteral, ChannelThreadLiteral},
    chat::ChatLiteral,
    crm_company::CrmCompanyLiteral,
    document::DocumentLiteral,
    email::EmailLiteral,
    foreign_entity::ForeignEntityLiteral,
    project::ProjectLiteral,
    properties::{EntityRefId, PropertiesLiteral, PropertyEntityType, PropertyMatchValue},
};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{SimpleSortMethod, TypeEraseCursor};
use models_properties::DataType;
use models_properties::service::property_value::PropertyValue;
use models_properties::service::tag_sets::{
    AppliedTag, CallerTagSets, TagFilter, TagFilterError, TagMatch,
};
use models_soup::SoupProperty;
use models_soup::item::SoupItem;
use non_empty::NonEmpty;
use soup::domain::models::SoupErr;
use soup::domain::models::{
    EnrichedSoupItem, SoupPropertiesField, SoupQuery, SoupRequest, SoupSortDirection, SoupType,
};
use soup::domain::ports::SoupService;
use system_properties::{PriorityOption, StatusOption, SystemPropertyKey};
use uuid::Uuid;

use crate::schema::input::{SoupEmailPreset, SoupKind, TaskFilter, TaskPriority, TaskStatus};

/// 1..=500. [`Limit::new`] is the only constructor.
#[derive(Copy, Clone, Debug)]
pub(crate) struct Limit(u16);

impl Limit {
    pub(crate) fn new(value: u16) -> Result<Self, u16> {
        if (1..=500).contains(&value) {
            Ok(Self(value))
        } else {
            Err(value)
        }
    }

    pub(crate) fn get(self) -> u16 {
        self.0
    }
}

/// Address of one connected inbox, trimmed and non-empty.
#[derive(Clone, Debug)]
pub(crate) struct InboxSelector(String);

impl InboxSelector {
    pub(crate) fn new(value: String) -> Option<Self> {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(Self(trimmed.to_owned()))
        }
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

/// Email scoping that is not a filter tree.
#[derive(Clone, Debug)]
pub(crate) struct EmailScope {
    pub(crate) view: PreviewView,
    pub(crate) inbox: Option<InboxSelector>,
    pub(crate) preset: Option<SoupEmailPreset>,
}

/// Tag labels the model asked for.
#[derive(Clone, Debug)]
pub(crate) struct TagSelection {
    pub(crate) filters: NonEmpty<Vec<TagFilter>>,
    pub(crate) mode: TagMatch,
}

/// A listing the tool has finished validating.
pub(crate) struct ListingRequest {
    pub(crate) kinds: Option<NonEmpty<Vec<SoupKind>>>,
    pub(crate) filters: EntityFilterAst,
    pub(crate) task: Option<TaskFilter>,
    pub(crate) sort: SimpleSortMethod,
    pub(crate) direction: SoupSortDirection,
    pub(crate) limit: Limit,
    pub(crate) email: EmailScope,
    pub(crate) tags: Option<TagSelection>,
}

/// One page of items with everything the projection needs.
pub(crate) struct ListingPage {
    pub(crate) items: Vec<SoupItem<SoupPropertiesField>>,
    pub(crate) has_more: bool,
    pub(crate) tag_labels: HashMap<Uuid, AppliedTag>,
}

/// Why a listing could not run.
#[derive(Debug, thiserror::Error)]
pub(crate) enum ListingError {
    /// Unknown or ambiguous tag label.
    #[error("{0}")]
    Tags(#[from] TagFilterError),
    /// Inbox address is not one the caller can read.
    #[error("{0}")]
    Inbox(String),
    /// Connected inboxes could not be loaded.
    #[error("failed to resolve email links: {0}")]
    EmailLinks(#[source] anyhow::Error),
    /// Soup listing failed.
    #[error("failed to list workspace items: {0}")]
    Soup(#[from] SoupErr),
    /// A task filter value could not be compiled.
    #[error("{0}")]
    Task(String),
}

/// The single listing port the resolver sees.
#[async_trait]
pub(crate) trait SoupLister: Send + Sync {
    async fn list(&self, request: ListingRequest) -> Result<ListingPage, ListingError>;
}

/// Where ListEntities' agent policy now lives.
pub(crate) struct SoupListing<T: SoupService, E: EmailService> {
    soup: Arc<T>,
    email: Arc<E>,
    user: MacroUserIdStr<'static>,
    self_chat_id: Option<Uuid>,
}

impl<T: SoupService, E: EmailService> SoupListing<T, E> {
    pub(crate) fn new(
        soup: Arc<T>,
        email: Arc<E>,
        user: MacroUserIdStr<'static>,
        self_chat_id: Option<Uuid>,
    ) -> Self {
        Self {
            soup,
            email,
            user,
            self_chat_id,
        }
    }

    async fn resolve_tags(
        &self,
        selection: &TagSelection,
    ) -> Result<(Option<Expr<PropertiesLiteral>>, CallerTagSets), ListingError> {
        let sets = self.caller_tag_sets().await?;
        let resolved = match selection.mode {
            TagMatch::Any => sets
                .resolve_filters(&selection.filters)
                .map_err(TagFilterError::from)?,
            TagMatch::All => sets.resolve_filters_unique(&selection.filters)?,
        };
        let combine = match selection.mode {
            TagMatch::Any => Expr::or,
            TagMatch::All => Expr::and,
        };
        let expr = resolved
            .into_iter()
            .map(|option| {
                Expr::val(PropertiesLiteral {
                    property_definition_id: option.definition_id,
                    entity_type: None,
                    value: PropertyMatchValue::SelectOption(option.option_id),
                })
            })
            .reduce(combine);
        Ok((expr, sets))
    }

    async fn link_ids(&self, inbox: Option<&InboxSelector>) -> Result<Vec<Uuid>, ListingError> {
        let inboxes = self
            .email
            .get_inboxes_for_macro_id(self.user.copied())
            .await
            .map_err(|error| ListingError::EmailLinks(error.into()))?;
        Ok(match inbox {
            Some(selector) => vec![
                email::inbound::toolset::resolve_inbox_selector(
                    &inboxes,
                    self.user.as_ref(),
                    Some(selector.as_str()),
                )
                .map_err(|error| ListingError::Inbox(error.description))?
                .id,
            ],
            None => inboxes.iter().map(|link| link.id).collect(),
        })
    }

    async fn caller_tag_sets(&self) -> Result<CallerTagSets, ListingError> {
        let definitions = self
            .soup
            .caller_tag_sets(self.user.copied())
            .await
            .map_err(ListingError::Soup)?;
        Ok(CallerTagSets::new(definitions))
    }
}

#[async_trait]
impl<T: SoupService, E: EmailService> SoupLister for SoupListing<T, E> {
    #[tracing::instrument(skip_all, err)]
    async fn list(&self, request: ListingRequest) -> Result<ListingPage, ListingError> {
        let (tag_expr, mut tag_sets) = match &request.tags {
            None => (None, None),
            Some(selection) => {
                let (expr, sets) = self.resolve_tags(selection).await?;
                (expr, Some(sets))
            }
        };
        let link_ids = self.link_ids(request.email.inbox.as_ref()).await?;
        let filters = compose_filters(&request, tag_expr, self.self_chat_id, self.user.as_ref())?;
        let output = self
            .soup
            .get_user_soup_with_properties(
                SoupRequest {
                    soup_type: SoupType::Expanded,
                    limit: request.limit.get(),
                    cursor: SoupQuery::new_sort_simple(request.sort, filters),
                    sort_direction: request.direction,
                    user: self.user.clone(),
                    email_preview_view: request.email.view,
                    link_ids,
                },
                None,
            )
            .await?;
        let page = output.type_erase();
        let has_more = page.next_cursor.is_some();
        let items: Vec<_> = page
            .items
            .into_iter()
            .map(|EnrichedSoupItem { item, .. }| item)
            .collect();
        if tag_sets.is_none() && any_item_has_tags(&items) {
            tag_sets = Some(self.caller_tag_sets().await?);
        }
        Ok(ListingPage {
            items,
            has_more,
            tag_labels: tag_sets
                .map(|sets| sets.applied_tag_by_option_id())
                .unwrap_or_default(),
        })
    }
}

/// Everything ListEntities did to the AST, as one function.
pub(crate) fn compose_filters(
    request: &ListingRequest,
    tags: Option<Expr<PropertiesLiteral>>,
    self_chat_id: Option<Uuid>,
    user: &str,
) -> Result<EntityFilterAst, ListingError> {
    let mut ast = request.filters.clone();
    let kinds = effective_kinds(request);
    if let Some(kinds) = kinds {
        ast = mask_kinds(ast, kinds);
    }
    ast.crm_company_filter = Some(Arc::new(Expr::val(CrmCompanyLiteral::Id(Uuid::nil()))));
    ast.reminder_filter = None;
    if let Some(preset) = request.email.preset {
        ast.email_filter.tree = Some(Arc::new(and_opt(
            preset.expr(),
            ast.email_filter.tree.take(),
        )));
    }
    if let Some(task) = &request.task {
        let (properties, document) = task.compile(user)?;
        if let Some(properties) = properties {
            ast.properties_filter =
                Some(Arc::new(and_opt(properties, ast.properties_filter.take())));
        }
        let task_document = Expr::val(DocumentLiteral::SubType(
            document_sub_type::DocumentSubType::Task,
        ));
        let document = match document {
            Some(dates) => Expr::and(task_document, dates),
            None => task_document,
        };
        ast.document_filter = Some(Arc::new(and_opt(document, ast.document_filter.take())));
    }
    if let Some(tags) = tags {
        ast.properties_filter = Some(Arc::new(and_opt(tags, ast.properties_filter.take())));
    }
    if let Some(id) = self_chat_id {
        let not_self = Expr::is_not(Expr::val(ChatLiteral::ChatId(id)));
        ast.chat_filter = Some(Arc::new(and_opt(not_self, ast.chat_filter.take())));
    }
    Ok(ast)
}

fn effective_kinds(request: &ListingRequest) -> Option<&[SoupKind]> {
    if let Some(kinds) = &request.kinds {
        return Some(kinds.as_slice());
    }
    if request.email.preset.is_some() {
        return Some(&[SoupKind::EmailThread]);
    }
    if request.task.is_some() {
        return Some(&[SoupKind::Document]);
    }
    None
}

impl SoupEmailPreset {
    pub(crate) fn expr(self) -> Expr<EmailLiteral> {
        match self {
            Self::Signal => Expr::and(
                Expr::val(EmailLiteral::Importance(true)),
                Expr::val(EmailLiteral::Shared(SharedEmailFilter::Exclude)),
            ),
        }
    }
}

impl TaskFilter {
    fn compile(
        &self,
        user: &str,
    ) -> Result<
        (
            Option<Expr<PropertiesLiteral>>,
            Option<Expr<DocumentLiteral>>,
        ),
        ListingError,
    > {
        let mut properties = Vec::new();
        if let Some(statuses) = &self.status {
            if let Some(expr) = or_selects(
                SystemPropertyKey::STATUS_UUID,
                statuses.iter().map(|status| status.option_id()),
            ) {
                properties.push(expr);
            }
        }
        if let Some(priorities) = &self.priority {
            if let Some(expr) = or_selects(
                SystemPropertyKey::PRIORITY_UUID,
                priorities.iter().map(|priority| priority.option_id()),
            ) {
                properties.push(expr);
            }
        }
        if self.assigned_to_me == Some(true) {
            properties.push(assignee_literal(user)?);
        }
        if let Some(assignees) = &self.assigned_to {
            let expr = assignees
                .iter()
                .map(|assignee| assignee_literal(assignee))
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .reduce(Expr::or);
            if let Some(expr) = expr {
                properties.push(expr);
            }
        }
        let properties = properties.into_iter().reduce(Expr::and);
        let mut dates = Vec::new();
        if let Some(range) = &self.updated_at {
            dates.extend(range.document_literals(true)?);
        }
        if let Some(range) = &self.created_at {
            dates.extend(range.document_literals(false)?);
        }
        let document = dates.into_iter().reduce(Expr::and);
        Ok((properties, document))
    }
}

impl TaskStatus {
    fn option_id(self) -> Uuid {
        match self {
            Self::NotStarted => StatusOption::NOT_STARTED_UUID,
            Self::InProgress => StatusOption::IN_PROGRESS_UUID,
            Self::InReview => StatusOption::IN_REVIEW_UUID,
            Self::Completed => StatusOption::COMPLETED_UUID,
            Self::Canceled => StatusOption::CANCELED_UUID,
        }
    }
}

impl TaskPriority {
    fn option_id(self) -> Uuid {
        match self {
            Self::Low => PriorityOption::LOW_UUID,
            Self::Medium => PriorityOption::MEDIUM_UUID,
            Self::High => PriorityOption::HIGH_UUID,
            Self::Urgent => PriorityOption::URGENT_UUID,
        }
    }
}

fn or_selects(
    definition: Uuid,
    options: impl Iterator<Item = Uuid>,
) -> Option<Expr<PropertiesLiteral>> {
    options
        .map(|option| {
            Expr::val(PropertiesLiteral {
                property_definition_id: definition,
                entity_type: Some(PropertyEntityType::Task),
                value: PropertyMatchValue::SelectOption(option),
            })
        })
        .reduce(Expr::or)
}

fn assignee_literal(value: &str) -> Result<Expr<PropertiesLiteral>, ListingError> {
    let id = EntityRefId::new(value.to_owned())
        .map_err(|error| ListingError::Task(error.to_string()))?;
    Ok(Expr::val(PropertiesLiteral {
        property_definition_id: SystemPropertyKey::ASSIGNEES_UUID,
        entity_type: Some(PropertyEntityType::Task),
        value: PropertyMatchValue::EntityRef(id),
    }))
}

/// `and(a, b)` when `b` is present, else `a`.
pub(crate) fn and_opt<L: Clone>(a: Expr<L>, b: Option<Arc<Expr<L>>>) -> Expr<L> {
    match b {
        Some(existing) => Expr::and(a, (*existing).clone()),
        None => a,
    }
}

fn mask_kinds(ast: EntityFilterAst, kinds: &[SoupKind]) -> EntityFilterAst {
    EntityFilterAst {
        calendar_event_filter: if kinds.contains(&SoupKind::CalendarEvent) {
            ast.calendar_event_filter
        } else {
            Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil()))))
        },
        document_filter: if kinds.contains(&SoupKind::Document) {
            ast.document_filter
        } else {
            Some(Arc::new(Expr::val(DocumentLiteral::Id(Uuid::nil()))))
        },
        project_filter: if kinds.contains(&SoupKind::Project) {
            ast.project_filter
        } else {
            Some(Arc::new(Expr::val(ProjectLiteral::ProjectId(Uuid::nil()))))
        },
        chat_filter: if kinds.contains(&SoupKind::Chat) {
            ast.chat_filter
        } else {
            Some(Arc::new(Expr::val(ChatLiteral::ChatId(Uuid::nil()))))
        },
        email_filter: if kinds.contains(&SoupKind::EmailThread) {
            ast.email_filter
        } else {
            item_filters::ast::EmailFilterAst {
                tree: Some(Arc::new(Expr::val(EmailLiteral::ThreadId(Uuid::nil())))),
                crm_scope: None,
            }
        },
        channel_filter: if kinds.contains(&SoupKind::Channel) {
            ast.channel_filter
        } else {
            Some(Arc::new(Expr::val(ChannelLiteral::ChannelId(Uuid::nil()))))
        },
        channel_thread_filter: if kinds.contains(&SoupKind::ChannelMessage) {
            ast.channel_thread_filter
        } else {
            Some(Arc::new(Expr::val(ChannelThreadLiteral::ThreadId(
                Uuid::nil(),
            ))))
        },
        call_filter: if kinds.contains(&SoupKind::Call) {
            ast.call_filter
        } else {
            Some(Arc::new(Expr::val(CallLiteral::CallId(Uuid::nil()))))
        },
        crm_company_filter: ast.crm_company_filter,
        foreign_entity_filter: if kinds.contains(&SoupKind::ForeignEntity) {
            ast.foreign_entity_filter
        } else {
            Some(Arc::new(Expr::val(ForeignEntityLiteral::Id(Uuid::nil()))))
        },
        reminder_filter: ast.reminder_filter,
        properties_filter: ast.properties_filter,
    }
}

fn any_item_has_tags(items: &[SoupItem<SoupPropertiesField>]) -> bool {
    items.iter().any(|item| {
        let properties = match item {
            SoupItem::Document(doc) => &doc.extra.properties,
            SoupItem::Chat(chat) => &chat.extra.properties,
            SoupItem::Project(project) => &project.extra.properties,
            SoupItem::EmailThread(thread) => &thread.extra.properties,
            SoupItem::CalendarEvent(event) => &event.extra.properties,
            SoupItem::Call(record) => &record.extra.properties,
            SoupItem::CrmCompany(company) => &company.extra.properties,
            SoupItem::Channel(_)
            | SoupItem::ChannelThread(_)
            | SoupItem::ForeignEntity(_)
            | SoupItem::Reminder(_) => return false,
        };
        properties
            .iter()
            .any(|property| property.definition.data_type == DataType::Tag)
    })
}

/// Tag-typed properties → labels via the caller's sets; unknown options dropped.
pub(crate) fn tags_of(
    properties: &[SoupProperty],
    labels: &HashMap<Uuid, AppliedTag>,
) -> Vec<AppliedTag> {
    let mut tags = Vec::new();
    for property in properties {
        if property.definition.data_type != DataType::Tag {
            continue;
        }
        let Some(PropertyValue::SelectOption(option_ids)) = &property.value else {
            continue;
        };
        for option_id in option_ids {
            if let Some(tag) = labels.get(option_id)
                && !tags.contains(tag)
            {
                tags.push(tag.clone());
            }
        }
    }
    tags
}

/// One-line count summary, matching ListEntities' caption.
pub(crate) fn build_summary(items: &[SoupItem<SoupPropertiesField>], has_more: bool) -> String {
    if items.is_empty() {
        return "No items found in workspace.".to_string();
    }
    let mut docs = 0;
    let mut chats = 0;
    let mut projects = 0;
    let mut emails = 0;
    let mut channels = 0;
    let mut channel_threads = 0;
    let mut calls = 0;
    let mut calendar_events = 0;
    let mut foreign_entities = 0;
    for item in items {
        match item {
            SoupItem::Document(_) => docs += 1,
            SoupItem::Chat(_) => chats += 1,
            SoupItem::Project(_) => projects += 1,
            SoupItem::EmailThread(_) => emails += 1,
            SoupItem::Channel(_) => channels += 1,
            SoupItem::ChannelThread(_) => channel_threads += 1,
            SoupItem::Call(_) => calls += 1,
            SoupItem::CalendarEvent(_) => calendar_events += 1,
            SoupItem::ForeignEntity(_) => foreign_entities += 1,
            SoupItem::CrmCompany(_) | SoupItem::Reminder(_) => {}
        }
    }
    let mut parts = Vec::new();
    push_count(&mut parts, docs, "document", "documents");
    push_count(&mut parts, chats, "AI conversation", "AI conversations");
    push_count(&mut parts, projects, "project", "projects");
    push_count(&mut parts, emails, "email", "emails");
    push_count(&mut parts, channels, "channel", "channels");
    push_count(
        &mut parts,
        channel_threads,
        "channel thread",
        "channel threads",
    );
    push_count(&mut parts, calls, "call record", "call records");
    push_count(
        &mut parts,
        calendar_events,
        "calendar event",
        "calendar events",
    );
    push_count(
        &mut parts,
        foreign_entities,
        "foreign entity",
        "foreign entities",
    );
    let counts = parts.join(", ");
    if has_more {
        format!("Showing {counts}. More items available in workspace.")
    } else {
        format!("Found {counts}.")
    }
}

fn push_count(parts: &mut Vec<String>, count: usize, one: &str, many: &str) {
    if count == 0 {
        return;
    }
    let label = if count == 1 { one } else { many };
    parts.push(format!("{count} {label}"));
}

#[cfg(test)]
mod test;
