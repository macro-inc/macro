#[cfg(feature = "attachment")]
pub mod attachment;

#[cfg(feature = "axum")]
mod axum;

#[cfg(feature = "axum")]
pub use axum::{
    __path_create_draft_handler, __path_cursor_handler, __path_delete_email_filter_handler,
    __path_get_thread_handler, __path_list_email_filters_handler, __path_list_labels_handler,
    __path_send_message_handler, __path_update_thread_labels_handler,
    __path_update_thread_project_handler, __path_upsert_email_filter_handler, ApiAttachment,
    ApiAttachmentDraft, ApiAttachmentForwarded, ApiContact, ApiContactInfo, ApiDraftContactInfo,
    ApiDraftInput, ApiDraftOutput, ApiEmailFilter, ApiLabel, ApiLabelListVisibility, ApiLabelType,
    ApiMessage, ApiMessageAttachment, ApiMessageLabel, ApiMessageListVisibility,
    ApiPaginatedThreadCursor, ApiRecipientType, ApiSortMethod, ApiThread,
    ApiThreadPreviewCursorInner, CreateDraftError, CreateDraftRequest, CreateDraftResponse,
    EmailFilterError, EmailLinkErr, EmailLinkExtractor, EmailRouterState, EmailThreadRouterState,
    GetPreviewsCursorError, GetPreviewsCursorParams, GetThreadError, GetThreadParams,
    GetThreadResponse, GmailAccessTokenErr, GmailAccessTokenExtractor, GmailTokenState,
    ListEmailFiltersResponse, ListLabelsError, ListLabelsResponse, OptionalEmailLinkExtractor,
    SendMessageError, SendMessageRequest, SendMessageResponse, UpdateThreadLabelError,
    UpdateThreadLabelRequest, UpdateThreadLabelsResponse, UpdateThreadProjectError,
    UpdateThreadProjectRequest, UpdateThreadProjectResponse, UpsertEmailFilterRequest,
    UpsertEmailFilterResponse, create_draft_handler, delete_email_filter_handler, draft_router,
    email_filter_router, get_thread_handler, list_email_filters_handler, list_labels_handler,
    list_labels_router, router, send_message_handler, send_router, thread_labels_router,
    thread_project_router, thread_router, update_thread_labels_handler,
    update_thread_project_handler, upsert_email_filter_handler,
};
#[cfg(feature = "ai_tools")]
pub mod toolset;
