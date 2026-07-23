use crate::api::{
    attachments::get_chats_for_attachment,
    chats::{chat_history, chat_history_batch_messages},
    citations, health,
    preview::get_batch_preview,
    stream::chat_message::{
        self, ChatMessageError, HttpSendChatMessageRequest, SendChatMessageResponse,
    },
    stream::stop::{
        self as stream_stop, StopChatStreamError, StopChatStreamRequest, StopChatStreamResponse,
    },
    structured_completion::{
        self, StructuredCompletionError, StructuredCompletionRequest, StructuredCompletionResponse,
    },
};
use crate::model::{
    response::attachments::GetChatsForAttachmentResponse,
    stream::{ChatStream, SendChatMessagePayload, StreamError, ToolSet},
};
use ai_projections::domain::model::{Expiry, ProjectionStatus, RefreshCadence, TargetType};
use ai_projections::inbound::axum_router::upsert_projection::{
    ProjectionStateResponse, UpsertProjectionRequest,
};
use ai_usage::inbound::axum_router::{self as ai_usage_api};
use import::inbound::axum_router::{self as import_api, RunImportRequest};
use mcp_client::inbound::axum_router::{
    self as mcp_api, AddServerRequest, ServerResponse, StartAuthRequest, StartAuthResponse,
    UpdateServerRequest,
};
use memory::inbound::axum_router::{self as memory_api, MemoryErrorBody, MemoryResponse};
use onboarding::inbound::axum_router::{self as onboarding_api, CompleteOnboardingRequest};

use crate::api::preview::get_batch_preview::{GetBatchPreviewRequest, GetBatchPreviewResponse};

use chat::domain::models::{ChatResponse, GetChatResponse, WebCitation};
use chat::inbound::http::router::{
    self as chat_router, CallToolRequest, CallToolResponse, CreateChatRequest,
    GetChatPermissionsResponse, PatchChatRequest, RejectToolCallRequest, UpdateToolCallRequest,
    UpdateToolResponseRequest,
};

use model::{
    chat::{
        AttachmentMetadata, AttachmentType, Chat, ChatAttachment, ChatHistory, ChatMessage,
        ChatMessageWithAttachments, ConversationRecord, MessageWithAttachments, NewAttachment,
        NewChatMessage, NewMessageAttachment,
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
            chat_router::get_chat_handler,
            chat_router::create_chat_handler,
            chat_router::copy_chat_handler,
            chat_router::get_chat_permissions_handler,
            chat_router::delete_chat_handler,
            chat_router::permanently_delete_chat_handler,
            chat_router::patch_chat_handler,
            chat_router::revert_delete_handler,
            chat_router::update_tool_call_handler,
            chat_router::update_tool_response_handler,
            chat_router::call_tool_handler,
            chat_router::reject_tool_call_handler,
            get_chats_for_attachment::get_chats_for_attachment_handler,
            citations::get_citation_handler,
            get_batch_preview::handler,
            chat_history::get_chat_history_handler,
            chat_history_batch_messages::get_chat_history_batch_messages_handler,
            chat_message::send_chat_message,
            stream_stop::stop_chat_stream,
            structured_completion::structured_completion,
            memory_api::get_memory_handler,
            import_api::get_state_handler,
            import_api::run_import_handler,
            import_api::retry_gather_handler,
            import_api::dismiss_run_handler,
            onboarding_api::get_state_handler,
            onboarding_api::complete_handler,
            ai_usage_api::get_usage_handler,
            ai_usage_api::set_pricing_handler,
            ai_projections::inbound::axum_router::upsert_projection::handler::<crate::api::context::DcsAiProjectionService>,
            mcp_api::list_servers,
            mcp_api::add_server,
            mcp_api::update_server,
            mcp_api::delete_server,
            mcp_api::start_auth,
            mcp_api::auth_callback
        ),
        components(
            schemas(
                DocumentCognitionServiceApiVersion,
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

                // Tool Operations
                UpdateToolCallRequest,
                UpdateToolResponseRequest,
                CallToolRequest,
                CallToolResponse,
                RejectToolCallRequest,

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
                StopChatStreamRequest,
                StopChatStreamResponse,
                StopChatStreamError,
                StreamError,
                ToolSet,
                StructuredCompletionRequest,
                StructuredCompletionResponse,
                StructuredCompletionError,
                agent::structured_output::DynamicSchema,

                // Memory
                MemoryResponse,
                MemoryErrorBody,

                // Import pipeline
                import::domain::models::ImportState,
                import::domain::models::ImportEntity,
                import::domain::models::ImportRun,
                import::domain::models::ImportSource,
                import::domain::models::ImportStatus,
                import::domain::models::Initiator,
                import::domain::models::RunStatus,
                import::domain::models::LinearIssueMeta,
                import::domain::models::NotionDocMeta,
                import::domain::models::SlackChannelMeta,
                import::domain::models::SlackParticipant,
                import::domain::service::RunImportOutcome,
                RunImportRequest,

                // Onboarding
                onboarding::domain::models::OnboardingState,
                onboarding::domain::models::OnboardingRow,
                onboarding::domain::models::OnboardingStatus,
                onboarding::domain::models::ConnectedServer,
                CompleteOnboardingRequest,

                // AI cost
                ai_usage_api::UsageRequest,
                ai_usage_api::SetPricingRequest,
                ai_usage_api::ErrorBody,
                ai_usage::UsageSummary,
                ai_usage::FeatureUsage,
                ai_usage::CompletionUsage,
                ai_usage::Usage,
                ai_usage::Price,
                ai_usage::AiFeature,

                // AI projections
                UpsertProjectionRequest,
                ProjectionStateResponse,
                TargetType,
                RefreshCadence,
                Expiry,
                ProjectionStatus,

                // MCP
                ServerResponse,
                AddServerRequest,
                UpdateServerRequest,
                StartAuthRequest,
                StartAuthResponse,
                model_error_response::ErrorResponse,
            ),
        ),
        tags(
            (name = "macro document cognition service", description = "Document Cognition Service")
        )
    )]
pub struct ApiDoc;
