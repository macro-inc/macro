//! Provider download and file-storage adapters for authorized attachment reads.
use super::email_api::GmailApi;
use email::domain::{
    attachment_access::*,
    draft_attachments::AttachmentError,
    mailbox::{MailboxError, projection::MailboxAttachmentAccess},
};
use email_api_client::domain::models::EmailApiError;
use models_email::{
    db::address::EmailRecipientType,
    service::{
        attachment::{AttachmentUploadArgs, AttachmentUploadDestination},
        link::UserProvider,
    },
};
use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use system_properties::{PgSystemPropertiesRepository, SystemPropertiesServiceImpl};

pub struct ProviderAttachmentBytes<A> {
    pub s3: s3_client::S3,
    pub bucket: String,
    pub gmail: GmailApi,
    pub outlook: A,
}
impl<A: MailboxAttachmentAccess> AttachmentBytes for ProviderAttachmentBytes<A> {
    async fn bytes(&self, record: &AttachmentReadRecord) -> Result<Vec<u8>, AttachmentError> {
        if record.attachment.reference_url.is_some() {
            return Err(AttachmentError::Invalid(
                "Open this linked attachment in Outlook",
            ));
        }
        if let Some(blob) = &record.blob {
            use sha2::{Digest, Sha256};
            let data = self
                .s3
                .get(&self.bucket, &blob.key)
                .await
                .map_err(|_| AttachmentError::Infrastructure)?;
            if data.len() as i64 != blob.size
                || format!("{:x}", Sha256::digest(&data)) != blob.sha256
            {
                return Err(AttachmentError::Infrastructure);
            }
            return Ok(data);
        }
        let id = record
            .attachment
            .provider_id
            .as_deref()
            .ok_or(AttachmentError::NotFound)?;
        match record.link.provider {
            UserProvider::Gmail => self
                .gmail
                .get_attachment(record.link.id, &record.message_provider_id, id)
                .await
                .map_err(provider_error),
            UserProvider::Outlook => self
                .outlook
                .download(record.mailbox, &record.message_provider_id, id)
                .await
                .map_err(|e| match e {
                    MailboxError::Provider(e) => provider_error(e),
                    _ => AttachmentError::Infrastructure,
                }),
        }
    }
}
fn provider_error(error: EmailApiError) -> AttachmentError {
    match error {
        EmailApiError::NotFound => AttachmentError::NotFound,
        EmailApiError::AuthRequired => AttachmentError::Reauthorization,
        EmailApiError::Forbidden => AttachmentError::Forbidden,
        EmailApiError::RateLimited { .. } => AttachmentError::RateLimited,
        _ => AttachmentError::Infrastructure,
    }
}

pub struct MailAttachmentFiles {
    pub db: sqlx::PgPool,
    pub s3: s3_client::S3,
    pub bucket: String,
    pub distribution_url: String,
    pub public_key_id: String,
    pub private_key: String,
    pub url_ttl_seconds: u64,
    pub dss: document_storage_service_client::DocumentStorageServiceClient,
    pub sfs: static_file_service_client::StaticFileServiceClient,
    pub properties: Arc<SystemPropertiesServiceImpl<PgSystemPropertiesRepository>>,
}
impl MailAttachmentFiles {
    fn key(record: &AttachmentReadRecord) -> String {
        format!(
            "temp/{}/{}-{}",
            record.link.id,
            record.attachment.db_id,
            record.attachment.filename.as_deref().unwrap_or_default()
        )
    }
    fn url(&self, key: &str) -> Result<String, AttachmentError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| AttachmentError::Infrastructure)?
            .as_secs();
        let options = cloudfront_sign::SignedOptions {
            key_pair_id: self.public_key_id.clone(),
            date_less_than: now.saturating_add(self.url_ttl_seconds),
            private_key: self.private_key.clone(),
            ..Default::default()
        };
        cloudfront_sign::get_signed_url(
            &format!("{}/{}", self.distribution_url, urlencoding::encode(key)),
            &options,
        )
        .map_err(|_| AttachmentError::Infrastructure)
    }
}
fn failed<E: std::fmt::Debug>(error: E) -> AttachmentError {
    tracing::warn!(?error, "attachment storage deferred");
    AttachmentError::Infrastructure
}
impl AttachmentFiles for MailAttachmentFiles {
    async fn cached_url(
        &self,
        record: &AttachmentReadRecord,
    ) -> Result<Option<String>, AttachmentError> {
        let key = Self::key(record);
        if self.s3.exists(&self.bucket, &key).await.map_err(failed)? {
            Ok(Some(self.url(&key)?))
        } else {
            Ok(None)
        }
    }
    async fn store_download(
        &self,
        record: &AttachmentReadRecord,
        bytes: Vec<u8>,
    ) -> Result<String, AttachmentError> {
        let key = Self::key(record);
        self.s3
            .put(&self.bucket, &key, &bytes)
            .await
            .map_err(failed)?;
        self.url(&key)
    }
    async fn store_document(
        &self,
        record: &AttachmentReadRecord,
        bytes: Vec<u8>,
    ) -> Result<String, AttachmentError> {
        let attachment_metadata =
            email_db_client::attachments::provider::upload::fetch_attachment_upload_metadata_by_id(
                &self.db,
                record.attachment.db_id,
            )
            .await
            .map_err(failed)?
            .ok_or(AttachmentError::NotFound)?;
        let recipients =
            email_db_client::contacts::get::fetch_db_recipients(&self.db, record.message_id)
                .await
                .map_err(failed)?;
        let args = AttachmentUploadArgs {
            attachment_metadata,
            recipient_emails: recipients
                .into_iter()
                .filter(|(_, kind)| *kind == EmailRecipientType::To)
                .filter_map(|(contact, _)| contact.email_address)
                .collect(),
            backfill: false,
            upload_destination: AttachmentUploadDestination::Dss,
        };
        crate::util::upload_attachment::store_attachment(
            crate::util::upload_attachment::AttachmentStorageContext {
                db: &self.db,
                dss_client: &self.dss,
                sfs_client: &self.sfs,
                system_properties_service: &self.properties,
                link: &record.link,
            },
            &args,
            bytes,
        )
        .await
        .map_err(failed)
    }
}
