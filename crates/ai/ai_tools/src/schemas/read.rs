#![allow(dead_code)]
use crate::serde_utils::deserialize_permissive_datetime_opt;
use ai_toolset::schema::PhantomTool;
use chrono::{DateTime, Utc};
use model::chat::ChatHistory;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, JsonSchema, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReadResponse {
    pub content: ReadContent,
}

#[derive(Debug, JsonSchema, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "type")]
pub enum ReadContent {
    Channel {
        channel_id: String,
        channel_name: Option<String>,
        transcript: String,
    },
    Chat {
        #[serde(flatten)]
        history: ChatHistory,
    },
    ItemPreviews {
        formatted_preview: String,
    },
}

#[derive(Debug, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMetadata {
    pub document_name: String,
    pub owner: String,
    pub file_type: Option<String>,
    pub project_id: Option<String>,
    pub deleted: bool,
}

#[derive(Debug, JsonSchema, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    description = "Read threaded content by ID(s). Supports reading channels, chats, and projects by their respective IDs. Use this tool when you need to retrieve the full content of a specific item(s). For documents, use ReadContent or ReadMetadata instead.
    Channel transcripts only include the latest 150 messages. Use 'messages_since' to see messages in a different time window.",
    title = "ReadThread"
)]
pub struct ReadThread {
    #[schemars(
        description = "The type of content to read. Choose based on the type of content you want to retrieve."
    )]
    pub content_type: ContentType,
    #[schemars(
        description = "ID(s) of the content to read. IMPORTANT: channel-message, chat-message, and content types support MULTIPLE ids! For all other content types (channel, chat-thread) provide a single id."
    )]
    pub ids: Vec<String>,
    #[schemars(
        description = "A local datetime of the earliest message to include in a channel transcript following ISO 8601 format, only applicable to channels"
    )]
    #[serde(default, deserialize_with = "deserialize_permissive_datetime_opt")]
    pub messages_since: Option<DateTime<Utc>>,
}

#[derive(Debug, JsonSchema, Deserialize, Clone, strum::EnumString, strum::Display)]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum ContentType {
    Channel,
    ChannelMessage,
    ChatThread,
    ChatMessage,
    Project,
}

pub fn read_thread() -> PhantomTool<ReadThread, ReadResponse> {
    PhantomTool::new("ReadThread")
}
