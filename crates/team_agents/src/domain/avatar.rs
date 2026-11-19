//! Saved agent avatars and their validation.

use model_user::AvatarFace;
use serde::Deserialize;
use uuid::Uuid;

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

/// The static file service's public base. An agent's picture is a file
/// uploaded there, so every teammate's client only ever loads Macro's own
/// files, never a host an admin chose.
#[derive(Debug, Clone)]
pub struct PictureBase(String);

impl PictureBase {
    /// The base, such as `https://static-file-service.macro.com`.
    pub fn new(base: impl Into<String>) -> Self {
        let base = base.into();
        Self(base.trim_end_matches('/').to_owned())
    }

    /// Whether `url` is `<base>/file/<uuid>`.
    fn holds(&self, url: &str) -> bool {
        url.strip_prefix(&self.0)
            .and_then(|rest| rest.strip_prefix("/file/"))
            .is_some_and(|id| Uuid::parse_str(id).is_ok())
    }
}

impl AgentAvatar {
    /// Reject unsupported recipes, and pictures that aren't Macro static
    /// files, before any write.
    pub fn validate(&self, pictures: &PictureBase) -> Result<(), TeamAgentError> {
        if self.face.as_ref().is_some_and(|face| !face.is_valid()) {
            return Err(TeamAgentError::InvalidAvatarFace);
        }
        if self.url.as_ref().is_some_and(|url| !pictures.holds(url)) {
            return Err(TeamAgentError::InvalidAvatar);
        }
        Ok(())
    }
}
