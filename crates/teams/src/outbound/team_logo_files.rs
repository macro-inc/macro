//! Static-file metadata adapter for the team logo.

use static_file_service_client::StaticFileServiceClient;

use crate::domain::team_logo::{
    TeamLogoFile, TeamLogoFileFuture, TeamLogoFiles, TeamLogoLookupError,
};

/// Reads authoritative file metadata through the static-file service.
#[derive(Clone)]
pub struct StaticFileTeamLogos {
    client: std::sync::Arc<StaticFileServiceClient>,
}

impl std::fmt::Debug for StaticFileTeamLogos {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StaticFileTeamLogos")
            .finish_non_exhaustive()
    }
}

impl StaticFileTeamLogos {
    /// Create a logo metadata adapter with an authenticated service client.
    pub fn new(client: std::sync::Arc<StaticFileServiceClient>) -> Self {
        Self { client }
    }
}

impl TeamLogoFiles for StaticFileTeamLogos {
    fn get_logo_file(&self, file_id: uuid::Uuid) -> TeamLogoFileFuture<'_> {
        Box::pin(async move {
            Ok(self
                .client
                .get_file_metadata(&file_id.to_string())
                .await
                .map_err(TeamLogoLookupError::Unavailable)?
                .map(|file| TeamLogoFile {
                    owner_id: file.owner_id,
                    content_type: file.content_type,
                }))
        })
    }
}
