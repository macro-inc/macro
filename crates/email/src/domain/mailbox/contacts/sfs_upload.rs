//! Store URL-backed contact photos and refresh only the inbox's self-contact.

use anyhow::{Context, anyhow};
use models_email::service::{contact::Contact, link::Link};
use std::future::Future;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Persisted source-to-stored-photo URL mappings.
pub trait SfsPhotoMappings: Send + Sync + 'static {
    /// Read the existing destination for the original URL.
    fn find(&self, source: &str) -> impl Future<Output = anyhow::Result<Option<String>>> + Send;

    /// Store one source/destination mapping using the existing conflict policy.
    fn insert(
        &self,
        source: String,
        destination: String,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Contact writes and inbox facts used to decide whether to refresh its own photo.
pub trait SfsPhotoContacts: Send + Sync + 'static {
    /// Upsert the contact, including successful writes that affect no rows.
    fn upsert(&self, contact: Contact) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Read the owning inbox without changing its existing lookup behavior.
    fn link(&self, link_id: Uuid) -> impl Future<Output = anyhow::Result<Option<Link>>> + Send;
}

/// Fetches an image URL and uploads it to static file storage.
pub trait SfsPhotoUploader: Send + Sync + 'static {
    /// Return the original and stored URLs, or no upload for an unsupported URL.
    fn fetch_and_upload(
        &self,
        source: &str,
    ) -> impl Future<Output = anyhow::Result<Option<(String, String)>>> + Send;
}

/// Best-effort notification that the inbox's own photo has changed.
pub trait PhotoSyncedNotifier: Send + Sync + 'static {
    /// Send the existing photo refresh, retaining the gateway's failure logging.
    fn photo_synced(&self, macro_id: &str, link_id: Uuid) -> impl Future<Output = ()> + Send;
}

/// Final acknowledgement policy for the delivered photo upload.
pub enum SfsPhotoUploadDisposition {
    /// Delete the delivery and return its acknowledgement result.
    Delete,
    /// Retain the delivery and return the original processing error.
    LeaveForRedelivery(anyhow::Error),
}

/// Coordinates mapping reuse, photo storage, contact updates, and refresh policy.
pub struct SfsPhotoUploadService<M, C, U, N> {
    /// Existing URL mappings.
    pub mappings: M,
    /// Contact records and owning inboxes.
    pub contacts: C,
    /// Existing image fetch and storage capability.
    pub uploader: U,
    /// Existing best-effort photo refresh capability.
    pub notifier: N,
}

impl<M: SfsPhotoMappings, C: SfsPhotoContacts, U: SfsPhotoUploader, N: PhotoSyncedNotifier>
    SfsPhotoUploadService<M, C, U, N>
{
    /// Resolve a decoded contact, including invalid deliveries, into an acknowledgement policy.
    pub async fn process(&self, extracted: anyhow::Result<Contact>) -> SfsPhotoUploadDisposition {
        match self.upload_contact(extracted).await {
            Ok(()) => SfsPhotoUploadDisposition::Delete,
            Err(error) => SfsPhotoUploadDisposition::LeaveForRedelivery(error),
        }
    }

    async fn upload_contact(&self, extracted: anyhow::Result<Contact>) -> anyhow::Result<()> {
        let mut contact = extracted?;
        let original_photo_url = contact
            .original_photo_url
            .as_ref()
            .context("Contact has no photo URL")?;

        let sfs_url = match self.mappings.find(original_photo_url).await {
            Ok(Some(existing_url)) => existing_url,
            Ok(None) => self.upload_and_store_mapping(original_photo_url).await?,
            Err(e) => {
                tracing::error!(error = ?e, "Unable to fetch SFS mapping from database, falling back to upload");
                self.upload_and_store_mapping(original_photo_url).await?
            }
        };

        contact.sfs_photo_url = Some(sfs_url);
        let link_id = contact.link_id;
        let contact_email = contact.email_address.clone();

        match self.contacts.upsert(contact).await {
            Ok(()) => {
                self.notify_if_self_contact(link_id, contact_email.as_deref())
                    .await
            }
            Err(err) => tracing::error!(error = ?err, "Unable to upsert contact"),
        }
        Ok(())
    }

    async fn notify_if_self_contact(&self, link_id: Uuid, contact_email: Option<&str>) {
        let Some(contact_email) = contact_email else {
            return;
        };
        let link = match self.contacts.link(link_id).await {
            Ok(Some(link)) => link,
            Ok(None) => return,
            Err(e) => {
                tracing::error!(error = ?e, link_id = %link_id, "Failed to fetch link for photo sync");
                return;
            }
        };

        if !contact_email.eq_ignore_ascii_case(link.email_address.0.as_ref()) {
            return;
        }

        self.notifier
            .photo_synced(link.macro_id.as_ref(), link_id)
            .await;
    }

    async fn upload_and_store_mapping(&self, photo_url: &str) -> anyhow::Result<String> {
        tracing::debug!(url = ?photo_url, "Uploading photo to SFS");
        let (old_url, new_sfs_url) = self
            .uploader
            .fetch_and_upload(photo_url)
            .await
            .map_err(|e| {
                tracing::error!(error = ?e, "Unable to fetch and upload file to SFS");
                anyhow!("Unable to fetch and upload file to SFS")
            })?
            .ok_or_else(|| {
                tracing::warn!("URL not uploaded to SFS");
                anyhow!("URL not uploaded to SFS")
            })?;

        tracing::debug!(old_url = ?old_url, new_url = ?new_sfs_url, "Successfully uploaded to SFS");

        if let Err(err) = self.mappings.insert(old_url, new_sfs_url.clone()).await {
            tracing::error!(error = ?err, "Unable to insert mapping into sfs_mappings");
        } else {
            tracing::debug!("Successfully inserted SFS mapping");
        }

        Ok(new_sfs_url)
    }
}
