//! Existing contact-photo persistence, image storage, and gateway leaves.

use crate::pubsub::util::cg_refresh_email;
use crate::util::process_pre_insert::sfs_map::fetch_and_upload_to_sfs;
use connection_gateway_client::client::ConnectionGatewayClient;
use email::domain::mailbox::contacts::sfs_upload::{
    PhotoSyncedNotifier, SfsPhotoContacts, SfsPhotoMappings, SfsPhotoUploader,
};
use models_email::api::refresh::RefreshEmailEvent;
use models_email::service::{contact::Contact, link::Link};
use sqlx::PgPool;
use static_file_service_client::StaticFileServiceClient;
use std::collections::HashMap;
use uuid::Uuid;

/// Original source/destination mapping queries.
pub struct PgSfsPhotoMappings(pub PgPool);

impl SfsPhotoMappings for PgSfsPhotoMappings {
    async fn find(&self, source: &str) -> anyhow::Result<Option<String>> {
        email_db_client::sfs_mappings::fetch_sfs_mapping(&self.0, source).await
    }

    async fn insert(&self, source: String, destination: String) -> anyhow::Result<()> {
        email_db_client::sfs_mappings::insert_sfs_mappings(
            &self.0,
            &HashMap::from([(source, destination)]),
        )
        .await
        .map(|_| ())
    }
}

/// Original contact upsert and owning-inbox read.
pub struct PgSfsPhotoContacts(pub PgPool);

impl SfsPhotoContacts for PgSfsPhotoContacts {
    async fn upsert(&self, contact: Contact) -> anyhow::Result<()> {
        email_db_client::contacts::upsert_sync::upsert_contacts(&self.0, &[contact])
            .await
            .map(|_| ())
    }

    async fn link(&self, link_id: Uuid) -> anyhow::Result<Option<Link>> {
        email_db_client::links::get::fetch_link_by_id(&self.0, link_id).await
    }
}

/// Original image fetch, validation, and static-file upload.
pub struct SfsPhotoUploadClient(pub StaticFileServiceClient);

impl SfsPhotoUploader for SfsPhotoUploadClient {
    async fn fetch_and_upload(&self, source: &str) -> anyhow::Result<Option<(String, String)>> {
        fetch_and_upload_to_sfs(self.0.clone(), source).await
    }
}

/// Original best-effort connection gateway refresh.
pub struct PhotoSyncedGateway(pub ConnectionGatewayClient);

impl PhotoSyncedNotifier for PhotoSyncedGateway {
    async fn photo_synced(&self, macro_id: &str, link_id: Uuid) {
        cg_refresh_email(
            &self.0,
            macro_id,
            RefreshEmailEvent::PhotoSynced { link_id },
        )
        .await;
    }
}
