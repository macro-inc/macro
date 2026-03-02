use crate::{
    api::{
        attachments::get_chats_for_attachment,
        chats::{
            chat_history, chat_history_batch_messages, copy_chat, create_user_chat, delete_chat,
            get_chat, get_chat_permissions, revert_delete_chat,
        },
        citations, health,
        models::get_models,
        preview::get_batch_preview,
        stream::chat_message::{
            self, ChatMessageError, HttpSendChatMessageRequest, SendChatMessageResponse,
        },
    },
    model::{
        request::chats::{
            CopyChatRequest, CreateChatRequest, GetChatPathParams, NewAttachment, PatchChatRequest,
            PatchChatRequestV2,
        },
        response::{
            attachments::GetChatsForAttachmentResponse,
            chats::{GetChatPermissionsResponseV2, GetChatResponse, GetModelsResponse},
            models::AIModel,
        },
        stream::{ChatStream, SendChatMessagePayload, StreamError, ToolSet},
    },
};

use crate::api::preview::get_batch_preview::{GetBatchPreviewRequest, GetBatchPreviewResponse};

use ai::types::{ModelMetadata, Provider};

use crate::model::chats::ChatResponse;

use model::{
    chat::{
        AttachmentMetadata, AttachmentType, Chat, ChatAttachment, ChatAttachmentWithName,
        ChatHistory, ChatMessage, ChatMessageWithAttachments, ConversationRecord,
        MessageWithAttachments, NewChatMessage, NewMessageAttachment,
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
            get_chat::get_chat_handler,
            create_user_chat::create_chat_handler,
            copy_chat::copy_chat_handler,
            get_chat_permissions::get_chat_permissions_handler_v2,
            delete_chat::delete_chat_handler,
            delete_chat::permanently_delete_chat_handler,
            get_models::get_models_handler,
            get_chats_for_attachment::get_chats_for_attachment_handler,
            citations::get_citation_handler,
            get_batch_preview::handler,
            revert_delete_chat::handler,
            chat_history::get_chat_history_handler,
            chat_history_batch_messages::get_chat_history_batch_messages_handler,
            chat_message::send_chat_message,
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

                // Chat History
                ChatHistoryBatchMessagesRequest,

                // Citation
                DocumentTextPart,

                // Chat Request
                CreateChatRequest,
                GetChatPathParams,
                PatchChatRequest,
                PatchChatRequestV2,
                AttachmentMetadata,
                CopyChatRequest,
                // Chat Response
                GetChatPermissionsResponseV2,
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
