use axum::{
    Extension,
    extract::State,
    response::{IntoResponse, Json, Response},
};
use futures::StreamExt;
use model::{
    document::{BasicDocument, build_cloud_storage_bucket_document_key},
    response::{ErrorResponse, GenericErrorResponse, GenericSuccessResponse},
    user::UserContext,
};
use reqwest::StatusCode;

use crate::api::context::ApiContext;

const ONBOARDING_FOLDER_NAME: &str = "ONBOARDING_DOCUMENTS";
const PROJECT_NAME: &str = "Starter Docs";

const MARKDOWN_TEMPLATE: &str = include_str!("./template/markdown_template.md");
const CANVAS_TEMPLATE: &str = include_str!("./template/canvas_template.canvas");

#[utoipa::path(
        tag = "document",
        post,
        path = "/documents/initialize_user_documents",
        operation_id = "initialize_user_documents",
        responses(
            (status = 200, body=GenericSuccessResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 403, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(state, user_context), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(state): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> Result<Response, Response> {
    tracing::info!("initialize user documents");
    let start_time = std::time::Instant::now();
    let user_id = user_context.user_id.as_str();
    tracing::debug!("initializing user documents");

    // Contains all documents that will be referenced in the markdown file
    let mut documents = state
        .s3_client
        .get_folder_content_names(format!("{ONBOARDING_FOLDER_NAME}/").as_str())
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get folder content names");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to get folder content names",
                }),
            )
                .into_response()
        })?;

    // Need to explicitly add the markdown file to this list
    documents.push(("Why use Macro?".to_string(), "md".to_string()));
    documents.push(("Macro Canvas".to_string(), "canvas".to_string()));

    tracing::trace!(documents=?documents, elapsed_time=?start_time.elapsed(), "got documents");

    let mut transaction = state.db.begin().await.map_err(|e| {
        tracing::error!(error=?e, "error starting transaction");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to start transaction",
            }),
        )
            .into_response()
    })?;

    // Create default share permission
    let share_permission = macro_share_permissions::share_permission::create_new_share_permission();

    let start_time = std::time::Instant::now();
    let project =
        macro_db_client::document::initialize_onboarding_documents::create_project_transaction(
            &mut transaction,
            user_id,
            PROJECT_NAME,
            None,
            &share_permission,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to create project");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to create project",
                }),
            )
                .into_response()
        })?;

    tracing::trace!(project=?project, elapsed_time=?start_time.elapsed(), "created project");

    let start_time = std::time::Instant::now();
    let db_documents =
        macro_db_client::document::initialize_onboarding_documents::create_onboarding_documents(
            &mut transaction,
            user_id,
            &project.id,
            &share_permission,
            documents,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to create onboarding documents");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to create onboarding documents",
                }),
            )
                .into_response()
        })?;
    tracing::trace!(documents=?db_documents, elapsed_time=?start_time.elapsed(), "created onboarding documents");

    let start_time = std::time::Instant::now();

    let markdown_template = fill_template(MARKDOWN_TEMPLATE, &db_documents).map_err(|e| {
        tracing::error!(error=?e, "failed to fill markdown template");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to fill markdown template",
            }),
        )
            .into_response()
    })?;
    tracing::trace!(elapsed_time=?start_time.elapsed(), "filled markdown template");

    let canvas_template = fill_template(CANVAS_TEMPLATE, &db_documents).map_err(|e| {
        tracing::error!(error=?e, "failed to fill canvas template");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to fill canvas template",
            }),
        )
            .into_response()
    })?;
    tracing::trace!(elapsed_time=?start_time.elapsed(), "filled markdown template");

    let start_time = std::time::Instant::now();
    // Note: this is as good as it gets for speed, the s3 calls themselves are the slow part
    // here unfortunately
    let shared_s3_client = &state.s3_client;
    let shared_markdown_template = markdown_template.clone();
    let shared_canvas_template = canvas_template.clone();
    let results: Vec<anyhow::Result<()>> = futures::stream::iter(db_documents)
        .map(|document| {
            let s3_client = shared_s3_client.clone(); // Clone the client for parallel usage
            let markdown_template = shared_markdown_template.clone();
            let canvas_template = shared_canvas_template.clone();
            async move {
                let uri_document_name = urlencoding::encode(document.document_name.as_str());
                let deref_file_type = document.file_type.as_deref();

                let source_key = match deref_file_type {
                    Some(file_type) => format!("{ONBOARDING_FOLDER_NAME}/{}.{}", uri_document_name, file_type),
                    None => format!("{ONBOARDING_FOLDER_NAME}/{}", uri_document_name),
                };

                let target_key = build_cloud_storage_bucket_document_key(
                    user_id,
                    &document.document_id,
                    document.document_version_id,
                    deref_file_type,
                );

                match deref_file_type {
                    Some("md") => {
                        tracing::trace!(target_key=?target_key, "uploading markdown template");
                        s3_client.upload_document(&target_key, markdown_template.as_bytes().to_vec()).await?;
                    }
                    Some("canvas") => {
                        tracing::trace!(target_key=?target_key, "uploading canvas template");
                        s3_client.upload_document(&target_key, canvas_template.as_bytes().to_vec()).await?;
                    }
                    Some("docx") => {
                        tracing::trace!("skipping because docx is not a standard file");
                    },
                    _ => {
                        tracing::trace!(source_key, target_key, "copying document");
                        let copy_start = std::time::Instant::now();
                        s3_client.copy_document(&source_key, &target_key).await?;
                        tracing::trace!(source_key=?source_key, target_key=?target_key, elapsed_time=?copy_start.elapsed(), "copied document");
                    }
                }

                Ok(())
            }
        })
        .buffer_unordered(10) // Increased concurrent operations
        .collect::<Vec<anyhow::Result<()>>>()
        .await;

    if results.iter().any(|r| r.is_err()) {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to copy documents",
            }),
        )
            .into_response());
    }

    tracing::trace!(elapsed_time=?start_time.elapsed(), "copied documents");

    // Set the onboarding status to true so we don't do this again
    macro_db_client::user::onboarding_status::set_onboarding_status(&mut transaction, user_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to set onboarding status");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to set onboarding status",
                }),
            )
                .into_response()
        })?;

    transaction.commit().await.map_err(|e| {
        tracing::error!(error=?e, "failed to commit transaction");

        // TODO: need to remove the docs from users bucket

        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to commit transaction",
            }),
        )
            .into_response()
    })?;

    // Flagging this off for now until we have a dedicated "onboarding" user
    // let _ = ctx
    //     .comms_service_client
    //     .create_welcome_message(CreateWelcomeMessageRequest {
    //         welcome_user_id: "macro|mary@macro.com".to_string(),
    //         to_user_id: user_context.user_id.clone(),
    //     })
    //     .await
    //     .inspect_err(|e| {
    //         tracing::error!(error=?e, "unable to create welcome message");
    //     });

    Ok((StatusCode::OK, Json(GenericSuccessResponse::default())).into_response())
}

fn fill_template(template: &str, documents: &Vec<BasicDocument>) -> anyhow::Result<String> {
    // TODO: update template to also dynamically insert name
    let mut template = template.to_string();

    // Replace all document id templates with the actual document id
    for document in documents {
        let document_id = document.document_id.clone();
        if let Some(file_type) = document.file_type.as_deref() {
            let file_type = file_type.to_uppercase();
            template = template.replace(&format!("DOCUMENT_ID_{file_type}"), &document_id);
        }
    }

    Ok(template)
}
