//! Saved agent avatars and their validation.

use model_user::AvatarFace;
use serde::Deserialize;

use super::models::TeamAgentError;

/// Replace an agent's face and its PNG, or save a photo and clear the face.
/// A missing URL clears the old PNG, so a failed render never leaves stale art.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct AgentAvatar {
    /// Face recipe, or `None` to use a photo (or remove the picture).
    pub face: Option<AvatarFace>,
    /// Uploaded PNG or photo URL; `None` when the upload failed or to remove it.
    pub url: Option<String>,
}

impl AgentAvatar {
    /// Reject unsupported recipes and non-HTTPS pictures before any write.
    pub fn validate(&self) -> Result<(), TeamAgentError> {
        if self.face.as_ref().is_some_and(|face| !face.is_valid()) {
            return Err(TeamAgentError::InvalidAvatarFace);
        }
        if self
            .url
            .as_ref()
            .is_some_and(|url| !url.starts_with("https://"))
        {
            return Err(TeamAgentError::InvalidAvatar);
        }
        Ok(())
    }
}
