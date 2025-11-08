pub(crate) mod cursor;

use axum::Router;
use axum::routing::get;
use models_email::service::thread::GetPreviewsCursorParams;
use models_pagination::SimpleSortMethod;

use crate::api::ApiContext;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new().route(
        "/cursor/:view",
        get(cursor::previews_handler).layer(axum::middleware::from_fn_with_state(
            state,
            crate::api::middleware::link::attach_link_context,
        )),
    )
}

/// The default number of previews to return
const DEFAULT_PREVIEW_LIMIT: u32 = 20;
/// The max number of previews that can be returned in a response
const PREVIEW_MAX: u32 = 500;

#[derive(Debug, Clone)]
struct GetPreviewsPaginationCursorParams {
    limit: u32,
    sort_method: SimpleSortMethod,
}

impl GetPreviewsPaginationCursorParams {
    /// Extracts pagination parameters from query params, using defaults when not specified
    fn new_from_params(params: GetPreviewsCursorParams) -> Self {
        GetPreviewsPaginationCursorParams {
            limit: params
                .limit
                .filter(|&limit| 0 < limit && limit <= PREVIEW_MAX)
                .unwrap_or(DEFAULT_PREVIEW_LIMIT),
            sort_method: params
                .sort_method
                .map(|s| s.into_simple_sort())
                .unwrap_or(SimpleSortMethod::ViewedUpdated),
        }
    }
}
