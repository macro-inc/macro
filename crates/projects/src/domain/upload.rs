//! Project folder-upload helpers.

use std::str::FromStr;

use anyhow::Context;
use model::document::{DocumentMetadata, FileType};
use model::folder::{FileSystemNode, FolderItem, S3Destination, S3DestinationMap};
use model::response::PresignedUrl;
use models_bulk_upload::S3ObjectInfo;
use s3_key::{build_cloud_storage_bucket_document_key, build_docx_staging_bucket_document_key};

use super::ports::ProjectUploadUrlPort;

/// Build and extract the root node for a folder-upload request.
pub fn build_root_folder(
    root_folder_name: &str,
    content: Vec<FolderItem>,
) -> anyhow::Result<FileSystemNode> {
    let file_system = FileSystemNode::build_file_system(root_folder_name, content)?;
    let FileSystemNode::Folder(mut roots) = file_system else {
        anyhow::bail!("expected folder upload to produce a folder root");
    };
    roots
        .remove(root_folder_name)
        .context("root folder not found")
}

/// Build external presigned URLs or internal bucket destinations for documents.
pub async fn build_destination_map<U: ProjectUploadUrlPort>(
    upload_urls: &U,
    documents: &[DocumentMetadata],
    internal: bool,
) -> anyhow::Result<S3DestinationMap> {
    let mut destinations = S3DestinationMap::new();

    for document in documents {
        let file_type = document
            .file_type
            .as_deref()
            .map(FileType::from_str)
            .transpose()?;
        let sha = document.sha.clone().context("document needs a sha")?;

        if file_type == Some(FileType::Docx) {
            if !internal {
                tracing::warn!(
                    document_id = %document.document_id,
                    "external destination not implemented for DOCX upload"
                );
                continue;
            }

            let key = build_docx_staging_bucket_document_key(
                document.owner.as_ref(),
                &document.document_id,
                document.document_version_id,
            );
            destinations.insert(
                document.document_id.clone(),
                S3Destination::Internal(S3ObjectInfo {
                    bucket: upload_urls.docx_upload_bucket().to_string(),
                    key,
                }),
            );
            continue;
        }

        let key = build_cloud_storage_bucket_document_key(
            document.owner.as_ref(),
            &document.document_id,
            document.document_version_id,
        );
        let destination = if internal {
            S3Destination::Internal(S3ObjectInfo {
                bucket: upload_urls.document_storage_bucket().to_string(),
                key,
            })
        } else {
            let presigned_url = upload_urls
                .put_document_storage_presigned_url(key, sha.clone(), file_type.into())
                .await?;
            S3Destination::External(PresignedUrl { sha, presigned_url })
        };
        destinations.insert(document.document_id.clone(), destination);
    }

    Ok(destinations)
}
