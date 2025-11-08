pub mod chat_history;
pub mod chat_history_batch_messages;
pub mod count_tokens;
pub mod extract_text_from_all_documents;
pub mod re_extract_document;
use crate::api::{
    context::ApiContext,
    internal::{
        chat_history::get_chat_history_handler,
        chat_history_batch_messages::get_chat_history_batch_messages_handler,
        extract_text_from_all_documents::extract_text_from_all_documents_handler,
    },
};
use axum::{
    Router,
    routing::{get, post},
};
use macro_middleware::auth::internal_access::ValidInternalKey;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route("/history/:chat_id", get(get_chat_history_handler))
        .route(
            "/history_batch_messages",
            post(get_chat_history_batch_messages_handler),
        )
        .route(
            "/extract_text_from_all_documents",
            post(extract_text_from_all_documents_handler),
        )
        .route(
            "/re_extract_document/:document_id",
            post(re_extract_document::re_extract_document),
        )
        .route(
            "/recount_documents_with_no_tokens",
            post(count_tokens::count_tokens_handler),
        )
        .layer(axum::middleware::from_extractor_with_state::<
            ValidInternalKey,
            _,
        >(state))
}
