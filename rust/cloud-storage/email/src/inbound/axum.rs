mod api_types;
mod axum_impls;
mod draft_router;
mod email_filter_router;
mod get_thread_router;
mod list_labels_router;
mod previews_router;
mod send_router;
mod thread_labels_router;
mod thread_project_router;

pub use api_types::{
    ApiAttachment, ApiAttachmentDraft, ApiAttachmentForwarded, ApiContact, ApiContactInfo,
    ApiDraftContactInfo, ApiDraftInput, ApiDraftOutput, ApiLabel, ApiLabelListVisibility,
    ApiLabelType, ApiMessage, ApiMessageAttachment, ApiMessageLabel, ApiMessageListVisibility,
    ApiPaginatedThreadCursor, ApiRecipientType, ApiSortMethod, ApiThread,
    ApiThreadPreviewCursorInner, CreateDraftRequest, CreateDraftResponse, GetThreadParams,
    GetThreadResponse, SendMessageRequest, SendMessageResponse,
};
pub use axum_impls::{
    EmailLinkErr, EmailLinkExtractor, GetPreviewsCursorError, GetPreviewsCursorParams,
    GmailAccessTokenErr, GmailAccessTokenExtractor, GmailTokenState, OptionalEmailLinkExtractor,
};
pub use draft_router::{
    __path_create_draft_handler, CreateDraftError, create_draft_handler, draft_router,
};
pub use email_filter_router::{
    __path_delete_email_filter_handler, __path_list_email_filters_handler,
    __path_upsert_email_filter_handler, ApiEmailFilter, EmailFilterError, ListEmailFiltersResponse,
    UpsertEmailFilterRequest, UpsertEmailFilterResponse, delete_email_filter_handler,
    email_filter_router, list_email_filters_handler, upsert_email_filter_handler,
};
pub use get_thread_router::{
    __path_get_thread_handler, EmailThreadRouterState, GetThreadError, get_thread_handler,
    thread_router,
};
pub use list_labels_router::{
    __path_list_labels_handler, ListLabelsError, ListLabelsResponse, list_labels_handler,
    list_labels_router,
};
pub use previews_router::{__path_cursor_handler, EmailRouterState, router};
pub use send_router::{
    __path_send_message_handler, SendMessageError, send_message_handler, send_router,
};
pub use thread_labels_router::{
    __path_update_thread_labels_handler, UpdateThreadLabelError, UpdateThreadLabelRequest,
    UpdateThreadLabelsResponse, thread_labels_router, update_thread_labels_handler,
};
pub use thread_project_router::{
    __path_update_thread_project_handler, UpdateThreadProjectError, UpdateThreadProjectRequest,
    UpdateThreadProjectResponse, thread_project_router, update_thread_project_handler,
};
