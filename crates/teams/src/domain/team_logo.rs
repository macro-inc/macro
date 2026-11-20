//! The team logo: an image a team admin uploaded to static file storage,
//! shown to every member in place of the app rail's create button.
//!
//! Static files belong to the static-file service; this port only reports
//! facts about one, and the team service decides whether it may be the logo.

use std::{future::Future, pin::Pin};

use super::model::TeamError;

/// Image types a browser renders as a logo. SVG is excluded: it can carry
/// scripts and external references.
const TEAM_LOGO_CONTENT_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/// Facts about a static file proposed as a team logo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TeamLogoFile {
    /// The user who uploaded the file.
    pub owner_id: String,
    /// The file's declared MIME type.
    pub content_type: String,
}

/// A boxed future, so the logo files port can be shared as a trait object.
pub type TeamLogoFileFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Option<TeamLogoFile>, anyhow::Error>> + Send + 'a>>;

/// Looks up static files proposed as a team logo.
pub trait TeamLogoFiles: std::fmt::Debug + Send + Sync + 'static {
    /// The file's facts, or `None` when no such file exists.
    fn get_logo_file(&self, file_id: uuid::Uuid) -> TeamLogoFileFuture<'_>;
}

/// Refuses every lookup, so a service built without static file storage
/// cannot set a logo it never checked.
#[derive(Debug)]
pub struct UnavailableTeamLogoFiles;

impl TeamLogoFiles for UnavailableTeamLogoFiles {
    fn get_logo_file(&self, _file_id: uuid::Uuid) -> TeamLogoFileFuture<'_> {
        Box::pin(async { Err(anyhow::anyhow!("team logo uploads are not configured")) })
    }
}

/// Whether `file` may become the logo when `caller_id` sets it: it must exist,
/// be the caller's own upload, and be an image a browser renders safely. An
/// upload is marked complete by an asynchronous storage event, so completion
/// is not checked: setting the logo right after uploading it must work, as it
/// does for profile pictures.
pub(crate) fn check_logo_file(
    file: Option<TeamLogoFile>,
    caller_id: &str,
) -> Result<(), TeamError> {
    let file = file.ok_or_else(|| TeamError::BadRequest("the logo file does not exist".into()))?;

    if file.owner_id != caller_id {
        return Err(TeamError::BadRequest(
            "the logo must be an image you uploaded".into(),
        ));
    }

    if !TEAM_LOGO_CONTENT_TYPES.contains(&file.content_type.as_str()) {
        return Err(TeamError::BadRequest(
            "the logo must be a PNG, JPEG, WebP or GIF image".into(),
        ));
    }

    Ok(())
}
