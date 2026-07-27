use std::sync::Arc;

use crate::api::context::AuthorizationService;
use crate::service::conn_gateway::update_live_comment_state;
use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use connection_gateway_client::ConnectionGatewayClient;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_db_client::annotations::edit_anchor::edit_document_anchor;
use model::{
    annotations::{
        AnnotationIncrementalUpdate,
        edit::{EditAnchorRequest, EditAnchorResponse},
    },
    response::ErrorResponse,
};
use sqlx::PgPool;

use super::comment_error_response;

/// Edits a single anchor for a document
#[utoipa::path(
        patch,
        path = "/annotations/anchors",
        operation_id = "edit_anchor",
        responses(
            (status = 200, body=EditAnchorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[axum::debug_handler(state = crate::api::context::ApiContext)]
pub async fn edit_anchor_handler(
    State(db): State<PgPool>,
    State(conn_gateway_client): State<Arc<ConnectionGatewayClient>>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Json(req): Json<EditAnchorRequest>,
) -> Result<Response, Response> {
    let user_id = user.authorization.user.macro_user_id.as_ref();
    match edit_document_anchor(&db, user_id, req).await {
        Ok(res) => {
            let response: EditAnchorResponse = res;
            let document_id = response.document_id.as_str();
            update_live_comment_state(
                &conn_gateway_client,
                document_id,
                AnnotationIncrementalUpdate::EditAnchor {
                    sender: user_id,
                    document_id,
                    response: &response,
                },
            )
            .await;
            Ok((StatusCode::OK, Json(response)).into_response())
        }
        Err(e) => comment_error_response(e, "Error editing anchor"),
    }
}
