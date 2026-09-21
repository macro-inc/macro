//! Creation of files supplied as bytes, using the ordinary upload lifecycle.

use std::str::FromStr;

use activity::Attribution;
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, EntityType};
use macro_user_id::user_id::MacroUserIdStr;
use model::document::{FileType, FileTypeExt};
use rootcause::compat::anyhow1::IntoAnyhow;

use super::{
    CreatedDocument, DocumentCreator, NewDocumentMetadata, RepoDocumentKind, RepoDocumentSubtype,
    file_shas,
};
use crate::domain::models::DocumentError;
use crate::domain::ports::create::{
    DocumentBytesUpload, DocumentBytesUploadPort, DocumentCreationService,
};

#[cfg(test)]
mod test;

/// Maximum decoded size of a file passed inline to an AI tool (25 MiB).
pub const MAX_INLINE_UPLOAD_BYTES: usize = 25 * 1024 * 1024;

/// File contents and the verified destination for an inline upload.
pub struct NewFileUpload {
    /// Filename, including its extension, without directory components.
    pub file_name: String,
    /// Original file bytes.
    pub bytes: Vec<u8>,
    /// Edit capability for the destination project; absent for top-level files.
    pub project: Option<EntityAccessReceipt<EditAccessLevel>>,
    /// Actor responsible for the upload on behalf of the owner.
    pub attribution: Attribution,
}

impl<Svc, MarkdownInit, BytesUpload, MentionTracker>
    DocumentCreator<Svc, MarkdownInit, BytesUpload, MentionTracker>
where
    Svc: DocumentCreationService,
    BytesUpload: DocumentBytesUploadPort,
{
    /// Upload bytes and let the storage event pipeline finalize the content.
    /// In particular, DOCX conversion and Markdown initialization must finish
    /// before those documents can be marked ready.
    #[tracing::instrument(skip_all, err)]
    pub async fn upload_file(
        &self,
        user_id: MacroUserIdStr<'static>,
        upload: NewFileUpload,
    ) -> Result<CreatedDocument, DocumentError> {
        let NewFileUpload {
            file_name,
            bytes,
            project,
            attribution,
        } = upload;
        if bytes.len() > MAX_INLINE_UPLOAD_BYTES {
            return Err(DocumentError::BadRequest(
                "file exceeds the 25 MiB inline upload limit".to_string(),
            ));
        }
        if file_name.trim().is_empty()
            || file_name == "."
            || file_name == ".."
            || file_name.contains(['/', '\\'])
            || file_name.chars().any(char::is_control)
        {
            return Err(DocumentError::BadRequest(
                "fileName must be a filename without directory components or control characters"
                    .to_string(),
            ));
        }

        let normalized_name = file_name.to_ascii_lowercase();
        let (document_name, file_type) = match FileType::split_suffix_match(&normalized_name) {
            Some((name, extension)) => {
                (&file_name[..name.len()], FileType::from_str(extension).ok())
            }
            None => (file_name.as_str(), None),
        };
        if document_name.trim().is_empty() {
            return Err(DocumentError::BadRequest(
                "fileName must include a name before its extension".to_string(),
            ));
        }
        if file_type == Some(FileType::Spreadsheet) {
            return Err(DocumentError::BadRequest("use CreateDocument to create a native Macro spreadsheet; upload an .xlsx or .csv file to preserve an existing workbook".to_string()));
        }
        if file_type == Some(FileType::Md) && std::str::from_utf8(&bytes).is_err() {
            return Err(DocumentError::BadRequest(
                "Markdown files must contain valid UTF-8 text".to_string(),
            ));
        }

        let mut metadata = NewDocumentMetadata::builder(document_name).attribution(attribution);
        if let Some(project) = project {
            if project.entity().entity_type != EntityType::Project
                || project.acting_user_id() != Some(&user_id)
            {
                return Err(DocumentError::Unauthorized);
            }
            let project_id =
                project.entity().entity_id.parse().map_err(|_| {
                    DocumentError::BadRequest("project id must be a UUID".to_string())
                })?;
            metadata = metadata.project_id(project_id);
        }

        let hashes = file_shas(&bytes);
        let args = metadata.build().into_repo_args(
            user_id.clone(),
            RepoDocumentKind {
                file_type,
                sha: hashes.hex,
                subtype: RepoDocumentSubtype::Regular,
                team_id: None,
                share_with_team: false,
            },
        );
        let response = self
            .document_service
            .create_document(user_id, args, None)
            .await?;
        let created = CreatedDocument::new(response);
        let result = async {
            let presigned_url = created
                .response()
                .document_response
                .presigned_url
                .as_ref()
                .ok_or_else(|| {
                    DocumentError::Internal(
                        rootcause::report!("document storage did not provide an upload URL")
                            .into_anyhow(),
                    )
                })?;
            self.bytes_uploader
                .upload_document_bytes(DocumentBytesUpload {
                    presigned_url: presigned_url.clone(),
                    content_type: created.response().content_type.clone(),
                    base64_sha256: hashes.base64,
                    bytes,
                })
                .await
        }
        .await;
        if let Err(error) = result {
            self.document_service
                .cleanup_created_document(created.document_id())
                .await;
            return Err(error);
        }
        Ok(created)
    }
}
