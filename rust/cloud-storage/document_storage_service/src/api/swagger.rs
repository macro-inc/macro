#![allow(
    deprecated,
    reason = "Just to allow GetActivitiesResponse and UserActivitiesResponse"
)]

use crate::api::saved_views::{
    CreateViewRequest, ExcludeDefaultViewRequest, ExcludedDefaultView, View, ViewPatch,
};
use crate::{
    api::{
        activity, annotations,
        documents::{
            self,
            export_document::ExportDocumentResponse,
            permissions_token::{
                create_permission_token::DocumentPermissionsTokenResponse,
                validate_permissions_token::DocumentPermissionsTokenRequest,
            },
        },
        entity, health, history, instructions, pins,
        projects::{
            self,
            delete_project::{ProjectDeleteResponse, ProjectDeleteResponseData},
        },
        recents::{
            self,
            recently_deleted::{RecentlyDeletedResponse, RecentlyDeletedResponseData},
        },
        saved_views, threads, user_document_view_location,
    },
    model::{
        request::{
            documents::{
                preview::GetBatchPreviewRequest,
                save::{PreSaveDocumentRequest, SaveDocumentRequest},
                user_document_view_location::UpsertUserDocumentViewLocationRequest,
            },
            pins::{AddPinRequest, PinRequest},
        },
        response::{
            activity::{GetActivitiesResponse, UserActivitiesResponse},
            documents::{
                create::{CreateBulkDocumentResponse, CreateBulkDocumentResponseData},
                get::{
                    GetDocumentKeyResponse, GetDocumentKeyResponseData,
                    GetDocumentPermissionsResponseDataV2, GetDocumentProcessingResult,
                    GetDocumentProcessingResultResponse, GetDocumentSearchResponse,
                    GetDocumentUserAccessLevelResponse, GetDocumentsResponse,
                    UserDocumentsResponse,
                },
                preview::GetBatchPreviewResponse,
                save::{
                    PreSaveDocumentResponse, PreSaveDocumentResponseData, SaveDocumentResponse,
                    SaveDocumentResponseData,
                },
                user_document_view_location::UserDocumentViewLocationResponse,
            },
            history::GetUserHistoryResponse,
            instructions::{CreateInstructionsDocumentResponse, GetInstructionsDocumentResponse},
            pin::{GetPinsResponse, UserPinsResponse},
            user_views::UserViewsResponse,
        },
    },
};
use channels::inbound::axum_router::{
    ApiChannelAttachment, ApiChannelAttachmentsPage, ApiChannelContextMessage, ApiChannelMessage,
    ApiChannelMessageKind, ApiChannelMessagesPage, ApiChannelParticipant, ApiCountedReaction,
    ApiMessageAttachment, ApiParticipantRole, ApiResolvedChannelMessage, ApiThreadInfo,
    ApiThreadReply, ChannelMessageFilters, GetMessageWithContextResponse,
};
use document_sub_type::DocumentSubType;
use documents_hex::inbound::axum_router::{
    edit_document::EditDocumentResponse, get_branch_name::BranchNameResponse,
    get_short_id::ShortIdResponse,
};
use model::document::response::{
    CreateDocumentRequest, CreateDocumentResponse, CreateDocumentResponseData,
    DocumentResponseMetadata,
};
use model::{
    activity::Activity,
    annotations::AnnotationIncrementalUpdate,
    chat::Chat,
    document::{
        BasicDocument, BomPart, DocumentMetadata, DocumentPermissionsToken, FileType, SaveBomPart,
        response::{
            GetDocumentListResult, GetDocumentResponse, GetDocumentResponseData,
            LocationResponseData,
        },
    },
    item::{CloudStorageItemType, Item, ItemWithUserAccessLevel},
    pin::{PinnedItem, request::ReorderPinRequest},
    project::{
        Project,
        request::{CreateProjectRequest, GetBatchProjectPreviewRequest, PatchProjectRequestV2},
        response::{
            CreateProjectResponse, GetBatchProjectPreviewResponse, GetProjectContentResponse,
            GetProjectResponse, GetProjectResponseData, GetProjectsResponse,
        },
    },
    response::{
        GenericErrorResponse, GenericResponse, GenericSuccessResponse, PresignedUrl,
        SuccessResponse,
    },
    sync_service::SyncServiceVersionID,
    user_document_view_location::UserDocumentViewLocation,
    version::DocumentStorageServiceApiVersion,
};
use models_permissions::share_permission::channel_share_permission::UpdateOperation;
use models_soup::call_record::{SoupCallRecord, SoupCallRecordParticipant};
use models_soup::chat::SoupChat;
use models_soup::document::SoupDocument;
use models_soup::email_thread::{
    SoupAttachment, SoupContact, SoupEmailThreadPreview, SoupEnrichedEmailThreadPreview, SoupLabel,
    SoupLabelListVisibility, SoupLabelType, SoupMessageListVisibility,
};
use models_soup::item::SoupItem;
use models_soup::project::SoupProject;
use soup::inbound::axum_router::{PostSoupRequest, SoupApiItem, SoupApiSort, SoupPage};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        terms_of_service = "https://macro.com/terms",
    ),
    paths(
        health::health_handler,

        // activity
        activity::get_recent_activity::get_recent_activity_handler,

        // annotations
        annotations::get::get_document_comments_handler,
        annotations::get::get_document_anchors_handler,
        annotations::delete_anchor::delete_anchor_handler,
        annotations::delete_comment::delete_comment_handler,
        annotations::edit_comment::edit_comment_handler,
        annotations::edit_anchor::edit_anchor_handler,
        annotations::create_anchor::create_anchor_handler,
        annotations::create_comment::create_comment_handler,

        // documents
        documents::get_user_documents::get_user_documents_handler,
        documents_hex::inbound::axum_router::get_document::get_document_handler,
        documents::get_document_version::handler,
        documents_hex::inbound::axum_router::create_document::create_document_handler,
        documents_hex::inbound::axum_router::create_markdown::create_markdown_handler,
        documents_hex::inbound::axum_router::copy_document::copy_document_handler,
        documents::save_document::save_document_handler,
        documents::pre_save::presave_document_handler,
        documents_hex::inbound::axum_router::edit_document::edit_document_handler,
        documents_hex::inbound::axum_router::delete_document::delete_document_handler,
        documents::delete_document::permanently_delete_document_handler,
        documents::get_document_list::get_document_list_handler,
        documents::get_document_permissions::get_document_permissions_handler_v2,
        documents::get_document_views::get_document_views_handler,
        documents::location::get_location_handler,
        documents_hex::inbound::axum_router::get_location::get_location_v3_handler,
        documents_hex::inbound::axum_router::get_branch_name::get_branch_name_handler,
        documents_hex::inbound::axum_router::get_github_pull_requests::get_github_pull_requests_handler,
        documents_hex::inbound::axum_router::get_short_id::get_short_id_handler,
        documents::simple_save::handler,
        documents::initialize_user_documents::handler,
        documents::get_batch_preview::get_batch_preview_handler,
        documents::permissions_token::create_permission_token::handler,
        documents::permissions_token::validate_permissions_token::handler,
        documents::revert_delete_document::handler,
        documents::export_document::handler,
        documents_hex::inbound::axum_router::create_task::create_task_handler,

        // instructions
        instructions::create_instructions::create_instructions_handler,
        instructions::get_instructions::get_instructions_handler,

        // user_document_view_location
        user_document_view_location::get_user_document_view_location::handler,
        user_document_view_location::upsert_user_document_view_location::handler,
        user_document_view_location::delete_user_document_view_location::handler,

        // processing
        documents::job_processing_result::job_processing_result_handler,
        documents::get_document_processing_result::handler,

        // history
        history::get_history::get_history_handler,
        history::upsert_history::upsert_history_handler,
        history::delete_history::delete_history_handler,

        // items
        soup::inbound::axum_router::get_soup_handler,
        soup::inbound::axum_router::post_soup_handler,
        soup::inbound::axum_router::post_soup_ast_handler,

        // channels
        channels::inbound::axum_router::create_channel_handler,
        channels::inbound::axum_router::get_or_create_dm_handler,
        channels::inbound::axum_router::get_or_create_private_handler,
        channels::inbound::axum_router::patch_channel_handler,
        channels::inbound::axum_router::delete_channel_handler,
        channels::inbound::axum_router::post_message_handler,
        channels::inbound::axum_router::patch_message_handler,
        channels::inbound::axum_router::delete_message_handler,
        channels::inbound::axum_router::post_reaction_handler,
        channels::inbound::axum_router::post_typing_handler,
        channels::inbound::axum_router::add_participants_handler,
        channels::inbound::axum_router::remove_participants_handler,
        channels::inbound::axum_router::join_channel_handler,
        channels::inbound::axum_router::leave_channel_handler,
        channels::inbound::axum_router::get_channel_messages_handler,
        channels::inbound::axum_router::post_channel_messages_handler,
        channels::inbound::axum_router::get_thread_replies_handler,
        channels::inbound::axum_router::get_message_with_context_handler,
        channels::inbound::axum_router::resolve_channel_message_handler,
        channels::inbound::axum_router::get_channel_attachments_handler,
        channels::inbound::axum_router::get_channel_participants_handler,

        // calls
        call::inbound::axum_router::get_or_create_call_handler,
        call::inbound::axum_router::check_active_call_handler,
        call::inbound::axum_router::leave_or_end_call_handler,
        call::inbound::axum_router::get_call_record_handler,
        call::inbound::axum_router::edit_call_record_handler,
        call::inbound::axum_router::edit_call_transcript_handler,
        call::inbound::axum_router::delete_call_record_handler,
        call::inbound::axum_router::toggle_share_with_team_handler,
        call::inbound::axum_router::get_batch_call_record_preview_handler,
        call::inbound::axum_router::webhook_handler,
        call::inbound::axum_router::transcript_handler,

        // pins
        pins::add_pin::add_pin_handler,
        pins::remove_pin::remove_pin_handler,
        pins::reorder_pins::reorder_pins_handler,
        pins::get_pins::get_pins_handler,

        // projects
        projects::get_projects::get_projects_handler,
        projects::get_projects::get_pending_projects_handler,
        projects::get_project::get_project_content_handler,
        projects::create_project::create_project_handler,
        projects::edit_project::edit_project_handler_v2,
        projects::delete_project::delete_project_handler,
        projects::delete_project::permanently_delete_project_handler,
        projects::upload_folder::upload_folder_handler,
        projects::upload_folder::upload_extract_folder_handler,
        projects::project_permission::get_project_permissions_handler,
        projects::project_permission::get_project_access_level_handler,
        projects::get_batch_preview::get_batch_preview_handler,
        projects::get_project::get_project_handler,
        projects::revert_delete_project::handler,

        entity::get_entity_permission::handler,

        // threads
        threads::edit_thread::edit_thread_handler,

        // /recents
        recents::recently_deleted::handler,
        saved_views::create_view_handler,
        saved_views::get_views_handler,
        saved_views::delete_view_handler,
        saved_views::patch_view_handler,
        saved_views::exclude_default_view_handler,

        // /github
        github::inbound::github_sync_router::install_sync_handler,

        // /internal/sync_service
        sync_service_hex::inbound::axum_router::bulk_wakeup_handler,

        // /crm
        crm::inbound::axum_router::set_email_sync::handler,
        crm::inbound::axum_router::set_company_hidden::handler,
        crm::inbound::axum_router::set_contact_hidden::handler,
    ),
    components(
        schemas(
            DocumentStorageServiceApiVersion,
            GenericResponse,
            GenericErrorResponse,
            GenericSuccessResponse,
            SuccessResponse,
            UpdateOperation,
            FileType, // Generic
            CloudStorageItemType,
            Item,
            ItemWithUserAccessLevel, // Generics
            BasicDocument,
            DocumentMetadata,
            BomPart,
            DocumentResponseMetadata, // Document components
            GetDocumentResponse,
            GetDocumentResponseData, // Get single document
            CreateDocumentRequest,
            CreateDocumentResponse,
            CreateDocumentResponseData, // Create document
            documents_hex::domain::models::CreateMarkdownDocumentRequest,
            documents_hex::domain::models::CreateMarkdownDocumentResponse,
            documents_hex::domain::models::CreateTaskRequest,
            documents_hex::domain::models::CreateTaskResponse,
            documents_hex::domain::models::PropertyInput,
            models_properties::api::requests::SetPropertyValue,
            models_properties::shared::EntityReference,
            models_properties::shared::EntityType, // Quick create task
            CreateBulkDocumentResponseData,
            CreateBulkDocumentResponse, // Create document bulk
            GetDocumentListResult,
            GetDocumentSearchResponse, // Search document
            documents_hex::domain::models::CopyDocumentRequest,
            documents_hex::domain::models::CopyDocumentQueryParams,
            documents_hex::domain::models::CopyDocumentResponse, // Copy document
            documents_hex::domain::models::EditDocumentServiceArgs,
            EditDocumentResponse, // Edit document
            UserDocumentsResponse,
            GetDocumentsResponse, // Get user documents
            GetDocumentProcessingResult,
            GetDocumentProcessingResultResponse, // Document processing result
            GetDocumentKeyResponseData,
            GetDocumentKeyResponse,
            SaveDocumentRequest,
            SaveBomPart,
            SaveDocumentResponse,
            SaveDocumentResponseData,
            PresignedUrl, // Save document
            PreSaveDocumentRequest,
            PreSaveDocumentResponseData,
            PreSaveDocumentResponse, // pre save
            GetActivitiesResponse,
            UserActivitiesResponse,
            Activity, // Get recent ativity
            PinnedItem,
            PinRequest, // Generic pins
            AddPinRequest, // Add pin
            UserPinsResponse,
            GetPinsResponse, // Get pins
            ReorderPinRequest, // Reorder pins
            GetUserHistoryResponse, // Get user history
            CreateInstructionsDocumentResponse, // Instructions
            GetInstructionsDocumentResponse,
            UserViewsResponse,
            LocationResponseData, // location
            GetDocumentUserAccessLevelResponse,
            DocumentPermissionsTokenResponse,
            DocumentPermissionsToken,
            DocumentPermissionsTokenRequest,
            ExportDocumentResponse,
            SyncServiceVersionID,
            SoupItem,
            SoupApiItem,
            SoupDocument,
            SoupChat,
            SoupProject,
            SoupApiSort,
            SoupPage,
            SoupEnrichedEmailThreadPreview,
            SoupEmailThreadPreview,
            SoupAttachment,
            SoupContact,
            SoupLabel,
            SoupLabelListVisibility,
            SoupMessageListVisibility,
            SoupLabelType,
            PostSoupRequest,

            // Channels
            ApiChannelMessagesPage,
            ApiChannelMessage,
            GetMessageWithContextResponse,
            ApiChannelContextMessage,
            ApiThreadInfo,
            ApiThreadReply,
            ApiChannelMessageKind,
            ApiResolvedChannelMessage,
            ApiCountedReaction,
            ApiMessageAttachment,
            ApiChannelAttachmentsPage,
            ApiChannelAttachment,
            ApiChannelParticipant,
            ApiParticipantRole,
            ChannelMessageFilters,
            channels::domain::models::ChannelType,
            channels::domain::models::GetOrCreateAction,
            channels::domain::models::TypingAction,
            channels::domain::models::ReactionAction,
            channels::domain::models::NewChannelAttachment,
            channels::domain::models::SimpleMention,
            channels::domain::models::CreateChannelRequest,
            channels::domain::models::CreateChannelResponse,
            channels::domain::models::GetOrCreateDmRequest,
            channels::domain::models::GetOrCreatePrivateRequest,
            channels::domain::models::GetOrCreateChannelResponse,
            channels::domain::models::PatchChannelRequest,
            channels::domain::models::PostMessageRequest,
            channels::domain::models::PostMessageResponse,
            channels::domain::models::PatchMessageRequest,
            channels::domain::models::DeleteMessageQuery,
            channels::domain::models::PostReactionRequest,
            channels::domain::models::PostTypingRequest,
            channels::domain::models::AddParticipantsRequest,
            channels::domain::models::RemoveParticipantsRequest,

            // Calls
            call::domain::models::CallTokenResponse,
            call::domain::models::CallActiveResponse,
            call::domain::models::LeaveCallResponse,
            call::domain::models::TranscriptSegmentRequest,
            call::domain::models::CallRecord,
            call::domain::models::CallRecordParticipant,
            call::domain::models::CallRecordTranscriptSegment,
            call::domain::models::EditCallRecordRequest,
            call::domain::models::EditCallTranscriptRequest,
            call::domain::models::CustomSpeakerAssignment,
            call::domain::models::CallRecordPreview,
            call::domain::models::CallRecordPreviewData,
            call::domain::models::WithCallId,
            call::domain::models::GetBatchCallRecordPreviewRequest,
            call::domain::models::GetBatchCallRecordPreviewResponse,
            SoupCallRecord,
            SoupCallRecordParticipant,

            DocumentSubType,


            // Permissions V2
            models_permissions::share_permission::access_level::AccessLevel,
            models_permissions::share_permission::SharePermissionV2,
            models_permissions::share_permission::UpdateSharePermissionRequestV2, // Share permission
            models_permissions::share_permission::channel_share_permission::ChannelSharePermission,
            models_permissions::share_permission::channel_share_permission::UpdateChannelSharePermission, // Channel share permissions
            entity::get_entity_permission::EntityPermissionResponse,
            entity_access::domain::models::EntityPermission,
            entity_access::domain::models::ParticipantRole,

            // Chat
            Chat,

            // Projects
            Project,
            GetProjectsResponse,
            GetProjectContentResponse,
            CreateProjectRequest,
            CreateProjectResponse,
            PatchProjectRequestV2,
            GetProjectResponse,
            GetProjectResponseData,
            ProjectDeleteResponseData,
            ProjectDeleteResponse,

            // Preview
            GetDocumentPermissionsResponseDataV2,
            GetBatchPreviewRequest,
            GetBatchPreviewResponse,
            GetBatchProjectPreviewRequest,
            GetBatchProjectPreviewResponse,
            UserDocumentViewLocation,
            UpsertUserDocumentViewLocationRequest,
            UserDocumentViewLocationResponse,

            // Annotations
            AnnotationIncrementalUpdate,

            // Recents
            RecentlyDeletedResponseData,
            RecentlyDeletedResponse,

            View,
            ExcludedDefaultView,
            ViewPatch,

            CreateViewRequest,
            ExcludeDefaultViewRequest,
            BranchNameResponse,
            ShortIdResponse,
            documents_hex::domain::models::GithubPullRequest,
            documents_hex::domain::models::GithubPullRequestsResponse,

            // Sync service
            sync_service_hex::domain::models::BulkWakeupRequest,
            sync_service_hex::domain::models::BulkWakeupResponse,

            // CRM
            crm::inbound::axum_router::set_email_sync::SetEmailSyncRequest,
            crm::inbound::axum_router::set_company_hidden::SetCompanyHiddenRequest,
            crm::inbound::axum_router::set_contact_hidden::SetContactHiddenRequest,
        ),
    ),
    tags(
            (name = "macro cloud storage service", description = "Macro Cloud Storage Service")
    )
)]
pub struct ApiDoc;
