//! GraphQL output types and Soup item projection.

use std::collections::HashMap;

use async_graphql::{ID, Interface, Json, Object, SimpleObject, Union};
use graphql_properties::{GraphqlPropertyDataType, GraphqlPropertyValue};
use models_properties::service::tag_sets::AppliedTag;
use models_soup::SoupProperty;
use models_soup::document::SoupDocumentSubType;
use models_soup::item::SoupItem;
use soup::domain::agent_listing::{AgentListingPage, tags_of};
use soup::domain::models::SoupPropertiesField;

use crate::schema::input::{SoupKind, SoupTagScope};

/// `type SoupQueryPage`.
#[derive(SimpleObject)]
#[graphql(name = "SoupQueryPage")]
pub(crate) struct SoupQueryPage {
    items: Vec<SoupEntity>,
    /// True when limit cut the list.
    has_more: bool,
    /// One line of counts, and whether results were truncated.
    summary: String,
}

impl SoupQueryPage {
    pub(crate) fn from_listing(page: AgentListingPage) -> Self {
        let summary = build_summary(&page.items, page.has_more);
        let items = page
            .items
            .into_iter()
            .map(|item| SoupEntity::project(item, &page.tag_labels))
            .collect();
        Self {
            items,
            has_more: page.has_more,
            summary,
        }
    }
}

/// `type SoupTag`.
#[derive(SimpleObject, Clone)]
#[graphql(name = "SoupTag")]
pub(crate) struct SoupTag {
    label: String,
    scope: SoupTagScope,
}

/// `type GraphqlProperty` — the four-field subset a listing needs.
pub(crate) struct PropertyObject(SoupProperty);

#[Object(name = "GraphqlProperty")]
impl PropertyObject {
    async fn property_definition_id(&self) -> ID {
        ID(self.0.definition.id.to_string())
    }

    async fn display_name(&self) -> &str {
        &self.0.definition.display_name
    }

    async fn data_type(&self) -> GraphqlPropertyDataType {
        GraphqlPropertyDataType::new(self.0.definition.data_type)
    }

    async fn value(&self) -> Option<GraphqlPropertyValue> {
        self.0.value.as_ref().map(GraphqlPropertyValue::new)
    }
}

/// `interface SoupEntity`.
#[derive(Interface)]
#[graphql(
    name = "SoupEntity",
    field(name = "id", ty = "&ID"),
    field(name = "entity_type", ty = "&SoupKind"),
    field(name = "display_name", ty = "&Option<String>"),
    field(name = "tags", ty = "&Vec<SoupTag>"),
    field(name = "properties", ty = "&Vec<PropertyObject>")
)]
pub(crate) enum SoupEntity {
    Document(DocumentObject),
    Chat(ChatObject),
    Project(ProjectObject),
    EmailThread(EmailThreadObject),
    Channel(ChannelObject),
    ChannelMessage(ChannelMessageObject),
    Call(CallObject),
    CalendarEvent(CalendarEventObject),
    ForeignEntity(ForeignEntityObject),
}

/// `type GraphqlSoupDocument`.
#[derive(SimpleObject)]
#[graphql(name = "GraphqlSoupDocument")]
pub(crate) struct DocumentObject {
    id: ID,
    entity_type: SoupKind,
    display_name: Option<String>,
    tags: Vec<SoupTag>,
    properties: Vec<PropertyObject>,
    name: String,
    owner_id: String,
    file_type: Option<String>,
    project_id: Option<ID>,
    sub_type: Option<DocumentSubType>,
    created_at: String,
    updated_at: String,
    viewed_at: Option<String>,
}

/// `union GraphqlSoupDocumentSubType`.
#[derive(Union)]
#[graphql(name = "GraphqlSoupDocumentSubType")]
pub(crate) enum DocumentSubType {
    Task(TaskSubType),
    Snippet(SnippetSubType),
    Skill(SkillSubType),
}

/// `type GraphqlTaskSubType`.
#[derive(SimpleObject)]
#[graphql(name = "GraphqlTaskSubType")]
pub(crate) struct TaskSubType {
    is_completed: bool,
}

/// `type GraphqlSnippetSubType`.
#[derive(SimpleObject)]
#[graphql(name = "GraphqlSnippetSubType")]
pub(crate) struct SnippetSubType {
    nothing: bool,
}

/// `type GraphqlSkillSubType`.
#[derive(SimpleObject)]
#[graphql(name = "GraphqlSkillSubType")]
pub(crate) struct SkillSubType {
    nothing: bool,
}

/// `type GraphqlSoupChat`.
#[derive(SimpleObject)]
#[graphql(name = "GraphqlSoupChat")]
pub(crate) struct ChatObject {
    id: ID,
    entity_type: SoupKind,
    display_name: Option<String>,
    tags: Vec<SoupTag>,
    properties: Vec<PropertyObject>,
    name: String,
    owner_id: String,
    project_id: Option<ID>,
    created_at: String,
    updated_at: String,
    viewed_at: Option<String>,
}

/// `type GraphqlSoupProject`.
#[derive(SimpleObject)]
#[graphql(name = "GraphqlSoupProject")]
pub(crate) struct ProjectObject {
    id: ID,
    entity_type: SoupKind,
    display_name: Option<String>,
    tags: Vec<SoupTag>,
    properties: Vec<PropertyObject>,
    name: String,
    owner_id: String,
    parent_id: Option<ID>,
    created_at: String,
    updated_at: String,
    viewed_at: Option<String>,
}

/// `type GraphqlSoupEmailThread`.
#[derive(SimpleObject)]
#[graphql(name = "GraphqlSoupEmailThread")]
pub(crate) struct EmailThreadObject {
    id: ID,
    entity_type: SoupKind,
    display_name: Option<String>,
    tags: Vec<SoupTag>,
    properties: Vec<PropertyObject>,
    name: Option<String>,
    snippet: Option<String>,
    sender_name: Option<String>,
    sender_email: Option<String>,
    inbox_visible: bool,
    is_read: bool,
    is_draft: bool,
    is_important: bool,
    owner_id: String,
    project_id: Option<ID>,
    attachment_count: i32,
    participant_count: i32,
    sort_ts: String,
    created_at: String,
    updated_at: String,
    viewed_at: Option<String>,
}

/// `type GraphqlSoupChannelMessagePreview`.
#[derive(SimpleObject)]
#[graphql(name = "GraphqlSoupChannelMessagePreview")]
pub(crate) struct ChannelMessagePreviewObject {
    message_id: ID,
    thread_id: Option<ID>,
    sender_id: String,
    content: String,
    created_at: String,
}

/// `type GraphqlSoupChannel`.
#[derive(SimpleObject)]
#[graphql(name = "GraphqlSoupChannel")]
pub(crate) struct ChannelObject {
    id: ID,
    entity_type: SoupKind,
    display_name: Option<String>,
    tags: Vec<SoupTag>,
    properties: Vec<PropertyObject>,
    name: Option<String>,
    channel_type: String,
    owner_id: String,
    team_id: Option<ID>,
    is_participant: bool,
    participant_count: i32,
    latest_message: Option<ChannelMessagePreviewObject>,
    created_at: String,
    updated_at: String,
    viewed_at: Option<String>,
    interacted_at: Option<String>,
}

/// `type GraphqlSoupChannelMessage`.
#[derive(SimpleObject)]
#[graphql(name = "GraphqlSoupChannelMessage")]
pub(crate) struct ChannelMessageObject {
    id: ID,
    entity_type: SoupKind,
    display_name: Option<String>,
    tags: Vec<SoupTag>,
    properties: Vec<PropertyObject>,
    channel_id: ID,
    sender_id: String,
    content: String,
    reply_count: i32,
    created_at: String,
    updated_at: String,
    effective_updated_at: String,
}

/// `type GraphqlSoupCall`.
#[derive(SimpleObject)]
#[graphql(name = "GraphqlSoupCall")]
pub(crate) struct CallObject {
    id: ID,
    entity_type: SoupKind,
    display_name: Option<String>,
    tags: Vec<SoupTag>,
    properties: Vec<PropertyObject>,
    name: Option<String>,
    summary: Option<String>,
    channel_id: ID,
    channel_name: Option<String>,
    created_by: String,
    status: String,
    attended: bool,
    participant_count: i32,
    started_at: String,
    ended_at: Option<String>,
    duration_ms: Option<i32>,
}

/// `type GraphqlSoupCalendarEvent`.
#[derive(SimpleObject)]
#[graphql(name = "GraphqlSoupCalendarEvent")]
pub(crate) struct CalendarEventObject {
    id: ID,
    entity_type: SoupKind,
    display_name: Option<String>,
    tags: Vec<SoupTag>,
    properties: Vec<PropertyObject>,
    title: String,
    description: Option<String>,
    location: Option<String>,
    status: String,
    owner_id: String,
    time: Json<serde_json::Value>,
    conference_url: Option<String>,
    conference_provider: Option<String>,
    created_at: String,
    updated_at: String,
}

/// `type GraphqlSoupForeignEntity`.
#[derive(SimpleObject)]
#[graphql(name = "GraphqlSoupForeignEntity")]
pub(crate) struct ForeignEntityObject {
    id: ID,
    entity_type: SoupKind,
    display_name: Option<String>,
    tags: Vec<SoupTag>,
    properties: Vec<PropertyObject>,
    foreign_entity_id: String,
    foreign_entity_source: String,
    source_metadata: Json<serde_json::Value>,
    created_at: String,
    updated_at: String,
}

impl SoupEntity {
    fn project(
        item: SoupItem<SoupPropertiesField>,
        tag_labels: &HashMap<uuid::Uuid, AppliedTag>,
    ) -> Self {
        match item {
            SoupItem::Document(doc) => Self::Document(DocumentObject {
                id: ID(doc.id.to_string()),
                entity_type: SoupKind::Document,
                display_name: Some(doc.name.clone()),
                tags: soup_tags(tags_of(&doc.extra.properties, tag_labels)),
                properties: properties_of(&doc.extra.properties),
                name: doc.name,
                owner_id: doc.owner_id.to_string(),
                file_type: doc.file_type,
                project_id: doc.project_id.map(|id| ID(id.to_string())),
                sub_type: doc.sub_type.map(|sub| match sub {
                    SoupDocumentSubType::Task { is_completed } => {
                        DocumentSubType::Task(TaskSubType { is_completed })
                    }
                    SoupDocumentSubType::Snippet {} => {
                        DocumentSubType::Snippet(SnippetSubType { nothing: true })
                    }
                    SoupDocumentSubType::Skill {} => {
                        DocumentSubType::Skill(SkillSubType { nothing: true })
                    }
                }),
                created_at: doc.created_at.to_rfc3339(),
                updated_at: doc.updated_at.to_rfc3339(),
                viewed_at: doc.viewed_at.map(|ts| ts.to_rfc3339()),
            }),
            SoupItem::Chat(chat) => Self::Chat(ChatObject {
                id: ID(chat.id.to_string()),
                entity_type: SoupKind::Chat,
                display_name: Some(chat.name.clone()),
                tags: soup_tags(tags_of(&chat.extra.properties, tag_labels)),
                properties: properties_of(&chat.extra.properties),
                name: chat.name,
                owner_id: chat.owner_id.to_string(),
                project_id: chat.project_id.map(|id| ID(id.to_string())),
                created_at: chat.created_at.to_rfc3339(),
                updated_at: chat.updated_at.to_rfc3339(),
                viewed_at: chat.viewed_at.map(|ts| ts.to_rfc3339()),
            }),
            SoupItem::Project(project) => Self::Project(ProjectObject {
                id: ID(project.id.to_string()),
                entity_type: SoupKind::Project,
                display_name: Some(project.name.clone()),
                tags: soup_tags(tags_of(&project.extra.properties, tag_labels)),
                properties: properties_of(&project.extra.properties),
                name: project.name,
                owner_id: project.owner_id.to_string(),
                parent_id: project.parent_id.map(|id| ID(id.to_string())),
                created_at: project.created_at.to_rfc3339(),
                updated_at: project.updated_at.to_rfc3339(),
                viewed_at: project.viewed_at.map(|ts| ts.to_rfc3339()),
            }),
            SoupItem::EmailThread(thread) => Self::EmailThread(EmailThreadObject {
                id: ID(thread.thread.id.to_string()),
                entity_type: SoupKind::EmailThread,
                display_name: thread.thread.name.clone(),
                tags: soup_tags(tags_of(&thread.extra.properties, tag_labels)),
                properties: properties_of(&thread.extra.properties),
                name: thread.thread.name.clone(),
                snippet: thread.thread.snippet,
                sender_name: thread.thread.sender_name,
                sender_email: thread.thread.sender_email,
                inbox_visible: thread.thread.inbox_visible,
                is_read: thread.thread.is_read,
                is_draft: thread.thread.is_draft,
                is_important: thread.thread.is_important,
                owner_id: thread.thread.owner_id.to_string(),
                project_id: thread.thread.project_id.map(ID),
                attachment_count: i32::try_from(thread.attachments.len()).unwrap_or(i32::MAX),
                participant_count: i32::try_from(thread.participants.len()).unwrap_or(i32::MAX),
                sort_ts: thread.thread.sort_ts.to_rfc3339(),
                created_at: thread.thread.created_at.to_rfc3339(),
                updated_at: thread.thread.updated_at.to_rfc3339(),
                viewed_at: thread.thread.viewed_at.map(|ts| ts.to_rfc3339()),
            }),
            SoupItem::Channel(channel) => {
                let inner = &channel.channel.channel;
                Self::Channel(ChannelObject {
                    id: ID(inner.id.0.to_string()),
                    entity_type: SoupKind::Channel,
                    display_name: inner.name.clone(),
                    tags: Vec::new(),
                    properties: Vec::new(),
                    name: inner.name.clone(),
                    channel_type: format!("{:?}", inner.channel_type).to_ascii_uppercase(),
                    owner_id: inner.owner_id.to_string(),
                    team_id: inner.team_id.map(|id| ID(id.to_string())),
                    is_participant: channel.channel.is_participant,
                    participant_count: i32::try_from(channel.channel.participants.len())
                        .unwrap_or(i32::MAX),
                    latest_message: channel.latest_message.latest_message.map(|message| {
                        ChannelMessagePreviewObject {
                            message_id: ID(message.message_id.to_string()),
                            thread_id: message.thread_id.map(|id| ID(id.to_string())),
                            sender_id: message.sender_id,
                            content: message.content,
                            created_at: message.created_at.to_rfc3339(),
                        }
                    }),
                    created_at: inner.created_at.to_rfc3339(),
                    updated_at: inner.updated_at.to_rfc3339(),
                    viewed_at: channel.viewed_at.map(|ts| ts.to_rfc3339()),
                    interacted_at: channel.interacted_at.map(|ts| ts.to_rfc3339()),
                })
            }
            SoupItem::ChannelThread(thread) => {
                let effective_updated_at = thread.effective_updated_at().to_rfc3339();
                Self::ChannelMessage(ChannelMessageObject {
                    id: ID(thread.id.to_string()),
                    entity_type: SoupKind::ChannelMessage,
                    display_name: None,
                    tags: Vec::new(),
                    properties: Vec::new(),
                    channel_id: ID(thread.channel_id.to_string()),
                    sender_id: thread.sender_id,
                    content: thread.content,
                    reply_count: i32::try_from(thread.thread.reply_count).unwrap_or(i32::MAX),
                    created_at: thread.created_at.to_rfc3339(),
                    updated_at: thread.updated_at.to_rfc3339(),
                    effective_updated_at,
                })
            }
            SoupItem::Call(record) => Self::Call(CallObject {
                id: ID(record.call_id.to_string()),
                entity_type: SoupKind::Call,
                display_name: record.custom_name.clone().or(record.channel_name.clone()),
                tags: soup_tags(tags_of(&record.extra.properties, tag_labels)),
                properties: properties_of(&record.extra.properties),
                name: record.custom_name,
                summary: record.summary,
                channel_id: ID(record.channel_id.to_string()),
                channel_name: record.channel_name,
                created_by: record.created_by,
                status: format!("{:?}", record.status).to_ascii_uppercase(),
                attended: record.attended,
                participant_count: i32::try_from(record.participants.len()).unwrap_or(i32::MAX),
                started_at: record.started_at.to_rfc3339(),
                ended_at: record.ended_at.map(|ts| ts.to_rfc3339()),
                duration_ms: record.duration_ms.and_then(|ms| i32::try_from(ms).ok()),
            }),
            SoupItem::CalendarEvent(event) => Self::CalendarEvent(CalendarEventObject {
                id: ID(event.id.to_string()),
                entity_type: SoupKind::CalendarEvent,
                display_name: Some(event.title.clone()),
                tags: soup_tags(tags_of(&event.extra.properties, tag_labels)),
                properties: properties_of(&event.extra.properties),
                title: event.title,
                description: event.description,
                location: event.location,
                status: event.status,
                owner_id: event.owner_id,
                time: Json(serde_json::to_value(&event.time).unwrap_or(serde_json::Value::Null)),
                conference_url: event.conference_url,
                conference_provider: event.conference_provider,
                created_at: event.created_at.to_rfc3339(),
                updated_at: event.updated_at.to_rfc3339(),
            }),
            SoupItem::ForeignEntity(entity) => Self::ForeignEntity(ForeignEntityObject {
                id: ID(entity.id.to_string()),
                entity_type: SoupKind::ForeignEntity,
                display_name: None,
                tags: Vec::new(),
                properties: Vec::new(),
                foreign_entity_id: entity.foreign_entity_id,
                foreign_entity_source: entity.foreign_entity_source,
                source_metadata: Json(entity.metadata),
                created_at: entity.created_at.to_rfc3339(),
                updated_at: entity.updated_at.to_rfc3339(),
            }),
            SoupItem::CrmCompany(_) => unreachable!("QuerySoup force-filters CRM companies"),
            SoupItem::Reminder(_) => unreachable!("QuerySoup never opts into reminders"),
        }
    }
}

/// One-line count summary for the page.
fn build_summary(items: &[SoupItem<SoupPropertiesField>], has_more: bool) -> String {
    if items.is_empty() {
        return "No items found in workspace.".to_string();
    }
    let mut counts: [usize; 9] = [0; 9];
    for item in items {
        let slot = match item {
            SoupItem::Document(_) => 0,
            SoupItem::Chat(_) => 1,
            SoupItem::Project(_) => 2,
            SoupItem::EmailThread(_) => 3,
            SoupItem::Channel(_) => 4,
            SoupItem::ChannelThread(_) => 5,
            SoupItem::Call(_) => 6,
            SoupItem::CalendarEvent(_) => 7,
            SoupItem::ForeignEntity(_) => 8,
            SoupItem::CrmCompany(_) | SoupItem::Reminder(_) => continue,
        };
        counts[slot] += 1;
    }
    const LABELS: [(&str, &str); 9] = [
        ("document", "documents"),
        ("AI conversation", "AI conversations"),
        ("project", "projects"),
        ("email", "emails"),
        ("channel", "channels"),
        ("channel thread", "channel threads"),
        ("call record", "call records"),
        ("calendar event", "calendar events"),
        ("foreign entity", "foreign entities"),
    ];
    let parts: Vec<String> = counts
        .iter()
        .zip(LABELS)
        .filter(|(count, _)| **count > 0)
        .map(|(count, (one, many))| {
            let label = if *count == 1 { one } else { many };
            format!("{count} {label}")
        })
        .collect();
    let counts = parts.join(", ");
    if has_more {
        format!("Showing {counts}. More items available in workspace.")
    } else {
        format!("Found {counts}.")
    }
}

fn soup_tags(tags: Vec<AppliedTag>) -> Vec<SoupTag> {
    tags.into_iter()
        .map(|tag| SoupTag {
            label: tag.label,
            scope: tag.scope.into(),
        })
        .collect()
}

fn properties_of(properties: &[SoupProperty]) -> Vec<PropertyObject> {
    properties.iter().cloned().map(PropertyObject).collect()
}
