//! AI tools inbound adapter for the Soup service.

use crate::domain::{
    models::{FrecencySoupItem, SoupQuery, SoupRequest, SoupType},
    ports::SoupService,
};
use ai::tool::{AsyncTool, AsyncToolSet, ToolCallError, ToolResult};
use async_trait::async_trait;
use email::domain::models::PreviewView;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{Query, SimpleSortMethod, TypeEraseCursor};
use models_soup::item::SoupItem;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

/// Internal limit for results - not exposed to agents
const RESULT_LIMIT: u16 = 50;

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

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ItemType {
    Document,
    AiChat,
    Project,
    Email,
    Channel,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum WorkspaceItem {
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
}

impl WorkspaceItem {
    fn item_type(&self) -> ItemType {
        match self {
            WorkspaceItem::Document { .. } => ItemType::Document,
            WorkspaceItem::AiChat { .. } => ItemType::AiChat,
            WorkspaceItem::Project { .. } => ItemType::Project,
            WorkspaceItem::Email { .. } => ItemType::Email,
            WorkspaceItem::Channel { .. } => ItemType::Channel,
        }
    }
}

impl From<SoupItem> for WorkspaceItem {
    fn from(item: SoupItem) -> Self {
        match item {
            SoupItem::Document(doc) => WorkspaceItem::Document {
                id: doc.id,
                name: doc.name,
            },
            SoupItem::Chat(chat) => WorkspaceItem::AiChat {
                id: chat.id,
                name: chat.name,
            },
            SoupItem::Project(project) => WorkspaceItem::Project {
                id: project.id,
                name: project.name,
            },
            SoupItem::EmailThread(thread) => WorkspaceItem::Email {
                id: thread.thread.id,
                subject: thread.thread.name,
            },
            SoupItem::Channel(channel) => WorkspaceItem::Channel {
                id: channel.channel.channel.id.0,
                name: channel.channel.channel.name.clone(),
            },
        }
    }
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BrowseWorkspaceResponse {
    pub items: Vec<WorkspaceItem>,
    pub summary: String,
}

#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "BrowseWorkspace",
    description = "Browse the user's workspace to see recent items they have access to. Returns documents, AI conversations, projects, emails, and chat channels. Use this to get an overview of what the user has been working on or to find items by type. For finding specific items by name or content, use the search tool instead."
)]
pub struct BrowseWorkspace {
    #[schemars(
        description = "Filter to specific item types. If not provided, returns all types. Example: [\"document\", \"email\"] returns only documents and emails."
    )]
    #[serde(default)]
    pub include_types: Option<Vec<ItemType>>,

    #[schemars(
        description = "How to sort results: recently_viewed (default), recently_updated, or recently_created."
    )]
    #[serde(default)]
    pub sort_by: SortBy,
}

/// Service context for soup AI tools
#[derive(Clone)]
pub struct SoupToolContext<T> {
    pub service: Arc<T>,
}

impl<T> SoupToolContext<T> {
    /// Create a new soup tool context
    pub fn new(service: T) -> Self {
        Self {
            service: Arc::new(service),
        }
    }
}

/// Request context for soup AI tools
#[derive(Debug, Clone)]
pub struct SoupRequestContext {
    pub user_id: MacroUserIdStr<'static>,
}

#[async_trait]
impl<T> AsyncTool<SoupToolContext<T>, SoupRequestContext> for BrowseWorkspace
where
    T: SoupService,
{
    type Output = BrowseWorkspaceResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        context: SoupToolContext<T>,
        request_context: SoupRequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "Browse workspace");

        let sort_method = SimpleSortMethod::from(self.sort_by);

        let result = context
            .service
            .get_user_soup(SoupRequest {
                soup_type: SoupType::Expanded,
                limit: RESULT_LIMIT,
                cursor: SoupQuery::Simple(Query::Sort(sort_method, None)),
                user: request_context.user_id,
                email_preview_view: PreviewView::default(),
                link_id: None,
            })
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to browse workspace: {e}"),
                internal_error: e.into(),
            })?;

        let paginated = result.type_erase();
        let has_more = paginated.next_cursor.is_some();

        // Convert and filter items
        let all_items: Vec<WorkspaceItem> = paginated
            .items
            .into_iter()
            .map(|FrecencySoupItem { item, .. }| WorkspaceItem::from(item))
            .collect();

        let items: Vec<WorkspaceItem> = match &self.include_types {
            Some(types) if !types.is_empty() => all_items
                .into_iter()
                .filter(|item| types.contains(&item.item_type()))
                .collect(),
            _ => all_items,
        };

        // Build summary
        let summary = build_summary(&items, has_more, &self.include_types);

        Ok(BrowseWorkspaceResponse { items, summary })
    }
}

fn build_summary(
    items: &[WorkspaceItem],
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

    for item in items {
        match item {
            WorkspaceItem::Document { .. } => docs += 1,
            WorkspaceItem::AiChat { .. } => chats += 1,
            WorkspaceItem::Project { .. } => projects += 1,
            WorkspaceItem::Email { .. } => emails += 1,
            WorkspaceItem::Channel { .. } => channels += 1,
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

    let counts = parts.join(", ");
    if has_more {
        format!("Showing {counts}. More items available in workspace.")
    } else {
        format!("Found {counts}.")
    }
}

/// Create a soup toolset
pub fn soup_toolset<T>() -> AsyncToolSet<SoupToolContext<T>, SoupRequestContext>
where
    T: SoupService,
{
    AsyncToolSet::new()
        .add_tool::<BrowseWorkspace>()
        .expect("failed to add BrowseWorkspace tool")
}

#[cfg(test)]
mod test;
