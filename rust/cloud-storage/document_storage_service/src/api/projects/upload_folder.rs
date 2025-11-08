use std::sync::Arc;

use crate::{
    api::context::{ApiContext, InternalFlag},
    service::{self},
};
use anyhow::Context;
use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::IntoResponse,
};

use model::{
    document::{
        ContentType, DocumentMetadata, FileType, build_cloud_storage_bucket_document_key,
        build_docx_staging_bucket_document_key,
    },
    folder::{
        FileSystemNode, S3Destination, S3DestinationMap, UploadFolderRequest,
        UploadFolderResponseData, UploadFolderWithIdsResponse,
    },
    response::{GenericErrorResponse, GenericResponse, PresignedUrl, TypedSuccessResponse},
    user::UserContext,
};
use models_bulk_upload::{
    MarkProjectUploadedRequest, MarkProjectUploadedResponse, S3ObjectInfo,
    UploadExtractFolderRequest, UploadExtractFolderResponseData,
};
use models_permissions::share_permission::SharePermissionV2;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

type UploadExtractFolderResponse = TypedSuccessResponse<UploadExtractFolderResponseData>;
type UploadFolderResponse = TypedSuccessResponse<UploadFolderResponseData>;

/// Creates a request id in the dynamodb table for tracking the upload
/// Returns a presigned url for uploading a zip file to the staging bucket
/// Returns a request id for tracking the upload
#[utoipa::path(
        tag = "project",
        post,
        path = "/projects/upload_extract",
        responses(
            (status = 200, body=inline(UploadExtractFolderResponse)),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, req), fields(user_id=?user_context.user_id))]
pub async fn upload_extract_folder_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Json(req): extract::Json<UploadExtractFolderRequest>,
) -> impl IntoResponse {
    let user_id = user_context.user_id.as_str();
    let name = req.name.as_deref();

    // use local request id for local development
    // (used by bulk upload lambda test events)
    let request_id = if cfg!(feature = "local") {
        tracing::info!("using local request id");
        "d50676e2-0a12-4c62-bc07-4b1cb6d8e9bc".to_string()
    } else {
        Uuid::new_v4().to_string()
    };

    tracing::debug!("upload extract: request id {}, name {:?}", request_id, name);
    let maybe_request = ctx
        .dynamodb_client
        .bulk_upload
        .create_bulk_upload_request(request_id.as_str(), user_id, name, req.parent_id.as_deref())
        .await;

    let request = match maybe_request {
        Ok(request) => request,
        Err(e) => {
            tracing::error!(error=?e, "unable to create bulk upload request");
            return GenericResponse::builder()
                .message(&format!("unable to create bulk upload request: {}", e))
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let presigned_url = match ctx
        .s3_client
        .put_upload_zip_staging_presigned_url(request.key.as_str(), req.sha.as_str())
        .await
    {
        Ok(presigned_url) => presigned_url,
        Err(e) => {
            tracing::error!(error=?e, "unable to create presigned url");
            return GenericResponse::builder()
                .message(&format!("unable to create presigned url: {}", e))
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let data = UploadExtractFolderResponseData {
        request_id,
        presigned_url,
    };

    return GenericResponse::builder().data(&data).send(StatusCode::OK);
}

/// Uploads a folder to the user's cloud storage. Mimicing the folder structure
/// with projects and placing all documents in the correct location.
#[utoipa::path(
        post,
        path = "/projects/upload",
        responses(
            (status = 200, body=inline(UploadFolderResponse)),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, req), fields(user_id=?user_context.user_id))]
pub async fn upload_folder_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    internal_context: Option<Extension<InternalFlag>>,
    extract::Json(req): extract::Json<UploadFolderRequest>,
) -> impl IntoResponse {
    let user_id = user_context.user_id.as_str();
    let internal = internal_context.is_some_and(|state| state.internal);
    upload_folder_handler_inner(
        ctx.s3_client.clone(),
        ctx.db.clone(),
        user_id,
        internal,
        req,
    )
    .await
}

// recursively iterates through the folder structure and generates nested projects
// with empty documents in the database
// optionally returns a list of presigned urls for each document for uploading
async fn upload_folder_handler_inner(
    s3_client: Arc<service::s3::S3>,
    db: Pool<Postgres>,
    user_id: &str,
    internal: bool,
    req: UploadFolderRequest,
) -> impl IntoResponse + use<> {
    let file_system = match FileSystemNode::build_file_system(&req.root_folder_name, req.content) {
        Ok(fs) => fs,
        Err(err) => {
            tracing::error!(error=?err, "unable to build file system");
            return GenericResponse::builder()
                .is_error(true)
                .message(&format!("unable to build file system: {}", err))
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };
    let root_folder = match file_system.get_root_folder(&req.root_folder_name) {
        Ok(root_folder) => root_folder,
        Err(err) => {
            tracing::error!(error=?err, "unable to get root folder");
            return GenericResponse::builder()
                .is_error(true)
                .message(&format!("unable to get root folder: {}", err))
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let share_permission = SharePermissionV2::default();

    let mut transaction = match db.begin().await {
        Ok(transaction) => transaction,
        Err(err) => {
            tracing::error!(error=?err, "error starting transaction");
            return GenericResponse::builder()
                .is_error(true)
                .message(&format!("unable to start transaction: {}", err))
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let UploadFolderWithIdsResponse {
        file_system,
        project_ids,
        documents,
    } = match macro_db_client::projects::upload_folder::upload_folder_with_ids(
        &mut transaction,
        user_id,
        &share_permission,
        root_folder,
        &req.root_folder_name,
        &req.upload_request_id,
        req.parent_id.as_deref(),
    )
    .await
    {
        Ok(res) => res,
        Err(err) => {
            tracing::error!(error=?err, "error uploading folder");
            return GenericResponse::builder()
                .is_error(true)
                .message(&format!("unable to upload folder: {}", err))
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    tracing::trace!(documents=?documents, "got documents to upload");

    let destination_map = match build_documents(&s3_client, &documents, internal).await {
        Ok(res) => res,
        Err(err) => {
            tracing::error!(error=?err, "error building s3 destination map");
            cleanup(
                db.clone(),
                user_id,
                &project_ids,
                &documents
                    .iter()
                    .map(|doc| doc.document_id.clone())
                    .collect(),
            )
            .await;

            return GenericResponse::builder()
                .is_error(true)
                .message(&format!("unable to build presigned urls: {}", err))
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Commit transaction at the end so we can auto rollback if user cancels connection
    if let Err(e) = transaction.commit().await {
        tracing::error!(error=?e, "error committing transaction");
        cleanup(
            db.clone(),
            user_id,
            &project_ids,
            &documents
                .iter()
                .map(|doc| doc.document_id.clone())
                .collect(),
        )
        .await;

        return GenericResponse::builder()
            .is_error(true)
            .message(&format!("unable to save folder contents to db: {}", e))
            .send(StatusCode::INTERNAL_SERVER_ERROR);
    }

    let data = UploadFolderResponseData {
        file_system,
        destination_map,
    };

    GenericResponse::builder().data(&data).send(StatusCode::OK)
}

async fn build_documents(
    s3_client: &service::s3::S3,
    documents: &Vec<DocumentMetadata>,
    internal: bool,
) -> anyhow::Result<S3DestinationMap> {
    let mut result: S3DestinationMap = S3DestinationMap::new();
    for document in documents {
        tracing::trace!(document_id=?document.document_id, document_name=?document.document_name, "inserting document into mapping table");
        let file_type: Option<FileType> = document
            .file_type
            .as_deref()
            .and_then(|file_type| file_type.try_into().ok());
        let sha = document.sha.clone().context("document needs a sha")?;
        if file_type != Some(FileType::Docx) {
            let key = build_cloud_storage_bucket_document_key(
                &document.owner,
                &document.document_id,
                document.document_version_id,
                file_type.as_ref().map(|s| s.as_str()),
            );

            match internal {
                false => {
                    let presigned_url: String = match file_type {
                        Some(FileType::Docx) => s3_client.put_docx_upload_presigned_url(key.as_str(), sha.as_str(), ContentType::Docx).await.map_err(|err| {
                            tracing::error!(error=?err, key=?key, document_id=?document.document_id, "unable to generate presigned url");
                            err
                        })?,
                        _ => s3_client.put_document_storage_presigned_url(key.as_str(), sha.as_str(), file_type.into()).await.map_err(|err| {
                            tracing::error!(error=?err, key=?key, document_id=?document.document_id, "unable to generate presigned url");
                            err
                        })?,
                    };

                    result.insert(
                        document.document_id.clone(),
                        S3Destination::External(PresignedUrl { sha, presigned_url }),
                    );
                }
                true => {
                    let s3_object_info = S3ObjectInfo {
                        bucket: s3_client.get_document_storage_bucket().to_string(),
                        key,
                    };
                    result.insert(
                        document.document_id.clone(),
                        S3Destination::Internal(s3_object_info),
                    );
                }
            };
        } else {
            if !internal {
                tracing::warn!("External destination not implemented for docx upload");
                continue;
            }

            let key = build_docx_staging_bucket_document_key(
                &document.owner,
                &document.document_id,
                document.document_version_id,
            );
            let s3_object_info = S3ObjectInfo {
                bucket: s3_client.get_docx_upload_bucket().to_string(),
                key,
            };
            result.insert(
                document.document_id.clone(),
                S3Destination::Internal(s3_object_info),
            );
        }
    }

    Ok(result)
}

/// NOTE: internal only
///
/// handler for marking a folder (and all its children) as uploaded
#[utoipa::path(
        post,
        path = "/projects/mark_uploaded",
        responses(
            (status = 200, body=MarkProjectUploadedResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context))]
pub async fn mark_uploaded_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Json(req): extract::Json<MarkProjectUploadedRequest>,
) -> impl IntoResponse {
    let user_id = user_context.user_id.as_str();
    let root_project_id = req.project_id;

    match macro_db_client::projects::upload_folder::mark_projects_uploaded(
        ctx.db.clone(),
        user_id,
        &root_project_id,
    )
    .await
    {
        Ok(project_ids) => {
            tracing::debug!(project_ids=?project_ids, "marked projects as uploaded");
            let data = MarkProjectUploadedResponse { project_ids };
            (StatusCode::OK, Json(data)).into_response()
        }
        Err(e) => {
            tracing::error!(error=?e, project_id=?root_project_id, "error marking projects as uploaded");
            GenericResponse::builder()
                .is_error(true)
                .message(&format!("Error marking projects as uploaded: {}", e))
                .send(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

/// Performs cleanup of a partially uploaded folder.
#[tracing::instrument(skip(db))]
async fn cleanup(
    db: Pool<Postgres>,
    user_id: &str,
    project_ids: &Vec<String>,
    document_ids: &Vec<String>,
) {
    // Delete project
    for document_id in document_ids {
        if let Err(e) = macro_db_client::document::delete_document(&db, document_id).await {
            tracing::error!(error=?e, document_id=?document_id, "error deleting document from db");
        }
    }

    // Go in reverse order so we delete the root last
    for project_id in project_ids {
        if let Err(e) =
            macro_db_client::projects::delete::delete_project(db.clone(), project_id).await
        {
            tracing::error!(error=?e, project_id=?project_id, "error deleting project from db");
        }
    }
}
