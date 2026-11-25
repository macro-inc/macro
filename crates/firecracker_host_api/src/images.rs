//! Guest images on a host: `images_dir/<image>/{vmlinux,rootfs.ext4,boot_args}`.
//!
//! `POST /v1/images` stages one: the agent downloads each file (served
//! zstd-compressed), checks its SHA-256 against the request, and only then
//! puts the image in place. An image version is immutable: one already on
//! the host with other contents ends [`ImageState::Conflict`], never replaced.
//! `GET /v1/images` answers every image and where its staging stands.

use serde::{Deserialize, Serialize};

use crate::GuestImage;

/// One of the three files of an image.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    PartialOrd,
    Ord,
    Serialize,
    Deserialize,
    strum::Display,
    strum::EnumIter,
    strum::IntoStaticStr,
)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum ImageFileName {
    /// The kernel a cold boot starts.
    #[serde(rename = "vmlinux")]
    #[strum(serialize = "vmlinux")]
    Vmlinux,
    /// The root filesystem every golden and system disk is cloned from.
    #[serde(rename = "rootfs.ext4")]
    #[strum(serialize = "rootfs.ext4")]
    RootfsExt4,
    /// The kernel command line of a cold boot.
    #[serde(rename = "boot_args")]
    #[strum(serialize = "boot_args")]
    BootArgs,
}

/// A SHA-256 as 64 lowercase hex digits.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema), schema(value_type = String))]
#[serde(try_from = "String", into = "String")]
pub struct Sha256Digest(String);

/// Not 64 lowercase hex digits.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0:?} is not a SHA-256 (64 lowercase hex digits)")]
pub struct InvalidSha256Digest(String);

impl Sha256Digest {
    /// Check `digest`.
    pub fn try_new(digest: impl Into<String>) -> Result<Self, InvalidSha256Digest> {
        let digest = digest.into();
        if digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            Ok(Self(digest))
        } else {
            Err(InvalidSha256Digest(digest))
        }
    }

    /// The hex digits.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for Sha256Digest {
    type Error = InvalidSha256Digest;

    fn try_from(digest: String) -> Result<Self, Self::Error> {
        Self::try_new(digest)
    }
}

impl From<Sha256Digest> for String {
    fn from(digest: Sha256Digest) -> Self {
        digest.0
    }
}

impl std::fmt::Display for Sha256Digest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// A download URL. It may be presigned (a bearer credential until it
/// expires), so it is never logged.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema), schema(value_type = String))]
#[serde(transparent)]
pub struct SourceUrl(pub String);

impl std::fmt::Debug for SourceUrl {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SourceUrl(<redacted>)")
    }
}

/// What one file of an image is and where to fetch it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ImageFileSource {
    /// Which file.
    pub name: ImageFileName,
    /// Serves the file compressed with zstd.
    pub url: SourceUrl,
    /// SHA-256 of the decompressed file.
    pub sha256: Sha256Digest,
    /// Size of the decompressed file.
    pub bytes: u64,
}

/// `POST /v1/images`: stage `image` from `files` (each of the three exactly
/// once), unless it is already in place with these contents.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct StageImage {
    /// Image version, e.g. `macro-box/2026-11-24a`.
    pub image: GuestImage,
    /// Its three files.
    pub files: Vec<ImageFileSource>,
}

/// What a file of an image on the host holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ImageFileDigest {
    /// Which file.
    pub name: ImageFileName,
    /// SHA-256 of its contents.
    pub sha256: Sha256Digest,
    /// Its size.
    pub bytes: u64,
}

/// Where an image stands on the host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ImageState {
    /// In place. `files` is what it holds when the agent staged or checked
    /// it; absent for an image put there by hand and never checked.
    Ready {
        /// Its files' digests.
        files: Option<Vec<ImageFileDigest>>,
    },
    /// Being downloaded, or an image already in place being checked.
    Staging,
    /// The last staging failed; a repeated `POST` tries again.
    Failed {
        /// Why, for logs.
        reason: String,
    },
    /// In place with other contents than the last `POST` asked for. It is
    /// left as it was.
    Conflict {
        /// What it holds.
        files: Vec<ImageFileDigest>,
    },
}

/// An image on the host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct StagedImage {
    /// Image version.
    pub image: GuestImage,
    /// Where it stands.
    pub state: ImageState,
}

#[cfg(test)]
mod test;
