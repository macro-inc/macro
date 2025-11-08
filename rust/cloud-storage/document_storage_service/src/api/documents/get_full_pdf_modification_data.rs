use std::collections::HashMap;

use crate::api::context::ApiContext;

use axum::{
    Extension,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use macro_db_client::document::build_pdf_modification_data::{
    get_complete_pdf_modification_data, get_pdf_modification_data_for_document,
};
use model::{
    document::{DocumentBasic, FileType, modification_data::PdfModificationData},
    response::{GenericErrorResponse, GenericResponse},
    user::UserContext,
};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Builds the full PDF modification data for a document
#[utoipa::path(
        tag = "document",
        get,
        path = "/documents/{document_id}/full_pdf_modification_data",
        operation_id = "get_full_pdf_modification_data",
        params(
            ("document_id" = String, Path, description = "Document ID")
        ),
        responses(
            (status = 200, body=Option<Value>),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, document_context), fields(user_id=?user_context.user_id, file_type=?document_context.file_type))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    document_context: Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
) -> impl IntoResponse {
    // Get the file type, needed to short circuit if the file type is docx
    let file_type: FileType = if let Some(file_type) = document_context.file_type.as_ref() {
        if let Ok(file_type) = file_type.as_str().try_into() {
            file_type
        } else {
            tracing::error!("unable to parse file type");
            return GenericResponse::builder()
                .message("unable to get file type")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    } else {
        return GenericResponse::builder()
            .message("unable to get file type")
            .is_error(true)
            .send(StatusCode::INTERNAL_SERVER_ERROR);
    };

    match file_type {
        FileType::Pdf | FileType::Docx => {}
        _ => {
            return GenericResponse::builder()
                .message("invalid file type for pdf modification data")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }

    let initial_modification_data = match file_type {
        FileType::Pdf => get_pdf_modification_data_for_document(&ctx.db, &document_id).await,
        FileType::Docx => Ok(PdfModificationData {
            highlights: Some(HashMap::new()),
            bookmarks: Vec::new(),
            placeables: Vec::new(),
            pinned_terms_names: Vec::new(),
        }),
        _ => unreachable!(),
    };

    let initial_modification_data = match initial_modification_data {
        Ok(initial_modification_data) => initial_modification_data,
        Err(e) => {
            tracing::error!(error=?e, "unable to get modification data");
            return GenericResponse::builder()
                .message("unable to get modification data")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let full_modification_data =
        get_complete_pdf_modification_data(&ctx.db, &document_id, Some(initial_modification_data))
            .await;

    if full_modification_data.is_err() {
        return GenericResponse::builder()
            .message("unable to build modification data")
            .is_error(true)
            .send(StatusCode::INTERNAL_SERVER_ERROR);
    }

    let response_data = full_modification_data.unwrap();

    GenericResponse::builder()
        .data(&response_data)
        .send(StatusCode::OK)
}
