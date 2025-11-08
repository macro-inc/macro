use crate::{
    api::{
        attachments::{
            get_chats_for_attachment,
            get_models_for_attachments::{
                self, GetModelsForAttachmentsRequest, GetModelsForAttachmentsResponse,
            },
            verify_attachments::{self, VerifyAttachmentsRequest, VerifyAttachmentsResponse},
        },
        chats::{
            chat_history, chat_history_batch_messages, copy_chat, create_user_chat, delete_chat,
            get_chat, get_chat_permissions, get_chats, revert_delete_chat,
        },
        citations,
        completions::get_completion::{self, GetCompletionRequest, GetCompletionResponse},
        completions::structured_output::{
            self, StructedOutputCompletionRequest, StructedOutputCompletionResponse,
        },
        document_text::upsert_document_text,
        health,
        macros::{
            create_macro, delete_macro, get_macro, get_macro_permissions, get_macros, patch_macro,
        },
        models::get_models,
        preview::get_batch_preview,
        tools,
        ws::{self},
    },
    model::{
        request::{
            chats::{
                CopyChatRequest, CreateChatRequest, GetChatPathParams, NewAttachment,
                PatchChatRequest, PatchChatRequestV2,
            },
            document_text::{CreateTextRequestBody, CreateTextRequestParams},
            macros::{CreateMacroRequest, GetMacroPathParams, PatchMacroRequest},
        },
        response::{
            attachments::GetChatsForAttachmentResponse,
            chats::{GetChatPermissionsResponseV2, GetChatResponse, GetModelsResponse},
            macros::GetMacroResponse,
            models::AIModel,
        },
        ws::{
            ExtractionStatusPayload, FromWebSocketMessage, SelectModelPayload,
            SendChatMessagePayload, SendCompletionPayload, StopChatMessagePayload,
            ToWebSocketMessage, WebSocketError,
        },
    },
};

use crate::api::preview::get_batch_preview::{GetBatchPreviewRequest, GetBatchPreviewResponse};

use ai::types::{ModelMetadata, Provider};

use crate::model::chats::{ChatResponse, ChatsResponse};

use model::{
    chat::{
        AttachmentMetadata, AttachmentType, Chat, ChatAttachment, ChatAttachmentWithName,
        ChatHistory, ChatMessage, ChatMessageWithAttachments, ConversationRecord,
        MessageWithAttachmentSummary, NewChatMessage, NewMessageAttachment, Summary,
    },
    insight_context::document::DocumentSummary,
    macros::{Macro, MacroResponse, MacrosResponse},
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
            ws::connection::ws_handler,
            create_user_chat::create_chat_handler,
            copy_chat::copy_chat_handler,
            get_chat_permissions::get_chat_permissions_handler_v2,
            delete_chat::delete_chat_handler,
            delete_chat::permanently_delete_chat_handler,
            get_models::get_models_handler,
            get_chats::get_chats_handler,
            get_macro::get_macro_handler,
            get_macros::get_macros_handler,
            get_macro_permissions::get_macro_permissions_handler,
            delete_macro::delete_macro_handler,
            create_macro::create_macro_handler,
            patch_macro::patch_macro_handler,
            upsert_document_text::upsert_text_handler,
            get_chats_for_attachment::get_chats_for_attachment_handler,
            verify_attachments::verify_attachments_handler,
            citations::get_citation_handler,
            get_batch_preview::handler,
            structured_output::handler,
            get_models_for_attachments::get_models_for_attachments_handler,
            get_completion::get_completion_handler,
            revert_delete_chat::handler,
            chat_history::get_chat_history_handler,
            chat_history_batch_messages::get_chat_history_batch_messages_handler,
            tools::get_tool_schemas,
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
                MessageWithAttachmentSummary,
                Summary,
                ChatMessage,
                ChatMessageWithAttachments,
                ChatResponse,
                NewChatMessage,
                NewMessageAttachment,

                // Chat History
                ChatHistoryBatchMessagesRequest,
                DocumentSummary,

                // Citation
                DocumentTextPart,

                // Chat Request
                CreateChatRequest,
                GetChatPathParams,
                PatchChatRequest,
                PatchChatRequestV2,
                AttachmentMetadata,
                CopyChatRequest,
                GetModelsForAttachmentsResponse,
                // Chat Response
                GetChatPermissionsResponseV2,
                GetChatResponse,
                ChatsResponse,

                // Document Text
                CreateTextRequestBody,
                CreateTextRequestParams,

                // Macro Prompt
                Macro,
                MacroResponse,
                CreateMacroRequest,
                GetMacroPathParams,
                GetMacroResponse,
                MacrosResponse,
                PatchMacroRequest,


                // Share Permission
                UpdateOperation,

                // WebSocket
                ToWebSocketMessage,
                FromWebSocketMessage,
                SendChatMessagePayload,
                StopChatMessagePayload,
                WebSocketError,
                SelectModelPayload,
                ExtractionStatusPayload,
                SendCompletionPayload,

                // Attachments
                GetChatsForAttachmentResponse,
                NewAttachment,
                VerifyAttachmentsRequest,
                VerifyAttachmentsResponse,
                GetModelsForAttachmentsResponse,
                GetModelsForAttachmentsRequest,

                // Preview
                GetBatchPreviewRequest,
                GetBatchPreviewResponse,

                // Completions
                StructedOutputCompletionRequest,
                StructedOutputCompletionResponse,
                GetCompletionRequest,
                GetCompletionResponse,

                // Tools
                tools::ToolSchemasResponse,
                tools::ToolSchema
            ),
        ),
        tags(
            (name = "macro document cognition service", description = "Document Cognition Service")
        )
    )]
pub struct ApiDoc;
