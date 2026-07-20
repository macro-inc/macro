use super::{
    context::ApiContext,
    documents::{export_document, get_document_version},
    history::upsert_history,
};
use super::{documents::get_document_access_level, user::delete_user_items};
use super::{documents::save_document, history::delete_history};
use super::{
    documents::{
        get_document, get_document_key, get_document_permissions, get_document_text,
        get_full_pdf_modification_data, initialize_how_to_guide, list_documents_with_access,
        location, put_document_update,
    },
    user::populate_items,
};
use crate::api::context::{
    AuthorizationService, DocumentService, EntityAccessService, ProjectService,
};
use crate::api::items::get_item_ids;
use crate::api::threads::get_thread_access_level;
use crate::api::{documents::get_documents_metadata, items::validate_item_ids};
use axum::{
    Router,
    routing::{delete, get, post, put},
};
use macro_authorization::InternalMacroAuthorizationExtractor;
use macro_middleware::cloud_storage::{
    document::ensure_document_exists, thread::ensure_thread_exists,
};

mod associate_github_installations;

/// Internal routes authenticate through extractors on each handler.
/// These routes are not part of the public Swagger documentation.
pub fn router(state: ApiContext) -> Router<ApiContext> {
    let ensure_document_exists_middleware =
        axum::middleware::from_fn_with_state(state.clone(), ensure_document_exists::handler);

    Router::new()
        // User routes
        .route(
            "/users/{user_id}",
            delete(delete_user_items::delete_user_items_handler),
        )
        // Document routes
        .route(
            "/documents/{document_id}",
            get(
                documents_hex::inbound::axum_router::get_document::get_document_handler::<
                    DocumentService,
                    EntityAccessService,
                    AuthorizationService,
                >,
            ),
        )
        .route(
            "/documents/{document_id}/basic",
            get(get_document::get_document_basic_handler)
                .layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/documents/{document_id}/export",
            get(export_document::handler),
        )
        .route(
            "/documents/{document_id}/text",
            get(get_document_text::handler),
        )
        .route(
            "/documents/{document_id}/full_pdf_modification_data",
            get(get_full_pdf_modification_data::handler),
        )
        .route(
            "/documents/{document_id}/location",
            get(location::get_location_handler),
        )
        .route(
            "/documents/{document_id}/location_v3",
            get(
                documents_hex::inbound::axum_router::get_location::get_location_v3_handler::<
                    DocumentService,
                    EntityAccessService,
                    AuthorizationService,
                >,
            ),
        )
        .route(
            "/documents/{document_id}/permissions",
            get(get_document_permissions::get_document_permissions_handler),
        )
        .route(
            "/documents/{document_id}/access_level",
            get(get_document_access_level::handler),
        )
        .route(
            "/documents",
            post(
                documents_hex::inbound::axum_router::create_document::create_document_handler::<
                    DocumentService,
                    EntityAccessService,
                    AuthorizationService,
                >,
            ),
        )
        .route(
            "/documents/initialize_how_to_guide",
            post(initialize_how_to_guide::handler),
        )
        .route(
            "/documents/list_with_access",
            get(list_documents_with_access::list_documents_with_access_handler),
        )
        .route(
            "/documents/{document_id}",
            put(save_document::save_document_handler),
        )
        .route(
            "/documents/{document_id}/{document_version_id}",
            get(get_document_version::handler),
        )
        .route(
            "/documents/{document_id}/{document_version_id}/key",
            get(get_document_key::get_document_key_handler),
        )
        .route(
            "/documents/{document_id}/update",
            put(put_document_update::handler),
        )
        .route(
            "/documents/{document_id}/snapshot",
            put(
                documents_hex::inbound::axum_router::put_snapshot::put_snapshot_handler::<
                    DocumentService,
                    EntityAccessService,
                    AuthorizationService,
                >,
            ),
        )
        .route("/documents/metadata", post(get_documents_metadata::handler))
        // History routes
        .route(
            "/history/{item_type}/{item_id}",
            post(upsert_history::upsert_history_handler),
        )
        .route(
            "/history/{item_type}/{item_id}",
            delete(delete_history::delete_history_handler),
        )
        .route(
            "/threads/{thread_id}/access_level",
            get(get_thread_access_level::handler).layer(axum::middleware::from_fn_with_state(
                state.clone(),
                ensure_thread_exists::handler,
            )),
        )
        .route(
            "/users/populate_items",
            post(populate_items::populate_items_handler),
        )
        // Project routes
        .route(
            "/projects/upload",
            post(
                projects_hex::inbound::axum_router::upload_folder::upload_folder_handler::<
                    ProjectService,
                    EntityAccessService,
                    AuthorizationService,
                >,
            ),
        )
        .route(
            "/projects/mark_uploaded",
            post(
                projects_hex::inbound::axum_router::upload_folder::mark_uploaded_handler::<
                    ProjectService,
                    EntityAccessService,
                    AuthorizationService,
                >,
            ),
        )
        .route("/item_ids", get(get_item_ids::get_item_ids_handler))
        .route("/validate_item_ids", post(validate_item_ids::handler))
        // Github routes
        .route(
            "/github/installations/{github_user_id}/associate",
            post(associate_github_installations::associate_github_installations_handler),
        )
        .route("/health", get(health_handler))
}

async fn health_handler(
    _auth: InternalMacroAuthorizationExtractor<AuthorizationService>,
) -> &'static str {
    "healthy"
}
