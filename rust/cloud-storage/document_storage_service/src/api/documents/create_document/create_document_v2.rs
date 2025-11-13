use crate::api::context::ApiContext;
use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use model::document::response::CreateDocumentResponseData;
use model::document::response::{DocumentResponse, DocumentResponseMetadata};
use model::document::{ContentType, FileType, build_cloud_storage_bucket_document_key};
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::{IS_PUBLIC_DEFAULT, SharePermissionV2};
use uuid::Uuid;

/// Parameters for creating a document
pub struct CreateDocumentParams<'a> {
    pub id: Option<&'a str>,
    pub sha: &'a str,
    pub document_name: &'a str,
    pub owner: &'a str,
    pub file_type: Option<FileType>,
    pub job_id: Option<&'a str>,
    pub project_id: Option<&'a str>,
    pub email_message_id: Option<Uuid>,
    pub created_at: Option<&'a DateTime<Utc>>,
}

/// Creates a document in the database
/// Creates a presigned post url to upload the document to the required bucket
/// In the event of an error, returns status code, error message and optional document id.
/// **note** If document id is present, cleanup is necessary.
#[tracing::instrument(skip(ctx, params), fields(user_id=?params.owner))]
pub async fn create_document(
    ctx: &ApiContext,
    params: CreateDocumentParams<'_>,
) -> Result<CreateDocumentResponseData, (StatusCode, String, Option<String>)> {
    let CreateDocumentParams {
        id,
        sha,
        document_name,
        owner,
        file_type,
        job_id,
        project_id,
        email_message_id,
        created_at,
    } = params;
    tracing::trace!("creating document v2");

    let share_permission = if let Some(file_type) = file_type {
        let public_access_level = match file_type {
            FileType::Md => Some(AccessLevel::Edit),
            _ => Some(AccessLevel::View),
        };

        SharePermissionV2 {
            id: "".to_string(),
            is_public: IS_PUBLIC_DEFAULT,
            public_access_level,
            owner: "".to_string(),
            channel_share_permissions: None,
        }
    } else {
        macro_share_permissions::share_permission::create_new_share_permission()
    };

    // create document metadata
    let document_metadata = macro_db_client::document::v2::create::create_document(
        &ctx.db,
        macro_db_client::document::v2::create::CreateDocumentArgs {
            id,
            sha,
            document_name,
            user_id: owner,
            file_type,
            project_id,
            project_name: None,
            share_permission: &share_permission,
            skip_history: false,
            email_message_id,
            created_at,
        },
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to create document metadata");
        if e.to_string().contains("document with ID already exists") {
            (
                StatusCode::CONFLICT,
                "document with ID already exists".to_string(),
                None,
            )
        } else {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to create document metadata".to_string(),
                None,
            )
        }
    })?;

    // Some file types have upload jobs
    if let Some(job_id) = job_id {
        tracing::trace!(job_id=?job_id, document_id=?document_metadata.document_id, "updating upload job");
        if let Err(e) = macro_db_client::job::upload_job::update_upload_job(
            ctx.db.clone(),
            document_metadata.document_id.as_str(),
            job_id,
        )
        .await
        {
            tracing::error!(error=?e, document_id=?document_metadata.document_id, "failed to update upload job");
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to update upload job".to_string(),
                Some(document_metadata.document_id),
            ));
        }
    }

    let key = build_cloud_storage_bucket_document_key(
        &document_metadata.owner,
        &document_metadata.document_id,
        document_metadata.document_version_id,
        file_type.as_ref().map(|s| s.as_str()),
    );

    let content_type = match file_type {
        Some(FileType::Docx) => ContentType::Docx,
        _ => file_type.into(),
    };

    let mime_type = content_type.mime_type().to_string();

    let presigned_url: String = match file_type {
        Some(FileType::Docx) => ctx.s3_client.put_docx_upload_presigned_url(key.as_str(), sha, content_type).await.map_err(|err| {
            tracing::error!(error=?err, key=?key, document_id=?document_metadata.document_id, "unable to generate presigned url");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to generate presigned url".to_string(),
                Some(document_metadata.document_id.clone()),
            )
        })?,
        _ => ctx.s3_client.put_document_storage_presigned_url(key.as_str(), sha, content_type).await.map_err(|err| {
            tracing::error!(error=?err, key=?key, document_id=?document_metadata.document_id, "unable to generate presigned url");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to generate presigned url".to_string(),
                Some(document_metadata.document_id.clone()),
            )
        })?,
    };

    let document_response_metadata = match DocumentResponseMetadata::from_document_metadata(
        &document_metadata,
    ) {
        Ok(document_response_metadata) => document_response_metadata,
        Err(e) => {
            tracing::error!(error=?e, document_id=?document_metadata.document_id, "unable to convert document metadata. this should never happen");
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to convert document metadata".to_string(),
                Some(document_metadata.document_id),
            ));
        }
    };

    // update project modified if necessary
    macro_project_utils::update_project_modified(
        &ctx.db,
        &ctx.macro_notify_client,
        macro_project_utils::ProjectModifiedArgs {
            project_id,
            old_project_id: None,
            user_id: owner.to_string(),
        },
    )
    .await;

    let response_data = CreateDocumentResponseData {
        document_response: DocumentResponse {
            document_metadata: document_response_metadata,
            presigned_url: Some(presigned_url),
        },
        content_type: mime_type,
        file_type: file_type.map(|f| f.to_string()),
    };

    Ok(response_data)
}
