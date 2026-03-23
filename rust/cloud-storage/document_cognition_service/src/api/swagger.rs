use crate::api::{
    attachments::get_chats_for_attachment,
    chats::{chat_history, chat_history_batch_messages},
    citations, health,
    models::get_models,
    preview::get_batch_preview,
    stream::chat_message::{
        self, ChatMessageError, HttpSendChatMessageRequest, SendChatMessageResponse,
    },
};
use crate::model::{
    response::{
        attachments::GetChatsForAttachmentResponse, models::AIModel, models::GetModelsResponse,
    },
    stream::{ChatStream, SendChatMessagePayload, StreamError, ToolSet},
};

use crate::api::preview::get_batch_preview::{GetBatchPreviewRequest, GetBatchPreviewResponse};

use ai::types::{ModelMetadata, Provider};

use chat::domain::models::{ChatResponse, GetChatResponse, WebCitation};
use chat::inbound::{
    self as chat_inbound, CreateChatRequest, GetChatPermissionsResponse, PatchChatRequest,
};

use model::{
    chat::{
        AttachmentMetadata, AttachmentType, Chat, ChatAttachment, ChatAttachmentWithName,
        ChatHistory, ChatMessage, ChatMessageWithAttachments, ConversationRecord,
        MessageWithAttachments, NewAttachment, NewChatMessage, NewMessageAttachment,
    },
    response::{GenericErrorResponse, StringIDResponse},
    version::DocumentCognitionServiceApiVersion,
};

use model::citations::DocumentTextPart;
use models_dcs::api::ChatHistoryBatchMessagesRequest;
use models_permissions::share_permission::channel_share_permission::UpdateOperation;
use utoipa::OpenApi;

// TODO: update to a real license - I added this bc it's required by orval
#[derive(OpenApi)]
#[openapi(
        info(
            title = "Document Cognition Service",
            version = "1.0.0",
            terms_of_service = "https://macro.com/terms",
            license(name = "Proprietary", identifier = "Proprietary"),
        ),
        paths(
            health::health_handler,
            chat_inbound::get_chat_handler,
            chat_inbound::create_chat_handler,
            chat_inbound::copy_chat_handler,
            chat_inbound::get_chat_permissions_handler,
            chat_inbound::delete_chat_handler,
            chat_inbound::permanently_delete_chat_handler,
            chat_inbound::patch_chat_handler,
            chat_inbound::revert_delete_handler,
            get_models::get_models_handler,
            get_chats_for_attachment::get_chats_for_attachment_handler,
            citations::get_citation_handler,
            get_batch_preview::handler,
            chat_history::get_chat_history_handler,
            chat_history_batch_messages::get_chat_history_batch_messages_handler,
            chat_message::send_chat_message
        ),
        components(
            schemas(
                DocumentCognitionServiceApiVersion,
                // Models
                GetModelsResponse,
                Provider,
                ModelMetadata,
                AIModel,
                // Generic
                StringIDResponse,
                GenericErrorResponse,
                // Permissions V2
                models_permissions::share_permission::access_level::AccessLevel, models_permissions::share_permission::SharePermissionV2, models_permissions::share_permission::UpdateSharePermissionRequestV2, // Share permission
                models_permissions::share_permission::channel_share_permission::ChannelSharePermission, models_permissions::share_permission::channel_share_permission::UpdateChannelSharePermission, // Channel share permissions

                // Chat
                Chat,
                ChatAttachment,
                AttachmentType,
                ChatAttachmentWithName,
                ChatHistory,
                ConversationRecord,
                MessageWithAttachments,
                ChatMessage,
                ChatMessageWithAttachments,
                ChatResponse,
                NewChatMessage,
                NewMessageAttachment,
                WebCitation,

                // Chat History
                ChatHistoryBatchMessagesRequest,

                // Citation
                DocumentTextPart,

                // Chat Request
                CreateChatRequest,
                PatchChatRequest,
                AttachmentMetadata,
                // Chat Response
                GetChatPermissionsResponse,
                GetChatResponse,

                // Share Permission
                UpdateOperation,

                //stream
                ChatStream,
                SendChatMessagePayload,
                StreamError,

                // Attachments
                GetChatsForAttachmentResponse,
                NewAttachment,

                // Preview
                GetBatchPreviewRequest,
                GetBatchPreviewResponse,

                // Stream HTTP API
                HttpSendChatMessageRequest,
                SendChatMessageResponse,
                ChatMessageError,
                StreamError,
                ToolSet,

                // Tools
                ai::tool::schema::ToolSchema,
                ai::tool::schema::ToolSchemas,
            ),
        ),
        tags(
            (name = "macro document cognition service", description = "Document Cognition Service")
        )
    )]
pub struct ApiDoc;
