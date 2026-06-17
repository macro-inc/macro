//! ListEntities tool for browsing workspace items.

use crate::domain::{
    models::{FrecencySoupItem, SoupQuery, SoupRequest, SoupType},
    ports::SoupService,
};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use email::domain::{models::PreviewView, ports::EmailService};
use filter_ast::Expr;
use item_filters::{
    SharedEmailFilter,
    ast::{
        EntityFilterAst, LiteralTree,
        call::CallLiteral,
        channel::{ChannelLiteral, ChannelThreadLiteral},
        chat::ChatLiteral,
        crm_company::CrmCompanyLiteral,
        document::DocumentLiteral,
        email::EmailLiteral,
        foreign_entity::ForeignEntityLiteral,
        project::ProjectLiteral,
        properties::PropertiesLiteral,
    },
};
use models_pagination::{SimpleSortMethod, TypeEraseCursor};
use models_soup::item::SoupItem;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use cowlike::CowLike;
use std::sync::Arc;

use super::SoupToolContext;

/// Internal limit for results - not exposed to agents
const RESULT_LIMIT: u16 = 50;
const MAX_RESULT_LIMIT: u16 = 500;

/// Sort order for the list entities AI tool.
#[derive(Debug, Clone, Copy, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SortBy {
    /// Sort by most recently viewed.
    RecentlyViewed,
    /// Sort by most recently updated.
    #[default]
    RecentlyUpdated,
    /// Sort by most recently created.
    RecentlyCreated,
}

impl From<SortBy> for SimpleSortMethod {
    fn from(sort: SortBy) -> Self {
        match sort {
            SortBy::RecentlyViewed => SimpleSortMethod::ViewedAt,
            SortBy::RecentlyUpdated => SimpleSortMethod::UpdatedAt,
            SortBy::RecentlyCreated => SimpleSortMethod::CreatedAt,
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmailPreset {
    Signal,
}

impl EmailPreset {
    fn filter(self) -> Expr<EmailLiteral> {
        match self {
            EmailPreset::Signal => Expr::and(
                Expr::val(EmailLiteral::Importance(true)),
                Expr::val(EmailLiteral::Shared(SharedEmailFilter::Exclude)),
            ),
        }
    }
}

/// Entity types that can be returned by the list entities AI tool.
#[derive(Debug, Clone, Copy, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ItemType {
    /// Macro document.
    Document,
    /// AI chat conversation.
    AiChat,
    /// Macro project.
    Project,
    /// Email thread.
    Email,
    /// Chat channel.
    Channel,
    /// Chat channel thread.
    ChannelThread,
    /// Call record.
    Call,
    /// Foreign entity record.
    ForeignEntity,
}

/// Item returned by the list entities AI tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum EntityItem {
    /// Macro document item.
    #[serde(rename_all = "camelCase")]
    Document {
        /// Document id.
        id: Uuid,
        /// Document name.
        name: String,
    },
    /// AI chat item.
    #[serde(rename_all = "camelCase")]
    AiChat {
        /// Chat id.
        id: Uuid,
        /// Chat name.
        name: String,
    },
    /// Project item.
    #[serde(rename_all = "camelCase")]
    Project {
        /// Project id.
        id: Uuid,
        /// Project name.
        name: String,
    },
    /// Email thread item.
    #[serde(rename_all = "camelCase")]
    Email {
        /// Email thread id.
        id: Uuid,
        /// Email subject, when present.
        subject: Option<String>,
    },
    /// Channel item.
    #[serde(rename_all = "camelCase")]
    Channel {
        /// Channel id.
        id: Uuid,
        /// Channel name, when present.
        name: Option<String>,
    },
    /// Channel thread item.
    #[serde(rename_all = "camelCase")]
    ChannelThread {
        /// Parent message id for the thread.
        id: Uuid,
        /// Channel id containing the thread.
        channel_id: Uuid,
    },
    /// Call record item.
    #[serde(rename_all = "camelCase")]
    Call {
        /// Call id.
        id: Uuid,
        /// User or actor that created the call.
        created_by: String,
    },
    /// Foreign entity item.
    #[serde(rename_all = "camelCase")]
    ForeignEntity {
        /// Foreign entity row id.
        id: Uuid,
        /// Provider-specific foreign entity id.
        foreign_entity_id: String,
        /// Provider/source name for the foreign entity.
        foreign_entity_source: String,
        /// Foreign entity metadata.
        metadata: serde_json::Value,
    },
}

impl From<SoupItem> for EntityItem {
    fn from(item: SoupItem) -> Self {
        match item {
            SoupItem::Document(doc) => EntityItem::Document {
                id: doc.id,
                name: doc.name,
            },
            SoupItem::Chat(chat) => EntityItem::AiChat {
                id: chat.id,
                name: chat.name,
            },
            SoupItem::Project(project) => EntityItem::Project {
                id: project.id,
                name: project.name,
            },
            SoupItem::EmailThread(thread) => EntityItem::Email {
                id: thread.thread.id,
                subject: thread.thread.name,
            },
            SoupItem::Channel(channel) => EntityItem::Channel {
                id: channel.channel.channel.id.0,
                name: channel.channel.channel.name.clone(),
            },
            SoupItem::ChannelThread(thread) => EntityItem::ChannelThread {
                id: thread.root_message.message_id,
                channel_id: thread.channel_id.0,
            },
            SoupItem::Call(record) => EntityItem::Call {
                id: record.call_id,
                created_by: record.created_by,
            },
            // `entity_filter_ast` force-filters CrmCompany out — kept
            // loud here so a contract break is obvious, not silent.
            SoupItem::CrmCompany(_) => {
                unreachable!("ListEntities tool does not surface CrmCompany rows")
            }
            SoupItem::ForeignEntity(foreign_entity) => EntityItem::ForeignEntity {
                id: foreign_entity.id,
                foreign_entity_id: foreign_entity.foreign_entity_id,
                foreign_entity_source: foreign_entity.foreign_entity_source,
                metadata: foreign_entity.metadata,
            },
        }
    }
}

/// Response returned by the list entities AI tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListEntitiesResponse {
    /// Items returned for the request.
    pub items: Vec<EntityItem>,
    /// Human-readable summary of the returned items.
    pub summary: String,
}

/// AI tool request for browsing workspace entities through soup.
#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ListEntities",
    description = "Browse the user's Macro workspace to see recent items they have access to. Returns Macro documents, AI conversations, projects, emails, chat channels, call records, and foreign entities. Use this to get an overview of what the user has been working on or to find items by type. Start here for activity-summary questions such as \"what happened today\", \"what's going on\", \"catch me up\", or \"what happened in standup today\"; apply precise time, type, channel, or mailbox filters when the user gives that scope. For Macro task requests such as \"list my tasks\", \"tasks assigned to me\", or \"tasks I completed yesterday\", prefer this tool over external task trackers such as Linear unless the user explicitly asks for Linear. Macro tasks are document items with df subtype {\"l\":{\"dst\":\"task\"}} and includeTypes [\"document\"]. Filter task Status and Assignees through propf using entity_type TASK: Status property 00000001-0000-0000-0000-000000000002, Completed option 00000001-0000-0000-0002-000000000004, Assignees property 00000001-0000-0000-0000-000000000001. The current user's assignee entity id is their Macro user id, usually macro|<their email address from context>. For \"completed yesterday\", combine status Completed, assigned-to-me, and a df updatedAt yesterday window with ua gte/lt ISO timestamps. For finding specific items by name or content, use the search tool instead."
)]
pub struct ListEntities {
    /// Filter returned items to specific item types.
    #[schemars(
        description = "Filter returned items to specific item types. If not provided, returns all types. Example: [\"document\", \"email\"] returns only documents and emails. Macro tasks are returned as document items, so use includeTypes=[\"document\"] with df subtype task for task requests. This is folded into the AST and applied as part of cursor-level filtering."
    )]
    #[serde(default)]
    pub include_types: Option<Vec<ItemType>>,

    /// Sort order for returned items.
    #[schemars(
        description = "How to sort results: recently_viewed, recently_updated (default to this), or recently_created. Use recently_updated for updated_at-style soup results."
    )]
    #[serde(default)]
    pub sort_by: SortBy,

    /// Document entity AST filter.
    #[schemars(
        description = "Full soup AST document filter (df). Use the same shape as /items/soup/ast, e.g. {\"l\":{\"id\":\"...\"}}. For Macro tasks, use {\"l\":{\"dst\":\"task\"}}. For \"completed yesterday\", AND the task subtype with updatedAt bounds, e.g. {\"&\":[{\"l\":{\"dst\":\"task\"}},{\"&\":[{\"l\":{\"ua\":{\"gte\":\"<start>\"}}},{\"l\":{\"ua\":{\"lt\":\"<end>\"}}}]}]} using ISO timestamps.",
        with = "Option<serde_json::Value>"
    )]
    #[serde(default, rename = "df")]
    pub document_filter: LiteralTree<DocumentLiteral>,

    /// Project entity AST filter.
    #[schemars(
        description = "Full soup AST project filter (pf).",
        with = "Option<serde_json::Value>"
    )]
    #[serde(default, rename = "pf")]
    pub project_filter: LiteralTree<ProjectLiteral>,

    /// AI chat entity AST filter.
    #[schemars(
        description = "Full soup AST AI chat filter (cf).",
        with = "Option<serde_json::Value>"
    )]
    #[serde(default, rename = "cf")]
    pub chat_filter: LiteralTree<ChatLiteral>,

    /// High-level email filter preset.
    #[schemars(
        description = "High-level email filter preset. Use \"signal\" for signal emails. Signal emails and important emails are synonymous: if the user asks for important emails, use emailPreset=\"signal\". This expands to the email AST {\"&\":[{\"l\":{\"Importance\":true}},{\"l\":{\"Shared\":\"exclude\"}}]} and defaults results to emails if includeTypes is omitted."
    )]
    #[serde(default)]
    pub email_preset: Option<EmailPreset>,

    /// Email entity AST filter.
    #[schemars(
        description = "Advanced full soup AST email filter (ef). Prefer emailPreset=\"signal\" for common requests. Signal emails and important emails are synonymous; they use {\"&\":[{\"l\":{\"Importance\":true}},{\"l\":{\"Shared\":\"exclude\"}}]}.",
        with = "Option<serde_json::Value>"
    )]
    #[serde(default, rename = "ef")]
    pub email_filter: LiteralTree<EmailLiteral>,

    /// Channel entity AST filter.
    #[schemars(
        description = "Full soup AST channel filter (chanf).",
        with = "Option<serde_json::Value>"
    )]
    #[serde(default, rename = "chanf")]
    pub channel_filter: LiteralTree<ChannelLiteral>,

    /// Channel thread entity AST filter.
    #[schemars(
        description = "Full soup AST channel thread filter (cthf).",
        with = "Option<serde_json::Value>"
    )]
    #[serde(default, rename = "cthf")]
    pub channel_thread_filter: LiteralTree<ChannelThreadLiteral>,

    /// Call entity AST filter.
    #[schemars(
        description = "Full soup AST call filter (callf).",
        with = "Option<serde_json::Value>"
    )]
    #[serde(default, rename = "callf")]
    pub call_filter: LiteralTree<CallLiteral>,

    /// Foreign entity AST filter.
    #[schemars(
        description = "Full soup AST foreign entity filter (fef).",
        with = "Option<serde_json::Value>"
    )]
    #[serde(default, rename = "fef")]
    pub foreign_entity_filter: LiteralTree<ForeignEntityLiteral>,

    /// Entity property AST filter.
    #[schemars(
        description = "Full soup AST property filter (propf). Use this for Macro task Status, Assignees, Priority, and other entity properties. For task Status Completed: {\"l\":{\"pd\":\"00000001-0000-0000-0000-000000000002\",\"et\":\"TASK\",\"v\":{\"so\":\"00000001-0000-0000-0002-000000000004\"}}}. For tasks assigned to the current user: {\"l\":{\"pd\":\"00000001-0000-0000-0000-000000000001\",\"et\":\"TASK\",\"v\":{\"er\":\"macro|user@example.com\"}}}. Combine both with &: {\"&\":[statusCompleted, assignedToMe]}. Prefer this over Linear tools for unqualified task requests.",
        with = "Option<serde_json::Value>"
    )]
    #[serde(default, rename = "propf")]
    pub properties_filter: LiteralTree<PropertiesLiteral>,

    /// Mailbox view used to hydrate email previews.
    #[schemars(description = "\
Which mailbox view to hydrate previews from for email results. Valid values: inbox \
(default), sent, drafts, starred, all, important, other, or user:<label>.\n\
\n\
When the user asks about signal or important emails, use emailView=\"inbox\" together \
with emailPreset=\"signal\" — do not set emailView=\"important\" in that case. Only \
override the default when the user explicitly asks for a specific mailbox or label view \
(e.g. \"sent\", \"drafts\", \"my Foo label\").")]
    #[serde(default, rename = "emailView")]
    pub email_view: Option<String>,

    /// Maximum number of items to return.
    #[schemars(description = "Maximum number of items to return. Defaults to 50; max 500.")]
    #[serde(default)]
    pub limit: Option<u16>,
}

impl ListEntities {
    pub(super) fn entity_filter_ast(&self) -> EntityFilterAst {
        let ast = EntityFilterAst {
            document_filter: self.document_filter.clone(),
            project_filter: self.project_filter.clone(),
            chat_filter: self.chat_filter.clone(),
            // Toolset doesn't (yet) expose CRM scope; the tool surface stays
            // per-link unless we add explicit fields for it.
            email_filter: item_filters::ast::EmailFilterAst {
                tree: match self.email_preset {
                    Some(preset) => Some(Arc::new(preset.filter())),
                    None => self.email_filter.clone(),
                },
                crm_scope: None,
            },
            channel_filter: self.channel_filter.clone(),
            channel_thread_filter: self.channel_thread_filter.clone(),
            call_filter: self.call_filter.clone(),
            // CrmCompany not in the tool surface — force-filter so the
            // AI never sees one.
            crm_company_filter: Some(Arc::new(Expr::val(CrmCompanyLiteral::Id(Uuid::nil())))),
            foreign_entity_filter: self.foreign_entity_filter.clone(),
            properties_filter: self.properties_filter.clone(),
        };

        self.apply_include_types_to_ast(ast)
    }

    fn apply_include_types_to_ast(&self, ast: EntityFilterAst) -> EntityFilterAst {
        let Some(include_types) = self
            .effective_include_types()
            .filter(|types| !types.is_empty())
        else {
            return ast;
        };

        EntityFilterAst {
            document_filter: if include_types.contains(&ItemType::Document) {
                ast.document_filter
            } else {
                Some(Arc::new(Expr::val(DocumentLiteral::Id(Uuid::nil()))))
            },
            project_filter: if include_types.contains(&ItemType::Project) {
                ast.project_filter
            } else {
                Some(Arc::new(Expr::val(ProjectLiteral::ProjectId(Uuid::nil()))))
            },
            chat_filter: if include_types.contains(&ItemType::AiChat) {
                ast.chat_filter
            } else {
                Some(Arc::new(Expr::val(ChatLiteral::ChatId(Uuid::nil()))))
            },
            email_filter: if include_types.contains(&ItemType::Email) {
                ast.email_filter
            } else {
                item_filters::ast::EmailFilterAst {
                    tree: Some(Arc::new(Expr::val(EmailLiteral::ThreadId(Uuid::nil())))),
                    crm_scope: None,
                }
            },
            channel_filter: if include_types.contains(&ItemType::Channel) {
                ast.channel_filter
            } else {
                Some(Arc::new(Expr::val(ChannelLiteral::ChannelId(Uuid::nil()))))
            },
            channel_thread_filter: if include_types.contains(&ItemType::ChannelThread) {
                ast.channel_thread_filter
            } else {
                Some(Arc::new(Expr::val(ChannelThreadLiteral::ThreadId(
                    Uuid::nil(),
                ))))
            },
            call_filter: if include_types.contains(&ItemType::Call) {
                ast.call_filter
            } else {
                Some(Arc::new(Expr::val(CallLiteral::CallId(Uuid::nil()))))
            },
            // Preserve the upstream nil filter — no ItemType::CrmCompany
            // to toggle against.
            crm_company_filter: ast.crm_company_filter,
            foreign_entity_filter: if include_types.contains(&ItemType::ForeignEntity) {
                ast.foreign_entity_filter
            } else {
                Some(Arc::new(Expr::val(ForeignEntityLiteral::Id(Uuid::nil()))))
            },
            properties_filter: ast.properties_filter,
        }
    }

    pub(super) fn email_view(&self) -> ToolResult<PreviewView> {
        self.email_view
            .as_deref()
            .map(|view| view.parse::<PreviewView>())
            .transpose()
            .map(|view| view.unwrap_or_default())
            .map_err(|e| ToolCallError {
                description: format!("Invalid emailView: {e}"),
                internal_error: anyhow::anyhow!(e),
            })
    }

    pub(super) fn effective_include_types(&self) -> Option<Vec<ItemType>> {
        self.include_types
            .clone()
            .or_else(|| self.email_preset.is_some().then_some(vec![ItemType::Email]))
    }
}

#[async_trait]
impl<T, E> AsyncTool<SoupToolContext<T, E>> for ListEntities
where
    T: SoupService,
    E: EmailService,
{
    type Output = ListEntitiesResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<SoupToolContext<T, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "List entities");

        let sort_method = SimpleSortMethod::from(self.sort_by);
        let filters = self.entity_filter_ast();
        let email_preview_view = self.email_view()?;
        let limit = self
            .limit
            .unwrap_or(RESULT_LIMIT)
            .clamp(1, MAX_RESULT_LIMIT);

        let link_ids: Vec<uuid::Uuid> = service_context
            .email_service
            .get_inboxes_for_macro_id(request_context.user_id.copied())
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to resolve email links: {e}"),
                internal_error: e.into(),
            })?
            .into_iter()
            .map(|link| link.id)
            .collect();

        let result = service_context
            .service
            .get_user_soup(
                SoupRequest {
                    soup_type: SoupType::Expanded,
                    limit,
                    cursor: SoupQuery::new_sort_simple(sort_method, filters),
                    user: request_context.user_id,
                    email_preview_view,
                    link_ids,
                },
                None,
            )
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to list entities: {e}"),
                internal_error: e.into(),
            })?;

        let paginated = result.type_erase();
        let has_more = paginated.next_cursor.is_some();

        let items: Vec<EntityItem> = paginated
            .items
            .into_iter()
            .map(|FrecencySoupItem { item, .. }| EntityItem::from(item))
            .collect();

        // Build summary
        let summary = build_summary(&items, has_more, &self.effective_include_types());

        Ok(ListEntitiesResponse { items, summary })
    }
}

pub(super) fn build_summary(
    items: &[EntityItem],
    has_more: bool,
    filter: &Option<Vec<ItemType>>,
) -> String {
    if items.is_empty() {
        return match filter {
            Some(types) if !types.is_empty() => {
                "No items found matching the specified types.".to_string()
            }
            _ => "No items found in workspace.".to_string(),
        };
    }

    // Count by type
    let mut docs = 0;
    let mut chats = 0;
    let mut projects = 0;
    let mut emails = 0;
    let mut channels = 0;
    let mut channel_threads = 0;
    let mut call_records = 0;
    let mut foreign_entities = 0;

    for item in items {
        match item {
            EntityItem::Document { .. } => docs += 1,
            EntityItem::AiChat { .. } => chats += 1,
            EntityItem::Project { .. } => projects += 1,
            EntityItem::Email { .. } => emails += 1,
            EntityItem::Channel { .. } => channels += 1,
            EntityItem::ChannelThread { .. } => channel_threads += 1,
            EntityItem::Call { .. } => call_records += 1,
            EntityItem::ForeignEntity { .. } => foreign_entities += 1,
        }
    }

    let mut parts = Vec::new();
    if docs > 0 {
        parts.push(format!(
            "{docs} document{}",
            if docs == 1 { "" } else { "s" }
        ));
    }
    if chats > 0 {
        parts.push(format!(
            "{chats} AI conversation{}",
            if chats == 1 { "" } else { "s" }
        ));
    }
    if projects > 0 {
        parts.push(format!(
            "{projects} project{}",
            if projects == 1 { "" } else { "s" }
        ));
    }
    if emails > 0 {
        parts.push(format!(
            "{emails} email{}",
            if emails == 1 { "" } else { "s" }
        ));
    }
    if channels > 0 {
        parts.push(format!(
            "{channels} channel{}",
            if channels == 1 { "" } else { "s" }
        ));
    }
    if channel_threads > 0 {
        parts.push(format!(
            "{channel_threads} channel thread{}",
            if channel_threads == 1 { "" } else { "s" }
        ));
    }
    if call_records > 0 {
        parts.push(format!(
            "{call_records} call record{}",
            if call_records == 1 { "" } else { "s" }
        ));
    }
    if foreign_entities > 0 {
        let label = if foreign_entities == 1 {
            "foreign entity"
        } else {
            "foreign entities"
        };
        parts.push(format!("{foreign_entities} {label}"));
    }

    let counts = parts.join(", ");
    if has_more {
        format!("Showing {counts}. More items available in workspace.")
    } else {
        format!("Found {counts}.")
    }
}
