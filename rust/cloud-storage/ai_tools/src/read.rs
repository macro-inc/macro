use crate::tool_context::{RequestContext, ToolServiceContext};
use ai::tool::{AsyncTool, ToolCallError, ToolResult};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use model::chat::ChatHistory;
use models_email::email::service::message::ParsedMessage;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const MAX_MESSAGES: i64 = 300;

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
    Document {
        document_id: String,
        content: String,
        metadata: DocumentMetadata,
    },
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
    description = "Read content by ID(s). Supports reading documents, channels, chats, and emails by their respective IDs. Use this tool when you need to retrieve the full content of a specific item(s).
    Channel transcripts only include 300 messages. Use 'messages_since' to see messages in a different time window.",
    title = "Read"
)]
pub struct Read {
    #[schemars(
        description = "The type of content to read. Choose based on the type of content you want to retrieve."
    )]
    pub content_type: ContentType,
    #[schemars(
        description = "ID(s) of the content to read. IMPORTANT: Currently only chat-message content type supports MULTIPLE ids! For all other content types provide a single id."
    )]
    pub ids: Vec<String>,
    #[schemars(
        description = "A local datetime of the earliest message to include in a channel transcript ex: 2025-11-25 12:00:09 EST, only applicable to channels"
    )]
    pub messages_since: Option<chrono::DateTime<chrono::Local>>,
}

#[derive(Debug, JsonSchema, Deserialize, Clone, strum::EnumString, strum::Display)]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum ContentType {
    Document,
    Channel,
    ChannelMessage,
    ChatThread,
    ChatMessage,
    EmailThread,
    EmailMessage,
}

#[async_trait]
impl AsyncTool<ToolServiceContext, RequestContext> for Read {
    type Output = ReadResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        context: ToolServiceContext,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(self=?self, "Read tool params");

        if self.ids.is_empty() {
            return Err(ToolCallError {
                description: "no ids provided".to_string(),
                internal_error: anyhow::anyhow!("no ids provided"),
            });
        }

        let content = match self.content_type {
            ContentType::Document => self.read_document(&context, &request_context).await?,
            ContentType::Channel => self.read_channel(&context, &request_context).await?,
            ContentType::ChannelMessage => {
                self.read_channel_message(&context, &request_context)
                    .await?
            }
            ContentType::ChatThread => self.read_chat_thread(&context, &request_context).await?,
            ContentType::ChatMessage => self.read_chat_messages(&context, &request_context).await?,
            ContentType::EmailThread => self.read_email_thread(&context, &request_context).await?,
            ContentType::EmailMessage => {
                self.read_email_message(&context, &request_context).await?
            }
        };

        let tool_response = ReadResponse { content };

        ToolResult::Ok(tool_response)
    }
}

impl Read {
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

    async fn read_document(
        &self,
        context: &ToolServiceContext,
        request_context: &RequestContext,
    ) -> Result<ReadContent, ToolCallError> {
        let id = self.provide_single_id()?;

        let document_fetcher = context
            .scribe
            .document
            .fetch_with_auth(&id, request_context.jwt_token.clone());

        let document_with_content =
            document_fetcher
                .document_content()
                .await
                .map_err(|e| ToolCallError {
                    description: format!("failed to fetch document content: {}", e),
                    internal_error: e,
                })?;

        let metadata = document_with_content.metadata().clone();
        let content_str =
            document_with_content
                .content
                .text_content()
                .map_err(|e| ToolCallError {
                    description: format!("failed to extract text content: {}", e),
                    internal_error: e,
                })?;

        Ok(ReadContent::Document {
            document_id: id,
            content: content_str,
            metadata: DocumentMetadata {
                document_name: metadata.document_name,
                owner: metadata.owner,
                file_type: metadata.file_type,
                project_id: metadata.project_id,
                deleted: metadata.deleted_at.is_some(),
            },
        })
    }

    async fn read_channel(
        &self,
        context: &ToolServiceContext,
        request_context: &RequestContext,
    ) -> Result<ReadContent, ToolCallError> {
        let id = self.provide_single_id()?;

        let since = self
            .messages_since
            .map(DateTime::<Utc>::from)
            .unwrap_or_else(|| chrono::Utc::now() - chrono::Duration::days(7));
        // Get channel metadata
        let metadata = context
            .scribe
            .channel
            .get_channel_metadata(id.as_str(), Some(&request_context.jwt_token))
            .await
            .map_err(|e| ToolCallError {
                description: format!("failed to fetch channel metadata: {}", e),
                internal_error: e,
            })?;

        // Get channel transcript
        let transcript = context
            .scribe
            .channel
            .get_channel_transcript(
                id.as_str(),
                Some(&request_context.jwt_token),
                Some(since),
                Some(MAX_MESSAGES),
            )
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
        context: &ToolServiceContext,
        request_context: &RequestContext,
    ) -> Result<ReadContent, ToolCallError> {
        let id = self.provide_single_id()?;

        // Get messages with context
        let transcript = context
            .scribe
            .channel
            .get_message_with_context(id.as_str(), 0, 0, &request_context.jwt_token)
            .await
            .map_err(|e| ToolCallError {
                description: format!("failed to fetch channel message with context: {}", e),
                internal_error: e,
            })?;

        // Note: We don't fetch channel metadata here since the user is focused on a specific message
        // The message_id itself doesn't directly give us the channel_id, but the transcript
        // includes the conversation context
        Ok(ReadContent::Channel {
            channel_id: id,
            channel_name: None,
            transcript,
        })
    }

    async fn read_chat_thread(
        &self,
        context: &ToolServiceContext,
        request_context: &RequestContext,
    ) -> Result<ReadContent, ToolCallError> {
        let id = self.provide_single_id()?;
        let history = context
            .scribe
            .chat
            .get_chat_history(&id, Some(&request_context.jwt_token))
            .await
            .map_err(|e| ToolCallError {
                description: format!("failed to fetch chat thread: {}", e),
                internal_error: e,
            })?;

        Ok(ReadContent::Chat { history })
    }

    async fn read_chat_messages(
        &self,
        context: &ToolServiceContext,
        request_context: &RequestContext,
    ) -> Result<ReadContent, ToolCallError> {
        let message_ids = &self.ids;

        let history = context
            .scribe
            .chat
            .get_chat_history_for_messages(message_ids, Some(&request_context.jwt_token))
            .await
            .map_err(|e| ToolCallError {
                description: format!("failed to fetch chat message: {}", e),
                internal_error: e,
            })?;

        Ok(ReadContent::Chat { history })
    }

    async fn read_email_thread(
        &self,
        context: &ToolServiceContext,
        request_context: &RequestContext,
    ) -> Result<ReadContent, ToolCallError> {
        let id = self.provide_single_id()?;
        let messages = context
            .scribe
            .email
            .get_email_messages_by_thread_id(&id, 0, 100, Some(&request_context.jwt_token))
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

    async fn read_email_message(
        &self,
        context: &ToolServiceContext,
        request_context: &RequestContext,
    ) -> Result<ReadContent, ToolCallError> {
        let id = self.provide_single_id()?;
        let parsed_message = context
            .scribe
            .email
            .get_email_message_by_id(&id, Some(&request_context.jwt_token))
            .await
            .map_err(|e| ToolCallError {
                description: format!("failed to fetch email message: {}", e),
                internal_error: e,
            })?;
        let subject = parsed_message.subject.clone();

        let email_message = EmailMessage::from(parsed_message);

        Ok(ReadContent::Email {
            thread_id: id,
            subject,
            messages: vec![email_message],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ai::tool::types::toolset::tool_object::validate_tool_schema;
    use ai::{generate_tool_input_schema, generate_tool_output_schema};

    // run `cargo test -p ai_tools read::tests::print_input_schema -- --nocapture --include-ignored`
    #[test]
    #[ignore = "prints the input schema"]
    fn print_input_schema() {
        let schema = generate_tool_input_schema!(Read);
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
        let schema = generate_tool_input_schema!(Read);

        let result = validate_tool_schema(&schema);
        assert!(result.is_ok(), "{:?}", result);

        let (name, description) = result.unwrap();
        assert_eq!(name, "Read", "Tool name should match the schemars title");
        assert!(
            description.contains("Read content by ID"),
            "Description should contain expected text"
        );
    }
}
