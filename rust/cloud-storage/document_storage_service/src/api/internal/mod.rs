use super::{
    channel,
    context::ApiContext,
    documents::{export_document, get_document_version},
    history::upsert_history,
    permissions,
    projects::upload_folder,
};
use super::{documents::save_document, history::delete_history};
use super::{
    documents::{create_document, get_document_access_level},
    user::delete_user_items,
};
use super::{
    documents::{
        get_document, get_document_key, get_document_permissions, get_document_text,
        get_full_pdf_modification_data, list_documents_with_access, location, put_document_update,
    },
    user::populate_items,
};
use crate::api::documents::delete_document;
use crate::api::items::get_item_ids;
use crate::api::threads::get_thread_access_level;
use crate::api::{documents::get_documents_metadata, items::validate_item_ids};
use axum::{
    Router,
    routing::{delete, get, post, put},
};
use macro_middleware::{
    auth::ensure_user_exists,
    cloud_storage::{document::ensure_document_exists, thread::ensure_thread_exists},
};

/// Internal routes. All routes are authenticated via the internal_access middleware
/// These routes are not part of the public Swagger documentation and should never be
pub fn router(state: ApiContext) -> Router<ApiContext> {
    let ensure_document_exists_middleware =
        axum::middleware::from_fn_with_state(state.clone(), ensure_document_exists::handler);

    let ensure_user_exists_middleware =
        axum::middleware::from_fn_with_state(state.clone(), ensure_user_exists::handler);

    Router::new()
        // Channel routes
        .route(
            "/channel/update_share_permission",
            post(channel::update_channel_share_permission::handler),
        )
        // User routes
        .route(
            "/channel/update_user_channel_permissions",
            post(permissions::update_user_channel_permissions::handler),
        )
        .route(
            "/users/:user_id",
            delete(delete_user_items::delete_user_items_handler),
        )
        // Document routes
        .route(
            "/documents/:document_id",
            get(get_document::handler).layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/documents/:document_id/basic",
            get(get_document::get_document_basic_handler)
                .layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/documents/:document_id/export",
            get(export_document::handler).layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/documents/:document_id/text",
            get(get_document_text::handler).layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/documents/:document_id/full_pdf_modification_data",
            get(get_full_pdf_modification_data::handler)
                .layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/documents/:document_id/location",
            get(location::get_location_handler).layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/documents/:document_id/location_v3",
            get(location::get_location_handler_v3).layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/documents/:document_id/permissions",
            get(get_document_permissions::get_document_permissions_handler),
        )
        .route(
            "/documents/:document_id/access_level",
            get(get_document_access_level::handler),
        )
        .route("/documents", post(create_document::create_document_handler))
        .route(
            "/documents/list_with_access",
            get(list_documents_with_access::list_documents_with_access_handler),
        )
        .route(
            "/documents/:document_id",
            put(save_document::save_document_handler)
                .layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/documents/:document_id/:document_version_id",
            get(get_document_version::handler),
        )
        .route(
            "/documents/:document_id/:document_version_id/key",
            get(get_document_key::get_document_key_handler)
                .layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/documents/:document_id/update",
            put(put_document_update::handler),
        )
        .route(
            "/documents/:document_id/permanent",
            delete(delete_document::permanently_delete_document_handler)
                .layer(ensure_document_exists_middleware.clone()),
        )
        .route("/documents/metadata", post(get_documents_metadata::handler))
        // History routes
        .route(
            "/history/:item_type/:item_id",
            post(upsert_history::upsert_history_handler)
                .layer(ensure_user_exists_middleware.clone()),
        )
        .route(
            "/history/:item_type/:item_id",
            delete(delete_history::delete_history_handler)
                .layer(ensure_user_exists_middleware.clone()),
        )
        .route(
            "/threads/:thread_id/access_level",
            get(get_thread_access_level::handler).layer(axum::middleware::from_fn_with_state(
                state.clone(),
                ensure_thread_exists::handler,
            )),
        )
        .route(
            "/users/populate_items",
            post(populate_items::populate_items_handler)
                .layer(ensure_user_exists_middleware.clone()),
        )
        // Project routes
        .route(
            "/projects/upload",
            post(upload_folder::upload_folder_handler),
        )
        .route(
            "/projects/mark_uploaded",
            post(upload_folder::mark_uploaded_handler),
        )
        .route(
            "/item_ids",
            get(get_item_ids::get_item_ids_handler).layer(ensure_user_exists_middleware.clone()),
        )
        .route(
            "/validate_item_ids",
            post(validate_item_ids::handler).layer(ensure_user_exists_middleware),
        )
        .route("/health", get(async move || "healthy"))
}
