use crate::{
    api::context::ApiContext,
    model::response::documents::{DocumentResponse, DocumentResponseMetadata},
};
use axum::{http::StatusCode, response::Response};
use macro_db_client::history::upsert_user_history;
use model::{document::FileTypeExt, sync_service::SyncServiceVersionID};
use model::{
    document::{
        BomPart, CONVERTED_DOCUMENT_FILE_NAME, DocumentMetadata, FileType,
        build_cloud_storage_bucket_document_key,
    },
    response::GenericResponse,
};
use models_permissions::share_permission::SharePermissionV2;

#[tracing::instrument(skip(ctx))]
pub async fn copy_document<'a>(
    ctx: &'a ApiContext,
    user_id: &'a str,
    original_document_metadata: &'a DocumentMetadata,
    updated_document_name: &'a str,
    file_type: Option<&'a FileType>,
    version_id: Option<SyncServiceVersionID>,
) -> Result<Response, (Option<String>, anyhow::Error, &'a str)> {
    tracing::info!("copy document");
    let share_permission = SharePermissionV2::default();
    // Create new document in db using document metadata
    let updated_document_metadata = match macro_db_client::document::v2::copy::copy_document(
        &ctx.db,
        original_document_metadata,
        user_id,
        updated_document_name,
        file_type,
        &share_permission,
    )
    .await
    {
        Ok(document_metadata) => document_metadata,
        Err(e) => {
            tracing::error!(error=?e, "unable to copy document");
            return Err((None, e, "unable to copy document"));
        }
    };

    match file_type {
        Some(FileType::Docx) => {
            let document_bom: Vec<BomPart> =
                serde_json::from_value(updated_document_metadata.document_bom.clone().unwrap())
                    .map_err(|e| {
                        tracing::error!(error=?e, "unable to deserialize document bom");
                        (
                            Some(updated_document_metadata.document_id.clone()),
                            anyhow::anyhow!(e),
                            "unable to deserialize document bom",
                        )
                    })?;

            let shas: Vec<String> = document_bom.into_iter().map(|b| b.sha).collect();

            // update sha ref count
            if let Err(e) = ctx.redis_client.increment_counts(shas).await {
                tracing::error!("unable to increment sha ref count: {e}");
                return Err((
                    Some(updated_document_metadata.document_id),
                    e,
                    "unable to increment sha ref count",
                ));
            }

            // Since we now store a pdf version of docx files (when the conversion is successful)
            // we need to also copy this over into the new dss file
            let url_encoded_owner = urlencoding::encode(&original_document_metadata.owner);
            // Get the source document key
            let source_key = format!(
                "{}/{}/{}.pdf",
                url_encoded_owner,
                original_document_metadata.document_id,
                CONVERTED_DOCUMENT_FILE_NAME
            );

            let dest_key = format!(
                "{}/{}/{}.pdf",
                user_id, updated_document_metadata.document_id, CONVERTED_DOCUMENT_FILE_NAME
            );

            if let Err(e) = ctx.s3_client.copy_document(&source_key, &dest_key).await {
                tracing::error!(error=?e, "unable to copy converted docx document");
                return Err((
                    Some(updated_document_metadata.document_id.clone()),
                    e,
                    "unable to copy converted docx document",
                ));
            }
        }
        // handle live collab
        Some(FileType::Md) => {
            tracing::debug!("md file type, copying through sync service");

            // send copy document request to sync service
            if let Err(e) = ctx
                .sync_service_client
                .copy_document(
                    &original_document_metadata.document_id, // document we are copying from
                    &updated_document_metadata.document_id,  // document we are copying to
                    version_id,
                )
                .await
            {
                tracing::error!(error=?e, "unable to copy document through sync service");
                return Err((
                    Some(updated_document_metadata.document_id.clone()),
                    e,
                    "unable to copy document through sync service",
                ));
            }

            // TODO: REMOVE_LIVE_COLLAB
            let document_version_id = macro_db_client::document::get_latest_document_version_id(
                &ctx.db,
                &original_document_metadata.document_id,
            )
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to get document version id");
                (
                    Some(updated_document_metadata.document_id.clone()),
                    e,
                    "unable to get document version id",
                )
            })?
            .0;

            let url_encoded_owner = urlencoding::encode(&original_document_metadata.owner);
            let file_type_str = file_type.map(|s| s.as_str());

            // Get the source document key
            let source_key = build_cloud_storage_bucket_document_key(
                &url_encoded_owner,
                &original_document_metadata.document_id,
                document_version_id,
                file_type_str,
            );

            let dest_key = build_cloud_storage_bucket_document_key(
                user_id,
                &updated_document_metadata.document_id,
                updated_document_metadata.document_version_id,
                file_type_str,
            );

            let _ = ctx
                .s3_client
                .copy_document(&source_key, &dest_key)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "unable to copy live collab document");
                });
            // END: REMOVE_LIVE_COLLAB
        }
        _ => {
            if file_type == Some(&FileType::Pdf) {
                tracing::trace!("pdf file type, copying extra file information");
                macro_db_client::document::copy_document::copy_pdf_parts::copy_pdf_parts(
                    ctx.db.clone(),
                    &updated_document_metadata.document_id,
                    &original_document_metadata.document_id,
                )
                .await
                .map_err(|e| {
                    tracing::error!(error=?e, "unable to copy pdf parts");
                    (
                        Some(updated_document_metadata.document_id.clone()),
                        e,
                        "unable to copy pdf parts",
                    )
                })?;
            }

            let document_version_id = if file_type.is_none_or(|f| f.is_static()) {
                macro_db_client::document::get_document_version_id(
                    &ctx.db,
                    &original_document_metadata.document_id,
                )
                .await
                .map_err(|e| {
                    tracing::error!(error=?e, "unable to get document version id");
                    (
                        Some(updated_document_metadata.document_id.clone()),
                        e,
                        "unable to get document version id",
                    )
                })?
                .0
            } else {
                macro_db_client::document::get_latest_document_version_id(
                    &ctx.db,
                    &original_document_metadata.document_id,
                )
                .await
                .map_err(|e| {
                    tracing::error!(error=?e, "unable to get document version id");
                    (
                        Some(updated_document_metadata.document_id.clone()),
                        e,
                        "unable to get document version id",
                    )
                })?
                .0
            };

            let url_encoded_owner = urlencoding::encode(&original_document_metadata.owner);
            let file_type_str = file_type.map(|s| s.as_str());

            // Get the source document key
            let source_key = build_cloud_storage_bucket_document_key(
                &url_encoded_owner,
                &original_document_metadata.document_id,
                document_version_id,
                file_type_str,
            );

            let dest_key = build_cloud_storage_bucket_document_key(
                user_id,
                &updated_document_metadata.document_id,
                updated_document_metadata.document_version_id,
                file_type_str,
            );

            // handle non live collab
            ctx.s3_client
                .copy_document(&source_key, &dest_key)
                .await
                .map_err(|err| {
                    tracing::error!(error=?err, "unable to copy document");
                    (
                        Some(updated_document_metadata.document_id.clone()),
                        err,
                        "unable to copy document",
                    )
                })?;
        }
    };

    let document_response_metadata = match DocumentResponseMetadata::from_document_metadata(
        &updated_document_metadata,
    ) {
        Ok(document_response_metadata) => document_response_metadata,
        Err(e) => {
            tracing::error!(error=?e, "unable to convert document metadata. this should never happen");
            return Err((
                Some(updated_document_metadata.document_id.clone()),
                e,
                "unable to copy document metadata. this should never happen",
            ));
        }
    };

    let mut transaction = match ctx.db.begin().await {
        Ok(transaction) => transaction,
        Err(e) => {
            tracing::error!(error=?e, "unable to begin transaction");

            return Err((
                Some(updated_document_metadata.document_id.clone()),
                e.into(),
                "unable to copy document",
            ));
        }
    };
    if let Err(e) = upsert_user_history(
        &mut transaction,
        user_id,
        &updated_document_metadata.document_id,
        "document",
    )
    .await
    {
        tracing::error!(error=?e, "unable to insert document into history");
        return Err((
            Some(updated_document_metadata.document_id.clone()),
            e,
            "unable to create document",
        ));
    }

    if let Err(e) = transaction.commit().await {
        tracing::error!(error=?e, "unable to commit transaction");
        return Err((
            Some(updated_document_metadata.document_id.clone()),
            e.into(),
            "unable to copy document",
        ));
    }

    let response_data = DocumentResponse {
        document_metadata: document_response_metadata,
        // Only used in create/update
        presigned_url: None,
    };

    Ok(GenericResponse::builder()
        .data(&response_data)
        .send(StatusCode::OK))
}
