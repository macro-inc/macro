use super::{context::ApiContext, middleware};
use axum::{
    Router,
    routing::{delete, get, patch, post, put},
};
use tower::ServiceBuilder;

// needs to be public in api crate for swagger
pub(in crate::api) mod copy_document;
pub(in crate::api) mod create_document;
pub(in crate::api) mod delete_document;
pub(in crate::api) mod edit_document;
pub(in crate::api) mod export_document;
pub(in crate::api) mod get_batch_preview;
pub(in crate::api) mod get_document;
pub(in crate::api) mod get_document_access_level;
pub(in crate::api) mod get_document_key;
pub(in crate::api) mod get_document_list;
pub(in crate::api) mod get_document_permissions;
pub(in crate::api) mod get_document_processing_result;
pub(in crate::api) mod get_document_text;
pub(in crate::api) mod get_document_version;
pub(in crate::api) mod get_document_views;
pub(in crate::api) mod get_documents_metadata;
pub(in crate::api) mod get_full_pdf_modification_data;
pub(in crate::api) mod get_user_documents;
pub(in crate::api) mod initialize_user_documents;
pub(in crate::api) mod job_processing_result;
pub(in crate::api) mod list_documents_with_access;
pub(in crate::api) mod location;
pub(in crate::api) mod permissions_token;
pub(in crate::api) mod pre_save;
pub(in crate::api) mod put_document_update;
pub(in crate::api) mod revert_delete_document;
pub(in crate::api) mod save_document;
pub(in crate::api) mod simple_save;

mod utils;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    let ensure_document_exists_middleware = axum::middleware::from_fn_with_state(
        state.clone(),
        macro_middleware::cloud_storage::document::ensure_document_exists::handler,
    );

    Router::new()
        .nest(
            "/permissions_token",
            permissions_token::router(state.clone()),
        )
        .route(
            "/",
            get(get_user_documents::get_user_documents_handler).layer(axum::middleware::from_fn(
                macro_middleware::auth::ensure_user_exists::handler,
            )),
        )
        .route(
            "/",
            post(create_document::create_document_handler).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(
                        macro_middleware::auth::ensure_user_exists::handler,
                    ))
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        macro_middleware::user_permissions::attach_user_permissions::handler,
                    ))
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        macro_middleware::user_permissions::validate_user_quota::document_handler,
                    )),
            ),
        )
        .route(
            "/initialize_user_documents",
            post(initialize_user_documents::handler).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(
                        macro_middleware::auth::ensure_user_exists::handler,
                    ))
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        middleware::ensure_user_is_onboarded::handler,
                    )),
            ),
        )
        .route(
            "/list",
            get(get_document_list::get_document_list_handler).layer(axum::middleware::from_fn(
                macro_middleware::auth::ensure_user_exists::handler,
            )),
        )
        .route(
            "/:document_id/permissions",
            get(get_document_permissions::get_document_permissions_handler)
                .layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/:document_id/location",
            get(location::get_location_handler).layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/:document_id/location_v3",
            get(location::get_location_handler_v3).layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/:document_id/text",
            get(get_document_text::handler).layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/:document_id/:document_version_id/key",
            get(get_document_key::get_document_key_handler)
                .layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/:document_id/copy",
            post(copy_document::copy_document_handler).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(
                        macro_middleware::auth::ensure_user_exists::handler,
                    ))
                    .layer(ensure_document_exists_middleware.clone())
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        macro_middleware::user_permissions::attach_user_permissions::handler,
                    ))
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        macro_middleware::user_permissions::validate_user_quota::document_handler,
                    )),
            ),
        )
        .route(
            "/:document_id",
            get(get_document::handler).layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/:document_id/views",
            get(get_document_views::get_document_views_handler)
                .layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/:document_id/export",
            get(export_document::handler).layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/:document_id/:document_version_id",
            get(get_document_version::handler).layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/:document_id",
            patch(edit_document::edit_document_handler)
                .layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/:document_id",
            put(save_document::save_document_handler)
                .layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/presave/:document_id",
            #[allow(deprecated, reason = "allow presave_document_handler")]
            put(pre_save::presave_document_handler)
                .layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/:document_id/simple_save",
            put(simple_save::handler).layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/:document_id",
            delete(delete_document::delete_document_handler)
                .layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/:document_id/permanent",
            delete(delete_document::permanently_delete_document_handler)
                .layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/:document_id/revert_delete",
            put(revert_delete_document::handler).layer(ensure_document_exists_middleware.clone()),
        )
        .route(
            "/:document_id/processing",
            get(get_document_processing_result::handler).layer(ensure_document_exists_middleware),
        )
        .with_state(state)
        .route(
            "/:document_id/processing/:job_id",
            get(job_processing_result::job_processing_result_handler),
        )
        .route(
            "/preview",
            post(get_batch_preview::get_batch_preview_handler),
        )
}
