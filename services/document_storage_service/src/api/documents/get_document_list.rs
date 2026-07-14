use crate::{api::context::ApiContext, model::response::documents::get::GetDocumentSearchResponse};
use axum::extract::State;
use axum::{Extension, http::StatusCode, response::IntoResponse};
use model::user::UserContext;
use model::{
    document::response::GetDocumentListResult,
    response::{GenericErrorResponse, GenericResponse},
};

/// Gets a list of all the user's documents so they are able to be searched on
#[utoipa::path(
        tag = "document",
        get,
        path = "/documents/list",
        responses(
            (status = 200, body=GetDocumentSearchResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn get_document_list_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> impl IntoResponse {
    let document_search_response_date: Vec<GetDocumentListResult> =
        match macro_db_client::document::get_document_list(
            ctx.db.clone(),
            user_context.user_id.as_str(),
        )
        .await
        {
            Ok(document_search_response_date) => document_search_response_date,
            Err(e) => {
                tracing::error!(error=?e, user_id=?user_context.user_id, "unable to get document search");
                return GenericResponse::builder()
                    .message("unable to get document search")
                    .is_error(true)
                    .send(StatusCode::INTERNAL_SERVER_ERROR);
            }
        };

    GenericResponse::builder()
        .data(&document_search_response_date)
        .send(StatusCode::OK)
}
