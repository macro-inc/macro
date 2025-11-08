use ai::types::AssistantMessagePart;
use ai::types::Model;
use axum::extract::ws::Message;
use model::chat::ChatAttachmentWithName;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Deserialize, Serialize, ToSchema, Debug, Clone)]
pub struct JwtPayload {
    pub token: String,
}

#[derive(Serialize, Deserialize, ToSchema, Debug, Clone, Default)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum ToolSet {
    #[default]
    All,
    None,
}

#[derive(Deserialize, Serialize, ToSchema, Debug, Clone)]
pub struct SendChatMessagePayload {
    /// you give me id, i give you id
    pub stream_id: String,
    /// The content of the message
    pub content: String,
    /// Id of the chat the message belongs to
    pub chat_id: String,
    /// the chate model to respond with
    pub model: Model,
    /// Additional system instructions appended to the base system prompt
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_instructions: Option<String>,
    /// Use citation prompt
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<ChatAttachmentWithName>>,
    /// Which toolset to use. Defaults to `all`
    #[serde(default)]
    pub toolset: ToolSet,
    #[serde(flatten)]
    pub jwt: JwtPayload,
}

#[derive(Deserialize, Serialize, ToSchema, Debug)]
pub struct StopChatMessagePayload {
    /// stream id
    pub stream_id: String,
}

#[derive(Deserialize, Serialize, ToSchema, Debug)]
pub struct SelectModelPayload {
    pub chat_id: String,
    pub model: String,
}

#[derive(Deserialize, Serialize, ToSchema, Debug, Clone)]
pub struct ExtractionStatusPayload {
    pub attachment_id: String,
}

#[derive(Deserialize, Serialize, ToSchema, Debug, Clone)]
pub struct SendCompletionPayload {
    /// Optional attachment id for the completion
    pub attachment_id: Option<String>,
    /// the prompt of the completion
    pub prompt: String,
    /// Optional completion id to keep track of the completion
    /// if non is provided, one will be generated
    pub completion_id: Option<String>,
    /// The selected text for the completion,
    pub selected_text: Option<String>,
}

#[derive(Deserialize, Serialize, ToSchema, Debug, Clone)]
pub struct GetSimpleCompletionStreamPayload {
    /// system prompt
    pub prompt: String,
    /// user request
    pub user_request: String,
    /// model to use for the completion
    #[schema(value_type = Option<String>)]
    pub model: Option<Model>,
    /// max tokens
    pub max_tokens: Option<u32>,
    /// Optional document ID to provide context
    pub content_document_ids: Option<Vec<String>>,
    /// client provided id, returned in responses
    pub completion_id: String,
}

#[derive(Deserialize, Serialize, ToSchema, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ToWebSocketMessage {
    /// Initializes a new message in a chat for streaming
    SendChatMessage(SendChatMessagePayload),

    /// Replace user message and restream response
    EditChatMessage(SendChatMessagePayload),

    /// Stop streaming for a given message
    StopChatMessage(StopChatMessagePayload),

    /// Select model for a given chat
    SelectModelForChat(SelectModelPayload),

    /// Get extraction status for a given attachment
    ExtractionStatus(ExtractionStatusPayload),

    /// pdf completion
    SendCompletion(SendCompletionPayload),
    /// stream a simple completion
    GetSimpleCompletionStream(GetSimpleCompletionStreamPayload),
}

#[derive(Deserialize, Serialize, ToSchema, Debug, Clone, PartialEq, Copy)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ExtractionStatusEnum {
    // Extraction incomplete
    Incomplete,

    // Extraction complete, but text content is empty
    Empty,

    // Extraction complete, but text content is insufficient
    Insufficient,

    // Extraction complete and sufficient
    Complete,
}

// Akkad prospers and we cope
impl From<macro_db_client::dcs::get_document_text::ExtractionStatusEnum> for ExtractionStatusEnum {
    fn from(value: macro_db_client::dcs::get_document_text::ExtractionStatusEnum) -> Self {
        match value {
            macro_db_client::dcs::get_document_text::ExtractionStatusEnum::Complete => {
                Self::Complete
            }
            macro_db_client::dcs::get_document_text::ExtractionStatusEnum::Empty => Self::Empty,
            macro_db_client::dcs::get_document_text::ExtractionStatusEnum::Insufficient => {
                Self::Insufficient
            }
            macro_db_client::dcs::get_document_text::ExtractionStatusEnum::Incomplete => {
                Self::Incomplete
            }
        }
    }
}

#[derive(Serialize, Deserialize, ToSchema, Debug, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FromWebSocketMessage {
    /// Misc error
    Error(WebSocketError),

    /// Acknowledges that a message has been received for processing
    ChatMessageAck {
        message_id: String,
        chat_id: String,
    },

    /// Indicates a response from the chat completion API for a given message
    ChatMessageResponse {
        stream_id: String,
        message_id: String,
        chat_id: String,
        content: AssistantMessagePart,
    },

    /// Indicates that a message has been finished
    ChatMessageFinished {
        message_id: String,
        chat_id: String,
        user_message_id: String,
    },

    /// Indicates that a chat has been renamed
    ChatRenamed {
        stream_id: String,
        chat_id: String,
        name: String,
    },

    /// Notifies the client that the available models have changed
    ModelSelectionChanged {
        chat_id: String,
        available_models: Vec<Model>,
        new_model: Option<Model>,
    },

    TokenCountChanged {
        chat_id: String,
        token_count: i64,
    },

    /// Status update
    ChatMessageStatusUpdate {
        chat_id: String,
        message_id: String,
        message: String,
    },

    /// Acknowledges the request to get extraction status
    /// if the `status` field is 'incomplete', we need to await the extraction status updates
    /// if the `status` field is 'empty', extraction is complete but text content is empty
    /// if the `status` field is 'complete', the extraction is already complete
    ExtractionStatusAck {
        attachment_id: String,
        status: ExtractionStatusEnum,
    },

    /// Status update for the extraction status
    ExtractionStatusUpdate {
        attachment_id: String,
        status: ExtractionStatusEnum,
    },

    Pong,

    /// pdf completion
    CompletionResponse {
        completion_id: String,
        content: String,
        done: bool,
    },

    CompletionStreamChunk {
        completion_id: String,
        content: String,
        done: bool,
    },

    StreamEnd {
        stream_id: String,
    },
}

impl TryInto<ToWebSocketMessage> for Message {
    type Error = serde_json::Error;
    fn try_into(self) -> Result<ToWebSocketMessage, Self::Error> {
        let payload =
            serde_json::from_str::<ToWebSocketMessage>(self.to_text().unwrap_or_default())?;
        Ok(payload)
    }
}

impl From<FromWebSocketMessage> for Message {
    fn from(val: FromWebSocketMessage) -> Self {
        match val {
            FromWebSocketMessage::Pong => Message::Text("pong".to_string()),
            _ => {
                let payload = serde_json::to_string(&val).unwrap();
                Message::Text(payload)
            }
        }
    }
}

#[derive(Serialize, Debug, ToSchema, Deserialize, Clone)]
pub struct GenericErrorResponse {
    pub message: String,
}

#[derive(thiserror::Error, Debug, ToSchema, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case", tag = "stream_error")]
pub enum StreamError {
    #[error("provider error")]
    ProviderError { stream_id: String, model: Model },

    #[error("model context overflow")]
    ModelContextOverflow { stream_id: String, model: Model },

    #[error("internal error")]
    InternalError { stream_id: String },

    #[error("unauthorized")]
    Unauthorized { stream_id: String },

    #[error("payment required")]
    PaymentRequired { stream_id: String },
}

/// Subset enum containing only WebSocketError variants that have stream_id
#[derive(thiserror::Error, Debug, Clone)]
pub enum StreamWebSocketError {
    #[error("edit message error")]
    FailedToEditMessage { reason: String, stream_id: String },

    #[error("stream error")]
    StreamError(#[from] StreamError),
}

impl StreamWebSocketError {
    pub fn stream_id(&self) -> &str {
        match self {
            StreamWebSocketError::FailedToEditMessage { stream_id, .. } => stream_id,
            StreamWebSocketError::StreamError(StreamError::ProviderError { stream_id, .. }) => {
                stream_id
            }
            StreamWebSocketError::StreamError(StreamError::ModelContextOverflow {
                stream_id,
                ..
            }) => stream_id,
            StreamWebSocketError::StreamError(StreamError::InternalError { stream_id, .. }) => {
                stream_id
            }
            StreamWebSocketError::StreamError(StreamError::Unauthorized { stream_id }) => stream_id,
            StreamWebSocketError::StreamError(StreamError::PaymentRequired { stream_id }) => {
                stream_id
            }
        }
    }
}

impl From<StreamWebSocketError> for WebSocketError {
    fn from(err: StreamWebSocketError) -> Self {
        match err {
            StreamWebSocketError::FailedToEditMessage { reason, stream_id } => {
                WebSocketError::FailedToEditMessage { reason, stream_id }
            }
            StreamWebSocketError::StreamError(stream_err) => {
                WebSocketError::StreamError(stream_err)
            }
        }
    }
}

#[derive(thiserror::Error, Debug, ToSchema, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case", tag = "error_type")]
pub enum WebSocketError {
    #[error("stream error")]
    StreamError(StreamError),

    // NOTE: unused
    #[error("failed to send chat message for chat {chat_id} : {details:?}")]
    FailedToSendChatMessage {
        details: Option<String>,
        chat_id: String,
        message_id: String,
        stream_id: String,
    },

    // NOTE: unused
    #[error("failed to automatically rename chat {chat_id} : {details:?}")]
    FailedToRenameChat {
        details: Option<String>,
        chat_id: String,
        stream_id: String,
    },

    #[error("failed to send error message : {details:?}")]
    FailedToSendErrorMessage { details: Option<String> },

    // NOTE: unused
    #[error("failed to store chat {chat_id}: {details:?}")]
    FailedToStoreChat {
        details: Option<String>,
        chat_id: String,
        stream_id: String,
    },

    #[error("an internal server error occurred")]
    Generic(GenericErrorResponse),

    #[error("failed to send a message over the websocket : {details:?}")]
    FailedToSendWebsocketMessage { details: Option<String> },

    #[error("failed to select model : {details:?}")]
    FailedToSelectModel { details: Option<String> },

    // NOTE: unused
    #[error("failed to update token count : {details:?}")]
    FailedToUpdateTokenCount {
        details: Option<String>,
        chat_id: String,
        message_id: String,
        stream_id: String,
    },

    #[error("extraction status has failed")]
    ExtractionStatusFailed { attachment_id: String },

    #[error("attachment permission error: {attachment_ids:?}")]
    AttachmentPermissionError { attachment_ids: Vec<String> },

    #[error("edit message error")]
    FailedToEditMessage { reason: String, stream_id: String },
}
