//! Agent-facing listing: the policy that shapes what an AI tool may see.
//!
//! Tools translate their transport (GraphQL, JSON) into an
//! [`AgentListingRequest`] and call [`list_for_agent`]. Everything that decides
//! *which* items an agent gets — kind masking, CRM and reminder exclusion, the
//! signal preset, task sugar over system properties, tag resolution, inbox
//! scoping, and self-chat exclusion — lives here, not in the adapter.

#[cfg(test)]
mod test;

use std::collections::HashMap;

use cowlike::CowLike;
use email::domain::models::{EmailErr, InboxSelectorError, Link, PreviewView};
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
use std::sync::Arc;
use system_properties::{PriorityOption, StatusOption, SystemPropertyKey};
use uuid::Uuid;

use crate::domain::models::{
    EnrichedSoupItem, SoupErr, SoupPropertiesField, SoupQuery, SoupRequest, SoupSortDirection,
    SoupType,
};
use crate::domain::ports::SoupService;

/// The kinds an agent listing can return. CRM companies and reminders are
/// deliberately absent: they have their own tools.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AgentSoupKind {
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
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmailPreset {
    /// Important and not shared.
    Signal,
}

impl EmailPreset {
    /// The email tree this preset stands for.
    pub fn expr(self) -> Expr<EmailLiteral> {
        match self {
            Self::Signal => Expr::and(
                Expr::val(EmailLiteral::Importance(true)),
                Expr::val(EmailLiteral::Shared(SharedEmailFilter::Exclude)),
            ),
        }
    }
}

/// 1..=500. [`Limit::new`] is the only constructor.
#[derive(Debug, Clone, Copy)]
pub struct Limit(u16);

impl Limit {
    /// Smallest accepted limit.
    pub const MIN: u16 = 1;
    /// Largest accepted limit.
    pub const MAX: u16 = 500;
    /// Limit applied when the caller does not give one.
    pub const DEFAULT: u16 = 50;

    /// Accept `value` when it is within `MIN..=MAX`.
    pub fn new(value: u16) -> Result<Self, u16> {
        if (Self::MIN..=Self::MAX).contains(&value) {
            Ok(Self(value))
        } else {
            Err(value)
        }
    }

    /// The validated value.
    pub fn get(self) -> u16 {
        self.0
    }
}

impl Default for Limit {
    fn default() -> Self {
        Self(Self::DEFAULT)
    }
}

/// Address of one connected inbox, trimmed and non-empty.
#[derive(Debug, Clone)]
pub struct InboxSelector(String);

impl InboxSelector {
    /// `None` when `value` is blank.
    pub fn new(value: String) -> Option<Self> {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| Self(trimmed.to_owned()))
    }

    /// The address as given.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Email scoping that is not a filter tree.
#[derive(Debug, Clone, Default)]
pub struct EmailScope {
    /// Mailbox view the previews are hydrated from.
    pub view: PreviewView,
    /// Restrict email results to one connected inbox.
    pub inbox: Option<InboxSelector>,
    /// Preset ANDed with the caller's email tree.
    pub preset: Option<EmailPreset>,
}

/// Tag labels the caller asked for.
#[derive(Debug, Clone)]
pub struct TagSelection {
    /// Labels to resolve against the caller's tag sets.
    pub filters: NonEmpty<Vec<TagFilter>>,
    /// How the resolved tags combine.
    pub mode: TagMatch,
}

/// Task sugar over the well-known Status / Assignees / Priority properties.
#[derive(Debug, Clone, Default)]
pub struct TaskSelection {
    /// Status options to include; empty means any.
    pub status: Vec<StatusOption>,
    /// Priority options to include; empty means any.
    pub priority: Vec<PriorityOption>,
    /// Tasks assigned to the requesting user.
    pub assigned_to_me: bool,
    /// Assignees as entity refs (`macro|<email>`) or bare emails.
    pub assigned_to: Vec<String>,
}

/// A listing the adapter has finished validating.
#[derive(Debug, Clone)]
pub struct AgentListingRequest {
    /// Kinds to return. `None` means every kind this listing serves.
    pub kinds: Option<NonEmpty<Vec<AgentSoupKind>>>,
    /// Per-kind filter trees supplied by the caller.
    pub filters: EntityFilterAst,
    /// Task sugar, when the caller asked for tasks.
    pub task: Option<TaskSelection>,
    /// Sort field.
    pub sort: SimpleSortMethod,
    /// Sort direction.
    pub direction: SoupSortDirection,
    /// Page size.
    pub limit: Limit,
    /// Email view, inbox, and preset.
    pub email: EmailScope,
    /// Tag labels to require.
    pub tags: Option<TagSelection>,
}

impl Default for AgentListingRequest {
    fn default() -> Self {
        Self {
            kinds: None,
            filters: EntityFilterAst::default(),
            task: None,
            sort: SimpleSortMethod::UpdatedAt,
            direction: SoupSortDirection::Desc,
            limit: Limit::default(),
            email: EmailScope::default(),
            tags: None,
        }
    }
}

/// One page of items with everything a projection needs.
#[derive(Debug)]
pub struct AgentListingPage {
    /// Items in sort order.
    pub items: Vec<SoupItem<SoupPropertiesField>>,
    /// True when `limit` cut the list.
    pub has_more: bool,
    /// Tag option id → label, for every tag the items carry.
    pub tag_labels: HashMap<Uuid, AppliedTag>,
}

/// Why a listing could not run.
#[derive(Debug, thiserror::Error)]
pub enum AgentListingError {
    /// Unknown or ambiguous tag label.
    #[error("{0}")]
    Tags(#[from] TagFilterError),
    /// Inbox address is not one the caller can read.
    #[error("{0}")]
    Inbox(#[from] InboxSelectorError),
    /// Connected inboxes could not be loaded.
    #[error("failed to resolve email links: {0}")]
    EmailLinks(#[source] EmailErr),
    /// Soup listing failed.
    #[error("failed to list workspace items: {0}")]
    Soup(#[from] SoupErr),
    /// An assignee could not be turned into an entity reference.
    #[error("invalid assignee `{0}`: use `macro|<email>` or a plain email address")]
    Assignee(String),
    /// `emailPreset` and a task selection were both given without kinds.
    #[error(
        "emailPreset and taskFilter scope different kinds; pass entityTypes \
         (e.g. [DOCUMENT, EMAIL_THREAD]) or drop one of them"
    )]
    ConflictingScopes,
}

/// Run an agent listing against `soup`, scoped to `user`.
///
/// `self_chat_id` is the chat the request came from, when it came from a chat;
/// that chat is excluded so the model does not list the conversation it is in.
pub async fn list_for_agent<S: SoupService, E: EmailService>(
    soup: &S,
    email: &E,
    user: MacroUserIdStr<'static>,
    self_chat_id: Option<Uuid>,
    request: AgentListingRequest,
) -> Result<AgentListingPage, AgentListingError> {
    let (tag_expr, mut tag_sets) = match &request.tags {
        None => (None, None),
        Some(selection) => {
            let sets = CallerTagSets::new(soup.caller_tag_sets(user.copied()).await?);
            let expr = resolve_tags(&sets, selection)?;
            (expr, Some(sets))
        }
    };
    let link_ids = link_ids(email, &user, request.email.inbox.as_ref()).await?;
    let filters = compose_filters(&request, tag_expr, self_chat_id, user.as_ref())?;
    let output = soup
        .get_user_soup_with_properties(
            SoupRequest {
                soup_type: SoupType::Expanded,
                limit: request.limit.get(),
                cursor: SoupQuery::new_sort_simple(request.sort, filters),
                sort_direction: request.direction,
                user: user.clone(),
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
        tag_sets = Some(CallerTagSets::new(
            soup.caller_tag_sets(user.copied()).await?,
        ));
    }
    Ok(AgentListingPage {
        items,
        has_more,
        tag_labels: tag_sets
            .map(|sets| sets.applied_tag_by_option_id())
            .unwrap_or_default(),
    })
}

fn resolve_tags(
    sets: &CallerTagSets,
    selection: &TagSelection,
) -> Result<Option<Expr<PropertiesLiteral>>, AgentListingError> {
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
    Ok(resolved
        .into_iter()
        .map(|option| {
            Expr::val(PropertiesLiteral {
                property_definition_id: option.definition_id,
                entity_type: None,
                value: PropertyMatchValue::SelectOption(option.option_id),
            })
        })
        .reduce(combine))
}

async fn link_ids<E: EmailService>(
    email: &E,
    user: &MacroUserIdStr<'static>,
    inbox: Option<&InboxSelector>,
) -> Result<Vec<Uuid>, AgentListingError> {
    let inboxes = email
        .get_inboxes_for_macro_id(user.copied())
        .await
        .map_err(AgentListingError::EmailLinks)?;
    Ok(match inbox {
        Some(selector) => {
            vec![Link::resolve_selector(&inboxes, user.as_ref(), Some(selector.as_str()))?.id]
        }
        None => inboxes.iter().map(|link| link.id).collect(),
    })
}

/// Fold the agent policy into the caller's filter trees.
pub fn compose_filters(
    request: &AgentListingRequest,
    tags: Option<Expr<PropertiesLiteral>>,
    self_chat_id: Option<Uuid>,
    user: &str,
) -> Result<EntityFilterAst, AgentListingError> {
    let mut ast = request.filters.clone();
    if let Some(kinds) = effective_kinds(request)? {
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
        if let Some(properties) = task.compile(user)? {
            ast.properties_filter =
                Some(Arc::new(and_opt(properties, ast.properties_filter.take())));
        }
        let task_document = Expr::val(DocumentLiteral::SubType(
            document_sub_type::DocumentSubType::Task,
        ));
        ast.document_filter = Some(Arc::new(and_opt(task_document, ast.document_filter.take())));
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

/// The kinds a request lists when it names none: a preset means email, task
/// sugar means documents, both at once is a contradiction.
fn effective_kinds(
    request: &AgentListingRequest,
) -> Result<Option<&[AgentSoupKind]>, AgentListingError> {
    if let Some(kinds) = &request.kinds {
        return Ok(Some(kinds.as_slice()));
    }
    match (request.email.preset.is_some(), request.task.is_some()) {
        (true, true) => Err(AgentListingError::ConflictingScopes),
        (true, false) => Ok(Some(&[AgentSoupKind::EmailThread])),
        (false, true) => Ok(Some(&[AgentSoupKind::Document])),
        (false, false) => Ok(None),
    }
}

impl TaskSelection {
    fn compile(&self, user: &str) -> Result<Option<Expr<PropertiesLiteral>>, AgentListingError> {
        let mut properties = Vec::new();
        if let Some(expr) = or_selects(
            SystemPropertyKey::STATUS_UUID,
            self.status.iter().map(|status| status.uuid()),
        ) {
            properties.push(expr);
        }
        if let Some(expr) = or_selects(
            SystemPropertyKey::PRIORITY_UUID,
            self.priority.iter().map(|priority| priority.uuid()),
        ) {
            properties.push(expr);
        }
        if self.assigned_to_me {
            properties.push(assignee_literal(user)?);
        }
        if let Some(expr) = self
            .assigned_to
            .iter()
            .map(|assignee| assignee_literal(assignee))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .reduce(Expr::or)
        {
            properties.push(expr);
        }
        Ok(properties.into_iter().reduce(Expr::and))
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

/// An assignee as stored on the Assignees property: a Macro user id. Bare
/// emails are promoted to `macro|<email>` so callers need not know the prefix.
fn assignee_literal(value: &str) -> Result<Expr<PropertiesLiteral>, AgentListingError> {
    let trimmed = value.trim();
    let reference = if trimmed.contains('|') {
        trimmed.to_owned()
    } else {
        MacroUserIdStr::try_from_email(trimmed)
            .map_err(|_| AgentListingError::Assignee(value.to_owned()))?
            .to_string()
    };
    let id =
        EntityRefId::new(reference).map_err(|_| AgentListingError::Assignee(value.to_owned()))?;
    Ok(Expr::val(PropertiesLiteral {
        property_definition_id: SystemPropertyKey::ASSIGNEES_UUID,
        entity_type: Some(PropertyEntityType::Task),
        value: PropertyMatchValue::EntityRef(id),
    }))
}

/// `and(a, b)` when `b` is present, else `a`.
fn and_opt<L: Clone>(a: Expr<L>, b: Option<Arc<Expr<L>>>) -> Expr<L> {
    match b {
        Some(existing) => Expr::and(a, (*existing).clone()),
        None => a,
    }
}

fn mask_kinds(ast: EntityFilterAst, kinds: &[AgentSoupKind]) -> EntityFilterAst {
    let keep = |kind| kinds.contains(&kind);
    EntityFilterAst {
        calendar_event_filter: if keep(AgentSoupKind::CalendarEvent) {
            ast.calendar_event_filter
        } else {
            Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil()))))
        },
        document_filter: if keep(AgentSoupKind::Document) {
            ast.document_filter
        } else {
            Some(Arc::new(Expr::val(DocumentLiteral::Id(Uuid::nil()))))
        },
        project_filter: if keep(AgentSoupKind::Project) {
            ast.project_filter
        } else {
            Some(Arc::new(Expr::val(ProjectLiteral::ProjectId(Uuid::nil()))))
        },
        chat_filter: if keep(AgentSoupKind::Chat) {
            ast.chat_filter
        } else {
            Some(Arc::new(Expr::val(ChatLiteral::ChatId(Uuid::nil()))))
        },
        email_filter: if keep(AgentSoupKind::EmailThread) {
            ast.email_filter
        } else {
            item_filters::ast::EmailFilterAst {
                tree: Some(Arc::new(Expr::val(EmailLiteral::ThreadId(Uuid::nil())))),
                crm_scope: None,
            }
        },
        channel_filter: if keep(AgentSoupKind::Channel) {
            ast.channel_filter
        } else {
            Some(Arc::new(Expr::val(ChannelLiteral::ChannelId(Uuid::nil()))))
        },
        channel_thread_filter: if keep(AgentSoupKind::ChannelMessage) {
            ast.channel_thread_filter
        } else {
            Some(Arc::new(Expr::val(ChannelThreadLiteral::ThreadId(
                Uuid::nil(),
            ))))
        },
        call_filter: if keep(AgentSoupKind::Call) {
            ast.call_filter
        } else {
            Some(Arc::new(Expr::val(CallLiteral::CallId(Uuid::nil()))))
        },
        crm_company_filter: ast.crm_company_filter,
        foreign_entity_filter: if keep(AgentSoupKind::ForeignEntity) {
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
        item_properties(item)
            .iter()
            .any(|property| property.definition.data_type == DataType::Tag)
    })
}

/// The properties attached to an item; empty for kinds that carry none.
pub fn item_properties(item: &SoupItem<SoupPropertiesField>) -> &[SoupProperty] {
    match item {
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
        | SoupItem::Reminder(_) => &[],
    }
}

/// Tag-typed properties → labels via the caller's sets; unknown options dropped.
pub fn tags_of(properties: &[SoupProperty], labels: &HashMap<Uuid, AppliedTag>) -> Vec<AppliedTag> {
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
