//! ListEntities tool for browsing workspace items.

use crate::domain::{
    models::{FrecencySoupItem, SoupQuery, SoupRequest, SoupType},
    ports::SoupService,
};
use ai::tool::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use email::domain::{models::PreviewView, ports::EmailService};
use filter_ast::Expr;
use item_filters::{
    SharedEmailFilter,
    ast::{EntityFilterAst, email::EmailLiteral},
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

#[derive(Debug, Clone, Copy, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SortBy {
    #[default]
    RecentlyViewed,
    RecentlyUpdated,
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

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolSoupSort {
    ViewedAt,
    UpdatedAt,
    CreatedAt,
    ViewedUpdated,
}

impl From<ToolSoupSort> for SimpleSortMethod {
    fn from(sort: ToolSoupSort) -> Self {
        match sort {
            ToolSoupSort::ViewedAt => SimpleSortMethod::ViewedAt,
            ToolSoupSort::UpdatedAt => SimpleSortMethod::UpdatedAt,
            ToolSoupSort::CreatedAt => SimpleSortMethod::CreatedAt,
            ToolSoupSort::ViewedUpdated => SimpleSortMethod::ViewedUpdated,
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmailPreset {
    Important,
    Signal,
}

impl EmailPreset {
    fn filter(self) -> Expr<EmailLiteral> {
        match self {
            EmailPreset::Important | EmailPreset::Signal => Expr::and(
                Expr::val(EmailLiteral::Importance(true)),
                Expr::val(EmailLiteral::Shared(SharedEmailFilter::Exclude)),
            ),
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ItemType {
    Document,
    AiChat,
    Project,
    Email,
    Channel,
    Call,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum EntityItem {
    #[serde(rename_all = "camelCase")]
    Document { id: Uuid, name: String },
    #[serde(rename_all = "camelCase")]
    AiChat { id: Uuid, name: String },
    #[serde(rename_all = "camelCase")]
    Project { id: Uuid, name: String },
    #[serde(rename_all = "camelCase")]
    Email { id: Uuid, subject: Option<String> },
    #[serde(rename_all = "camelCase")]
    Channel { id: Uuid, name: Option<String> },
    #[serde(rename_all = "camelCase")]
    Call { id: Uuid, created_by: String },
}

impl EntityItem {
    fn item_type(&self) -> ItemType {
        match self {
            EntityItem::Document { .. } => ItemType::Document,
            EntityItem::AiChat { .. } => ItemType::AiChat,
            EntityItem::Project { .. } => ItemType::Project,
            EntityItem::Email { .. } => ItemType::Email,
            EntityItem::Channel { .. } => ItemType::Channel,
            EntityItem::Call { .. } => ItemType::Call,
        }
    }
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
            SoupItem::Call(record) => EntityItem::Call {
                id: record.call_id,
                created_by: record.created_by,
            },
        }
    }
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListEntitiesResponse {
    pub items: Vec<EntityItem>,
    pub summary: String,
}

#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ListEntities",
    description = "Browse the user's workspace to see recent items they have access to. Returns documents, AI conversations, projects, emails, and chat channels. Use this to get an overview of what the user has been working on or to find items by type. For finding specific items by name or content, use the search tool instead."
)]
pub struct ListEntities {
    #[schemars(
        description = "Filter returned items to specific item types. If not provided, returns all types. Example: [\"document\", \"email\"] returns only documents and emails. This is applied after the soup query."
    )]
    #[serde(default)]
    pub include_types: Option<Vec<ItemType>>,

    #[schemars(
        description = "Legacy sort selector: recently_viewed (default), recently_updated, or recently_created. Prefer sort_method when using AST filters."
    )]
    #[serde(default)]
    pub sort_by: SortBy,

    #[schemars(
        description = "Full soup AST document filter (df). Use the same shape as /items/soup/ast, e.g. {\"l\":{\"id\":\"...\"}}."
    )]
    #[serde(default, rename = "df")]
    pub document_filter: Option<serde_json::Value>,

    #[schemars(description = "Full soup AST project filter (pf).")]
    #[serde(default, rename = "pf")]
    pub project_filter: Option<serde_json::Value>,

    #[schemars(description = "Full soup AST AI chat filter (cf).")]
    #[serde(default, rename = "cf")]
    pub chat_filter: Option<serde_json::Value>,

    #[schemars(
        description = "High-level email filter preset. Use \"important\" or \"signal\" for important/signaled inbox emails; this expands to the email AST {\"&\":[{\"l\":{\"Importance\":true}},{\"l\":{\"Shared\":\"exclude\"}}]} and defaults results to emails if includeTypes is omitted."
    )]
    #[serde(default)]
    pub email_preset: Option<EmailPreset>,

    #[schemars(
        description = "Advanced full soup AST email filter (ef). Prefer emailPreset for common requests. Signal/important emails use {\"&\":[{\"l\":{\"Importance\":true}},{\"l\":{\"Shared\":\"exclude\"}}]}."
    )]
    #[serde(default, rename = "ef")]
    pub email_filter: Option<serde_json::Value>,

    #[schemars(description = "Full soup AST channel filter (chanf).")]
    #[serde(default, rename = "chanf")]
    pub channel_filter: Option<serde_json::Value>,

    #[schemars(description = "Full soup AST call filter (callf).")]
    #[serde(default, rename = "callf")]
    pub call_filter: Option<serde_json::Value>,

    #[schemars(description = "Full soup AST property filter (propf).")]
    #[serde(default, rename = "propf")]
    pub properties_filter: Option<serde_json::Value>,

    #[schemars(
        description = "Email view to use for email results: inbox (default), sent, drafts, starred, all, important, other, or user:<label>."
    )]
    #[serde(default, rename = "emailView")]
    pub email_view: Option<String>,

    #[schemars(
        description = "Maximum number of soup items to fetch before includeTypes post-filtering. Defaults to 50; max 500."
    )]
    #[serde(default)]
    pub limit: Option<u16>,

    #[schemars(
        description = "Soup sort method for AST queries: viewed_at, updated_at, created_at, or viewed_updated."
    )]
    #[serde(default, rename = "sort_method")]
    pub sort_method: Option<ToolSoupSort>,
}

impl ListEntities {
    pub(super) fn entity_filter_ast(&self) -> ToolResult<EntityFilterAst> {
        let mut map = serde_json::Map::new();
        if let Some(value) = &self.document_filter {
            map.insert("df".to_string(), value.clone());
        }
        if let Some(value) = &self.project_filter {
            map.insert("pf".to_string(), value.clone());
        }
        if let Some(value) = &self.chat_filter {
            map.insert("cf".to_string(), value.clone());
        }
        if let Some(value) = &self.email_filter {
            map.insert("ef".to_string(), value.clone());
        }
        if let Some(value) = &self.channel_filter {
            map.insert("chanf".to_string(), value.clone());
        }
        if let Some(value) = &self.call_filter {
            map.insert("callf".to_string(), value.clone());
        }
        if let Some(value) = &self.properties_filter {
            map.insert("propf".to_string(), value.clone());
        }

        let mut ast: EntityFilterAst = serde_json::from_value(serde_json::Value::Object(map))
            .map_err(|e| ToolCallError {
                description: format!("Invalid soup AST filter: {e}"),
                internal_error: e.into(),
            })?;

        if let Some(email_preset) = self.email_preset {
            let preset_filter = email_preset.filter();
            ast.email_filter = Some(Arc::new(match ast.email_filter.take() {
                Some(existing) => {
                    let existing = match Arc::try_unwrap(existing) {
                        Ok(existing) => existing,
                        Err(existing) => serde_json::from_value(
                            serde_json::to_value(&*existing).map_err(|e| ToolCallError {
                                description: format!("Failed to clone existing email AST: {e}"),
                                internal_error: e.into(),
                            })?,
                        )
                        .map_err(|e| ToolCallError {
                            description: format!("Failed to clone existing email AST: {e}"),
                            internal_error: e.into(),
                        })?,
                    };
                    Expr::and(existing, preset_filter)
                }
                None => preset_filter,
            }));
        }

        Ok(ast)
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

        let sort_method = self
            .sort_method
            .map(SimpleSortMethod::from)
            .unwrap_or_else(|| SimpleSortMethod::from(self.sort_by));
        let filters = self.entity_filter_ast()?;
        let email_preview_view = self.email_view()?;
        let limit = self
            .limit
            .unwrap_or(RESULT_LIMIT)
            .clamp(1, MAX_RESULT_LIMIT);

        let link_id = service_context
            .email_service
            .get_link_by_macro_id(request_context.user_id.copied())
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to resolve email link: {e}"),
                internal_error: e.into(),
            })?
            .map(|link| link.id);

        let result = service_context
            .service
            .get_user_soup(
                SoupRequest {
                    soup_type: SoupType::Expanded,
                    limit,
                    cursor: SoupQuery::new_sort_simple(sort_method, filters),
                    user: request_context.user_id,
                    email_preview_view,
                    link_id,
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

        // Convert and filter items
        let all_items: Vec<EntityItem> = paginated
            .items
            .into_iter()
            .map(|FrecencySoupItem { item, .. }| EntityItem::from(item))
            .collect();

        let effective_include_types = self.effective_include_types();
        let items: Vec<EntityItem> = match &effective_include_types {
            Some(types) if !types.is_empty() => all_items
                .into_iter()
                .filter(|item| types.contains(&item.item_type()))
                .collect(),
            _ => all_items,
        };

        // Build summary
        let summary = build_summary(&items, has_more, &effective_include_types);

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
    let mut call_records = 0;

    for item in items {
        match item {
            EntityItem::Document { .. } => docs += 1,
            EntityItem::AiChat { .. } => chats += 1,
            EntityItem::Project { .. } => projects += 1,
            EntityItem::Email { .. } => emails += 1,
            EntityItem::Channel { .. } => channels += 1,
            EntityItem::Call { .. } => call_records += 1,
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
    if call_records > 0 {
        parts.push(format!(
            "{call_records} call record{}",
            if call_records == 1 { "" } else { "s" }
        ));
    }

    let counts = parts.join(", ");
    if has_more {
        format!("Showing {counts}. More items available in workspace.")
    } else {
        format!("Found {counts}.")
    }
}
