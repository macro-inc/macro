use crate::serde_utils::deserialize_permissive_datetime_opt;
use crate::tool_context::ToolScribe;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use anyhow::anyhow;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use model::chat::ChatHistory;
use models_email::email::service::message::ParsedMessage;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub const MAX_MESSAGES: i64 = 150;

#[derive(Debug, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResponse {
    pub content: ReadContent,
}

// TODO: this should be hoisted to "ai_format" so that consistent formats can be used everywhere
// TODO: tool calls should be formatted with xml tags not json
// TODO: We should minimize nested context
#[derive(Debug, JsonSchema, Serialize)]
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
    Email {
        thread_id: String,
        subject: Option<String>,
        messages: Vec<EmailMessage>,
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

#[derive(Debug, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailMessage {
    pub message_id: String,
    pub sender: String,
    pub recipients: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub content: String,
    pub sent_at: Option<DateTime<Utc>>,
}

impl From<ParsedMessage> for EmailMessage {
    fn from(msg: ParsedMessage) -> Self {
        Self {
            message_id: msg.db_id.to_string(),
            sender: msg
                .from
                .as_ref()
                .map(|f| f.email.clone())
                .unwrap_or_default(),
            recipients: msg.to.iter().map(|contact| contact.email.clone()).collect(),
            cc: msg.cc.iter().map(|contact| contact.email.clone()).collect(),
            bcc: msg
                .bcc
                .iter()
                .map(|contact| contact.email.clone())
                .collect(),
            content: msg.body_parsed.clone().unwrap_or_default(),
            sent_at: msg.internal_date_ts,
        }
    }
}

#[derive(Debug, JsonSchema, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    description = "Read threaded content by ID(s). Supports reading channels, chats, emails, and projects by their respective IDs. Use this tool when you need to retrieve the full content of a specific item(s). For documents, use ReadContent or ReadMetadata instead.
    Channel transcripts only include the latest 150 messages. Use 'messages_since' to see messages in a different time window.",
    title = "ReadThread"
)]
pub struct ReadThread {
    #[schemars(
        description = "The type of content to read. Choose based on the type of content you want to retrieve."
    )]
    pub content_type: ContentType,
    #[schemars(
        description = "ID(s) of the content to read. IMPORTANT: channel-message, chat-message, and email-message content types support MULTIPLE ids! For all other content types (channel, chat-thread, email-thread) provide a single id."
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
    EmailThread,
    EmailMessage,
    Project,
}

#[async_trait]
impl AsyncTool<Arc<ToolScribe>> for ReadThread {
    type Output = ReadResponse;

    #[tracing::instrument(skip_all, fields(user_id=?(*request_context.user_id).as_ref()), err)]
    async fn call(
        &self,
        scribe: ServiceContext<Arc<ToolScribe>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(self=?self, "ReadThread tool params");

        if self.ids.is_empty() {
            return Err(ToolCallError {
                description: "no ids provided".to_string(),
                internal_error: anyhow::anyhow!("no ids provided"),
            });
        }

        let content = match self.content_type {
            ContentType::Channel => self.read_channel(&scribe).await?,
            ContentType::ChannelMessage => self.read_channel_message(&scribe).await?,
            ContentType::ChatThread => self.read_chat_thread(&scribe).await?,
            ContentType::ChatMessage => self.read_chat_messages(&scribe).await?,
            ContentType::EmailThread => self.read_email_thread(&scribe).await?,
            ContentType::EmailMessage => self.read_email_message(&scribe).await?,
            ContentType::Project => self.read_project(&scribe, &request_context).await?,
        };

        let tool_response = ReadResponse { content };

        ToolResult::Ok(tool_response)
    }
}

impl ReadThread {
    fn provide_single_id(&self) -> Result<String, ToolCallError> {
        if self.ids.len() > 1 {
            return Err(ToolCallError {
                description: format!(
                    "only single id is supported in ids field for content type {}",
                    self.content_type
                ),
                internal_error: anyhow::anyhow!(
                    "only single id is supported in ids field for content type"
                ),
            });
        }
        Ok(self.ids[0].clone())
    }

    async fn read_project(
        &self,
        scribe: &ToolScribe,
        request_context: &RequestContext,
    ) -> Result<ReadContent, ToolCallError> {
        let id = self.ids.first().ok_or(ToolCallError {
            description: "Expected a single id to read a project".into(),
            internal_error: anyhow!("Bad tool args"),
        })?;

        let fetcher = scribe.document.fetch_project(id.to_owned());
        fetcher
            .content(scribe.document.db(), request_context.user_id.clone())
            .await
            .map_err(|err| ToolCallError {
                description: "failed to fetch project".into(),
                internal_error: err,
            })
            .map(|f| ReadContent::ItemPreviews {
                formatted_preview: f.to_string(),
            })
    }

    async fn read_channel(&self, scribe: &ToolScribe) -> Result<ReadContent, ToolCallError> {
        let id = self.provide_single_id()?;

        let since = self
            .messages_since
            .unwrap_or_else(|| chrono::Utc::now() - chrono::Duration::days(7));
        // Get channel metadata
        let metadata = scribe
            .channel
            .get_channel_metadata(id.as_str())
            .await
            .map_err(|e| ToolCallError {
                description: format!("failed to fetch channel metadata: {}", e),
                internal_error: e,
            })?;

        // Get channel transcript
        let transcript = scribe
            .channel
            .get_channel_transcript(id.as_str(), Some(since), Some(MAX_MESSAGES))
            .await
            .map_err(|e| ToolCallError {
                description: format!("failed to fetch channel transcript: {}", e),
                internal_error: e,
            })?;

        Ok(ReadContent::Channel {
            channel_id: id,
            channel_name: Some(metadata.name),
            transcript,
        })
    }

    async fn read_channel_message(
        &self,
        scribe: &ToolScribe,
    ) -> Result<ReadContent, ToolCallError> {
        let mut transcripts = Vec::new();
        let mut channel_id = String::new();

        for id in &self.ids {
            // Get messages with context
            let transcript = match scribe
                .channel
                .get_message_with_context(id.as_str(), 0, 0)
                .await
            {
                Ok(t) => t,
                Err(e) => {
                    tracing::warn!("failed to fetch channel message {}: {}", id, e);
                    continue; // Skip failed messages instead of failing the entire request
                }
            };

            // Use the channel_id from the first message
            if channel_id.is_empty() {
                channel_id = id.clone();
            }

            transcripts.push(transcript);
        }

        if transcripts.is_empty() {
            return Err(ToolCallError {
                description: "failed to fetch any channel messages".to_string(),
                internal_error: anyhow::anyhow!("all channel message fetches failed"),
            });
        }

        // Combine transcripts with separators for multiple messages
        let combined_transcript = if transcripts.len() == 1 {
            transcripts.into_iter().next().unwrap()
        } else {
            transcripts.join("\n\n---\n\n")
        };

        // Note: We don't fetch channel metadata here since the user is focused on a specific message
        // The message_id itself doesn't directly give us the channel_id, but the transcript
        // includes the conversation context
        Ok(ReadContent::Channel {
            channel_id,
            channel_name: None,
            transcript: combined_transcript,
        })
    }

    async fn read_chat_thread(&self, scribe: &ToolScribe) -> Result<ReadContent, ToolCallError> {
        let id = self.provide_single_id()?;
        let history = scribe
            .chat
            .get_chat_history(&id)
            .await
            .map_err(|e| ToolCallError {
                description: format!("failed to fetch chat thread: {}", e),
                internal_error: e,
            })?;

        Ok(ReadContent::Chat { history })
    }

    async fn read_chat_messages(&self, scribe: &ToolScribe) -> Result<ReadContent, ToolCallError> {
        let message_ids = &self.ids;

        let history = scribe
            .chat
            .get_chat_history_for_messages(message_ids)
            .await
            .map_err(|e| ToolCallError {
                description: format!("failed to fetch chat messages: {}", e),
                internal_error: e,
            })?;

        Ok(ReadContent::Chat { history })
    }

    async fn read_email_thread(&self, scribe: &ToolScribe) -> Result<ReadContent, ToolCallError> {
        let id = self.provide_single_id()?;
        let messages = scribe
            .email
            .get_email_messages_by_thread_id(&id, 0, 100)
            .await
            .map_err(|e| ToolCallError {
                description: format!("failed to fetch email thread messages: {}", e),
                internal_error: e,
            })?;

        let subject = messages.first().and_then(|msg| msg.subject.clone());
        let email_messages = messages.into_iter().map(EmailMessage::from).collect();

        Ok(ReadContent::Email {
            thread_id: id,
            subject,
            messages: email_messages,
        })
    }

    async fn read_email_message(&self, scribe: &ToolScribe) -> Result<ReadContent, ToolCallError> {
        let mut email_messages = Vec::new();
        let mut subject = None;
        let mut thread_id = String::new();

        for id in &self.ids {
            let parsed_message = match scribe.email.get_email_message_by_id(id).await {
                Ok(msg) => msg,
                Err(e) => {
                    tracing::warn!("failed to fetch email message {}: {}", id, e);
                    continue; // Skip failed messages instead of failing the entire request
                }
            };

            // Use the subject from the first message
            if subject.is_none() {
                subject = parsed_message.subject.clone();
            }

            // Use the thread_id from the first message
            if thread_id.is_empty() {
                thread_id = id.clone();
            }

            email_messages.push(EmailMessage::from(parsed_message));
        }

        if email_messages.is_empty() {
            return Err(ToolCallError {
                description: "failed to fetch any email messages".to_string(),
                internal_error: anyhow::anyhow!("all email message fetches failed"),
            });
        }

        Ok(ReadContent::Email {
            thread_id,
            subject,
            messages: email_messages,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ai_toolset::tool_object::validate_tool_schema;
    use ai_toolset::{generate_tool_input_schema, generate_tool_output_schema};

    // run `cargo test -p ai_tools read::tests::print_input_schema -- --nocapture --include-ignored`
    #[test]
    #[ignore = "prints the input schema"]
    fn print_input_schema() {
        let schema = generate_tool_input_schema!(ReadThread);
        println!("{}", serde_json::to_string_pretty(&schema).unwrap());
    }

    // run `cargo test -p ai_tools read::tests::print_output_schema -- --nocapture --include-ignored`
    #[test]
    #[ignore = "prints the output schema"]
    fn print_output_schema() {
        let schema = generate_tool_output_schema!(ReadResponse);
        println!("{}", serde_json::to_string_pretty(&schema).unwrap());
    }

    #[test]
    fn test_read_schema_validation() {
        let schema = generate_tool_input_schema!(ReadThread);

        let result = validate_tool_schema(&schema);
        assert!(result.is_ok(), "{:?}", result);

        let (name, description) = result.unwrap();
        assert_eq!(
            name, "ReadThread",
            "Tool name should match the schemars title"
        );
        assert!(
            description.contains("Read threaded content by ID"),
            "Description should contain expected text"
        );
    }
}
