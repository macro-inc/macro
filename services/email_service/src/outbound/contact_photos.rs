use email::domain::mailbox::{MailboxError, MailboxKey, contacts::ContactPhotoStorage};
use email_api_client::domain::models::ContactPhoto;
use static_file_service_client::StaticFileServiceClient;

pub struct ContactPhotoStore {
    pub db: sqlx::PgPool,
    pub sfs: StaticFileServiceClient,
}

impl ContactPhotoStorage for ContactPhotoStore {
    async fn store(
        &self,
        mailbox: MailboxKey,
        hash: &str,
        photo: ContactPhoto,
    ) -> Result<String, MailboxError> {
        let key = format!("outlook-avatar/{}/{hash}", mailbox.link_id);
        if let Some(url) = email_db_client::sfs_mappings::fetch_sfs_mapping(&self.db, &key)
            .await
            .map_err(|_| MailboxError::Persistence)?
        {
            return Ok(url);
        }
        // No provider URL, email address or credential becomes public metadata.
        let result = self
            .sfs
            .put_named_bytes("avatar", photo.bytes.into(), &photo.content_type)
            .await
            .map_err(|_| MailboxError::Persistence)?;
        let url = result.file_location;
        email_db_client::sfs_mappings::insert_sfs_mappings(
            &self.db,
            &std::collections::HashMap::from([(key, url.clone())]),
        )
        .await
        .map_err(|_| MailboxError::Persistence)?;
        Ok(url)
    }
}
