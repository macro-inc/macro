use crate::api::email::attachments::get::GetAttachmentResponse;
use crate::api::email::contacts::list::ListContactsResponse;
use crate::api::email::labels::create::CreateLabelRequest;
use crate::api::email::labels::create::CreateLabelResponse;
use crate::api::email::labels::list::ListLabelsResponse;
use crate::api::email::links::list::ListLinksResponse;
use crate::api::email::threads::get::GetThreadResponse;
use crate::api::email::threads::previews::cursor::GetPreviewsFrecencyResponse;
use crate::api::{email, health};
use model::response::EmptyResponse;
use models_email::email::service;
use models_email::email::service::thread::{
    GetPreviewsCursorResponse, PreviewView, PreviewViewStandardLabel,
};
use models_email::service::thread::ApiSortMethod;
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
        email::threads::previews::cursor::previews_handler,
        email::links::list::list_links_handler,
        email::labels::create::handler,
        email::labels::delete::handler,
        email::labels::list::handler,
        email::contacts::list::list_contacts_handler,
        email::sync::enable::enable_handler,
        email::sync::disable::disable_handler,
    ),
    components(
        schemas(
            EmptyResponse,
            CreateLabelRequest,
            CreateLabelResponse,
            ListLabelsResponse,
            GetThreadResponse,
            GetPreviewsCursorResponse,
            GetPreviewsFrecencyResponse,
            GetAttachmentResponse,
            ListLinksResponse,
            ListContactsResponse,
            ApiSortMethod,
            PreviewViewStandardLabel,
            PreviewView,
            service::thread::ThreadList,
            service::address::ContactInfo,
            service::label::LabelInfo,
            service::attachment::Attachment,
            service::thread::Thread,
            service::message::Message
        ),
    ),
    tags(
            (name = "Email Service", description = "Macro Email Service")
    )
)]
pub struct ApiDoc;
