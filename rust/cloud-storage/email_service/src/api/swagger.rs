use crate::api::email::attachments::get::GetAttachmentResponse;
use crate::api::email::backfill::cancel::CancelBackfillParams;
use crate::api::email::backfill::get::{GetActiveBackfillJobResponse, GetBackfillJobResponse};
use crate::api::email::contacts::list::ListContactsResponse;
use crate::api::email::drafts::create::{CreateDraftRequest, CreateDraftResponse};
use crate::api::email::init::InitResponse;
use crate::api::email::labels::create::CreateLabelRequest;
use crate::api::email::labels::create::CreateLabelResponse;
use crate::api::email::labels::list::ListLabelsResponse;
use crate::api::email::links::list::ListLinksResponse;
use crate::api::email::messages::labels::{UpdateLabelBatchRequest, UpdateLabelBatchResponse};
use crate::api::email::messages::send::{SendMessageRequest, SendMessageResponse};
use crate::api::email::settings::patch::{PatchSettingsRequest, PatchSettingsResponse};
use crate::api::email::threads::archived::ArchiveThreadRequest;
use crate::api::email::threads::get::GetThreadResponse;
use crate::api::{email, health};
use ::email::inbound;
use ::email::inbound::{ApiPaginatedThreadCursor, ApiSortMethod, GetPreviewsCursorParams};
use model::response::EmptyResponse;
use models_email::api::settings::Settings;
use models_email::email::service;
use models_email::email::service::address::ContactInfoWithInteraction;
use models_email::email::service::backfill::BackfillJob;
use models_email::email::service::link::Link;
use models_email::email::service::thread::{PreviewView, PreviewViewStandardLabel};
use models_email::service::label::Label;
use models_email::service::message::{MessageToSend, ParsedMessage};
use models_email::service::thread::{APIThread, ThreadPreviewCursor};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        terms_of_service = "https://macro.com/terms",
    ),
    paths(
        health::health_handler,
        email::attachments::get::handler,
        email::backfill::cancel::handler,
        email::backfill::get::handler,
        email::backfill::get::active_handler,
        email::init::handler,
        email::drafts::create::handler,
        email::drafts::delete::handler,
        email::messages::get::handler,
        email::messages::get::batch_handler,
        email::messages::labels::handler,
        email::messages::send::send_handler,
        email::threads::seen::seen_handler,
        email::threads::get::get_thread_handler,
        email::threads::get::get_thread_messages_handler,
        email::threads::archived::archived_handler,
        inbound::cursor_handler,
        email::links::list::list_links_handler,
        email::labels::create::handler,
        email::labels::delete::handler,
        email::labels::list::handler,
        email::contacts::list::list_contacts_handler,
        email::sync::enable::enable_handler,
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
            CreateDraftRequest,
            CreateDraftResponse,
            // Init types
            InitResponse,
            // Label types
            CreateLabelRequest,
            CreateLabelResponse,
            ListLabelsResponse,
            Label,
            // Message types
            UpdateLabelBatchRequest,
            UpdateLabelBatchResponse,
            SendMessageRequest,
            SendMessageResponse,
            ParsedMessage,
            MessageToSend,
            // Thread types
            GetThreadResponse,
            ArchiveThreadRequest,
            APIThread,
            ThreadPreviewCursor,
            // Preview types
            GetPreviewsCursorParams,
            ApiPaginatedThreadCursor,
            PreviewView,
            PreviewViewStandardLabel,
            // Attachment types
            GetAttachmentResponse,
            // Link types
            ListLinksResponse,
            Link,
            Settings,
            // Contact types
            ListContactsResponse,
            ContactInfoWithInteraction,
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
