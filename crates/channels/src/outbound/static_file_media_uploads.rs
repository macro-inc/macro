//! Static-file adapter that reserves channel media uploads.

use crate::domain::media_upload::{StaticMediaReservation, StaticMediaStore};
use anyhow::Context;
use macro_user_id::user_id::MacroUserIdStr;
use static_file_service_client::StaticFileServiceClient;

/// Reserves channel media in the static-file service.
#[derive(Clone)]
pub struct StaticFileMediaUploads {
    client: StaticFileServiceClient,
}

impl StaticFileMediaUploads {
    /// Create a media upload adapter with an authenticated service client.
    pub fn new(client: StaticFileServiceClient) -> Self {
        Self { client }
    }
}

impl StaticMediaStore for StaticFileMediaUploads {
    async fn reserve(
        &self,
        owner: &MacroUserIdStr<'_>,
        file_name: &str,
        content_type: &str,
    ) -> anyhow::Result<StaticMediaReservation> {
        let reserved = self
            .client
            .reserve_for_user(&owner.to_string(), file_name, content_type)
            .await?;
        Ok(StaticMediaReservation {
            file_id: reserved
                .id
                .parse()
                .context("static file service returned an invalid file id")?,
            upload_url: reserved.upload_url,
        })
    }
}
