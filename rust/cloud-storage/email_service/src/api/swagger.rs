use crate::api::email::attachments::get::GetAttachmentResponse;
use crate::api::email::attachments::get_document_id::GetAttachmentDocumentIDResponse;
use crate::api::email::backfill::cancel::CancelBackfillParams;
use crate::api::email::backfill::get::{GetActiveBackfillJobResponse, GetBackfillJobResponse};
use crate::api::email::contacts::block_sender::{BlockSenderRequest, BlockSenderResponse};
use crate::api::email::contacts::list::ListContactsResponse;
use crate::api::email::contacts::list_blocked::ListBlockedResponse;
use crate::api::email::contacts::unblock_sender::UnblockSenderRequest;
use crate::api::email::drafts::add_attachment::{
    AddDraftAttachmentRequest, AddDraftAttachmentResponse,
};
use crate::api::email::drafts::add_forwarded_attachment::{
    AddForwardedAttachmentRequest, AddForwardedAttachmentResponse,
};
use crate::api::email::init::InitResponse;
use crate::api::email::labels::create::CreateLabelRequest;
use crate::api::email::labels::create::CreateLabelResponse;
use crate::api::email::links::list::ListLinksResponse;
use crate::api::email::messages::labels::{UpdateLabelBatchRequest, UpdateLabelBatchResponse};
use crate::api::email::settings::patch::{PatchSettingsRequest, PatchSettingsResponse};
use crate::api::email::threads::archived::ArchiveThreadRequest;
use crate::api::{email, health};
use ::email::inbound;
use ::email::inbound::ListLabelsResponse as HexListLabelsResponse;
use ::email::inbound::{
    ApiDraftContactInfo, ApiDraftInput, ApiDraftOutput, ApiPaginatedThreadCursor, ApiSortMethod,
    ApiThread, CreateDraftRequest as HexCreateDraftRequest,
    CreateDraftResponse as HexCreateDraftResponse, GetPreviewsCursorParams, GetThreadResponse,
    SendMessageRequest as HexSendMessageRequest, SendMessageResponse as HexSendMessageResponse,
};
use ::email::inbound::{
    ApiEmailFilter, ListEmailFiltersResponse, UpdateThreadLabelRequest, UpdateThreadLabelsResponse,
    UpdateThreadProjectRequest, UpdateThreadProjectResponse, UpsertEmailFilterRequest,
    UpsertEmailFilterResponse,
};
use model::response::EmptyResponse;
use models_email::api::settings::Settings;
use models_email::email::service;
use models_email::email::service::address::ContactInfoWithInteraction;
use models_email::email::service::backfill::BackfillJob;
use models_email::email::service::link::Link;
use models_email::email::service::thread::{PreviewView, PreviewViewStandardLabel};
use models_email::service::label::Label;
use models_email::service::message::ParsedMessage;
use models_email::service::thread::ThreadPreviewCursor;
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        terms_of_service = "https://macro.com/terms",
    ),
    paths(
        health::health_handler,
        email::attachments::get::handler,
        email::attachments::get_document_id::handler,
        email::backfill::cancel::handler,
        email::backfill::get::handler,
        email::backfill::get::active_handler,
        email::init::handler,
        inbound::create_draft_handler,
        email::drafts::delete::handler,
        email::drafts::scheduled::list::handler,
        email::drafts::scheduled::remove::handler,
        email::drafts::scheduled::upsert::handler,
        email::drafts::add_attachment::handler,
        email::drafts::remove_attachment::handler,
        email::drafts::add_forwarded_attachment::handler,
        email::drafts::remove_forwarded_attachment::handler,
        email::messages::get::handler,
        email::messages::get::batch_handler,
        email::messages::labels::handler,
        inbound::send_message_handler,
        email::threads::seen::seen_handler,
        email::threads::get::get_thread_messages_handler,
        email::threads::archived::archived_handler,
        inbound::update_thread_labels_handler,
        inbound::cursor_handler,
        inbound::get_thread_handler,
        inbound::update_thread_project_handler,
        email::links::list::list_links_handler,
        email::labels::create::handler,
        email::labels::delete::handler,
        inbound::list_labels_handler,
        inbound::upsert_email_filter_handler,
        inbound::delete_email_filter_handler,
        inbound::list_email_filters_handler,
        email::contacts::list::list_contacts_handler,
        email::contacts::block_sender::handler,
        email::contacts::unblock_sender::handler,
        email::contacts::list_blocked::handler,
        email::sync::disable::disable_handler,
        email::settings::patch::patch_settings_handler,
    ),
    components(
        schemas(
            EmptyResponse,
            // Backfill types
            CancelBackfillParams,
            GetBackfillJobResponse,
            GetActiveBackfillJobResponse,
            BackfillJob,
            // Draft types
            HexCreateDraftRequest,
            HexCreateDraftResponse,
            ApiDraftInput,
            ApiDraftOutput,
            ApiDraftContactInfo,
            AddDraftAttachmentRequest,
            AddDraftAttachmentResponse,
            AddForwardedAttachmentRequest,
            AddForwardedAttachmentResponse,
            // Init types
            InitResponse,
            // Label types
            CreateLabelRequest,
            CreateLabelResponse,
            HexListLabelsResponse,
            Label,
            // Message types
            UpdateLabelBatchRequest,
            UpdateLabelBatchResponse,
            HexSendMessageRequest,
            HexSendMessageResponse,
            ParsedMessage,
            // Thread types
            ArchiveThreadRequest,
            UpdateThreadLabelRequest,
            UpdateThreadLabelsResponse,
            UpdateThreadProjectRequest,
            UpdateThreadProjectResponse,
            ThreadPreviewCursor,
            GetThreadResponse,
            ApiThread,
            // Preview types
            GetPreviewsCursorParams,
            ApiPaginatedThreadCursor,
            PreviewView,
            PreviewViewStandardLabel,
            // Attachment types
            GetAttachmentResponse,
            GetAttachmentDocumentIDResponse,
            // Link types
            ListLinksResponse,
            Link,
            Settings,
            // Contact types
            ListContactsResponse,
            ContactInfoWithInteraction,
            BlockSenderRequest,
            BlockSenderResponse,
            UnblockSenderRequest,
            ListBlockedResponse,
            // Email filter types
            UpsertEmailFilterRequest,
            UpsertEmailFilterResponse,
            ListEmailFiltersResponse,
            ApiEmailFilter,
            // Sort/filter types
            ApiSortMethod,
            // Legacy service types (keeping for backward compatibility)
            service::thread::ThreadList,
            service::address::ContactInfo,
            service::label::LabelInfo,
            service::attachment::Attachment,
            service::thread::Thread,
            service::message::Message,
            PatchSettingsRequest,
            PatchSettingsResponse
        ),
    ),
    tags(
            (name = "Email Service", description = "Macro Email Service")
    )
)]
pub struct ApiDoc;
