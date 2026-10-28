//! S3 upload adapter for the email domain's attachment service.
use email::domain::{
    draft_attachments::{AttachmentError, DraftAttachmentStorage},
    models::AttachmentDraft,
};
use model::document::FileTypeExt;
use model_file_type::{ContentType, FileType};
use std::str::FromStr;

pub struct DraftAttachmentS3 {
    pub s3: s3_client::S3,
    pub bucket: String,
}
impl DraftAttachmentStorage for DraftAttachmentS3 {
    async fn verify_upload(&self, attachment: &AttachmentDraft) -> Result<(), AttachmentError> {
        let (size, sha) = self
            .s3
            .verified_metadata(&self.bucket, &attachment.s3_key)
            .await
            .map_err(|_| AttachmentError::Infrastructure)?;
        if size != i64::from(attachment.size) || sha.as_deref() != Some(attachment.sha.as_str()) {
            return Err(AttachmentError::Invalid(
                "Uploaded bytes do not match the reserved file",
            ));
        }
        Ok(())
    }
    fn content_type(&self, filename: &str) -> String {
        let file_type = FileType::split_suffix_match(filename)
            .and_then(|(_, extension)| FileType::from_str(extension).ok());
        let content_type: ContentType = file_type.into();
        content_type.mime_type().to_owned()
    }
    async fn upload_url(&self, attachment: &AttachmentDraft) -> Result<String, AttachmentError> {
        self.s3
            .put_presigned_url(
                &self.bucket,
                &attachment.s3_key,
                &attachment.sha,
                &attachment.content_type,
            )
            .await
            .map_err(|_| AttachmentError::Infrastructure)
    }
}

impl email::domain::attachment_cleanup::DraftObjectDeletion for DraftAttachmentS3 {
    async fn delete_object(&self, key: &str) -> Result<(), AttachmentError> {
        self.s3
            .delete(&self.bucket, key)
            .await
            .map_err(|_| AttachmentError::Infrastructure)
    }
}

impl email::domain::draft_transfer::DraftTransferFiles for DraftAttachmentS3 {
    async fn store(&self, key: &str, bytes: &[u8]) -> Result<(), email::domain::models::EmailErr> {
        self.s3
            .put(&self.bucket, key, bytes)
            .await
            .map_err(email::domain::models::EmailErr::RepoErr)
    }
}
