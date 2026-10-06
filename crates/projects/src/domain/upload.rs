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
    folders: &[String],
) -> anyhow::Result<FileSystemNode> {
    let file_system = FileSystemNode::build_file_system(root_folder_name, content, folders)?;
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
                &document.owner,
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
            &document.owner,
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

#[cfg(test)]
mod tests {
    use super::*;
    use model::document::FileTypeExt;

    fn item(relative_path: &str, full_name: &str) -> FolderItem {
        let (name, file_type) = match FileType::split_suffix_match(full_name) {
            Some((name, extension)) => (name, FileType::from_str(extension).ok()),
            None => (full_name, None),
        };
        FolderItem {
            name: name.to_string(),
            full_name: full_name.to_string(),
            file_type,
            relative_path: relative_path.to_string(),
            sha: "sha".to_string(),
        }
    }

    fn folder(node: &FileSystemNode) -> &std::collections::HashMap<String, FileSystemNode> {
        match node {
            FileSystemNode::Folder(content) => content,
            FileSystemNode::File(item) => panic!("expected folder, found {item:?}"),
        }
    }

    #[test]
    fn nested_files_build_nested_folders() {
        let root = build_root_folder(
            "Pack",
            vec![
                item("Pack", "Summary.docx"),
                item("Pack/Finance/Forecasts", "Q4.xlsx"),
                item("Pack/Decks/Archive", "Old.pptx"),
            ],
            &[],
        )
        .unwrap();

        let root = folder(&root);
        assert!(matches!(root.get("Summary.docx"), Some(FileSystemNode::File(_))));
        let forecasts = folder(folder(&root["Finance"]).get("Forecasts").unwrap());
        assert!(matches!(forecasts.get("Q4.xlsx"), Some(FileSystemNode::File(_))));
        let archive = folder(folder(&root["Decks"]).get("Archive").unwrap());
        assert!(matches!(archive.get("Old.pptx"), Some(FileSystemNode::File(_))));
    }

    #[test]
    fn empty_folders_are_kept() {
        let root = build_root_folder(
            "Pack",
            vec![item("Pack/Finance", "Budget.xlsx")],
            &[
                "Pack".to_string(),
                "Pack/Empty".to_string(),
                "Pack/Finance".to_string(),
                "Pack/Finance/Empty Leaf".to_string(),
            ],
        )
        .unwrap();

        let root = folder(&root);
        assert!(folder(&root["Empty"]).is_empty());
        let finance = folder(&root["Finance"]);
        assert!(matches!(finance.get("Budget.xlsx"), Some(FileSystemNode::File(_))));
        assert!(folder(&finance["Empty Leaf"]).is_empty());
    }

    #[test]
    fn folder_listed_before_its_files_keeps_the_files() {
        let root = build_root_folder(
            "Pack",
            vec![item("Pack/A", "a.docx")],
            &["Pack/A".to_string(), "Pack/A/B".to_string()],
        )
        .unwrap();

        let a = folder(&folder(&root)["A"]);
        assert_eq!(a.len(), 2);
        assert!(matches!(a.get("a.docx"), Some(FileSystemNode::File(_))));
        assert!(folder(&a["B"]).is_empty());
    }

    #[test]
    fn root_with_only_empty_folders() {
        let root = build_root_folder("Pack", Vec::new(), &["Pack/Only".to_string()]).unwrap();
        assert!(folder(&folder(&root)["Only"]).is_empty());
    }

    #[test]
    fn uppercase_extension_is_typed() {
        let upper = item("Pack", "REPORT.DOCX");
        assert_eq!(upper.file_type, Some(FileType::Docx));
        assert_eq!(upper.name, "REPORT");
    }
}
