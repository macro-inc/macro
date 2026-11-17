use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::ids::{FileId, MessageTs, TeamId, UserId};

/// One message a file was shared in.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct FileShare {
    /// The share message's `ts`.
    pub ts: MessageTs,
    /// Its thread, for a share in a thread.
    #[serde(default)]
    pub thread_ts: Option<MessageTs>,
}

/// A file attached to a message.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct File {
    /// The file.
    pub id: FileId,
    /// `check_file_info` on Slack Connect files whose metadata is withheld:
    /// call `files.info` for the rest.
    pub file_access: Option<FileAccess>,
    /// Upload time (unix seconds).
    pub created: Option<i64>,
    /// File name.
    pub name: Option<String>,
    /// Title.
    pub title: Option<String>,
    /// MIME type.
    pub mimetype: Option<String>,
    /// Slack's type (`png`, `pdf`).
    pub filetype: Option<String>,
    /// Uploader.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub user: Option<UserId>,
    /// Uploader's workspace.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub user_team: Option<TeamId>,
    /// Hosted, external, snippet, or a tombstone.
    pub mode: Option<FileMode>,
    /// Size in bytes.
    pub size: Option<u64>,
    /// Authenticated download URL.
    pub url_private: Option<String>,
    /// Authenticated download URL that forces `Content-Disposition`.
    pub url_private_download: Option<String>,
    /// Link to the file in Slack.
    pub permalink: Option<String>,
    /// 360px thumbnail.
    pub thumb_360: Option<String>,
    /// 720px thumbnail.
    pub thumb_720: Option<String>,
    /// Image or video width.
    pub original_w: Option<u32>,
    /// Image or video height.
    pub original_h: Option<u32>,
    /// Audio or video length.
    pub duration_ms: Option<u64>,
    /// Alt text.
    pub alt_txt: Option<String>,
    /// Hosted outside Slack (Google Drive and friends).
    #[serde(default)]
    pub is_external: bool,
    /// Where the file was shared: `public`/`private`, then channel id, then
    /// the share messages.
    #[serde(default)]
    pub shares:
        std::collections::BTreeMap<String, std::collections::BTreeMap<String, Vec<FileShare>>>,
}

/// Whether the file's metadata is visible.
#[derive(
    Clone, Debug, PartialEq, Eq, strum::EnumString, strum::IntoStaticStr, Serialize, Deserialize,
)]
#[strum(serialize_all = "snake_case")]
#[serde(from = "String", into = "String")]
pub enum FileAccess {
    /// Everything is in the message.
    Visible,
    /// Call `files.info` for the metadata.
    CheckFileInfo,
    /// The file is gone or not shared with the caller.
    FileNotFound,
    /// Any other value, verbatim.
    #[strum(default)]
    Other(String),
}

/// How the file is stored.
#[derive(
    Clone, Debug, PartialEq, Eq, strum::EnumString, strum::IntoStaticStr, Serialize, Deserialize,
)]
#[strum(serialize_all = "snake_case")]
#[serde(from = "String", into = "String")]
pub enum FileMode {
    /// Uploaded to Slack.
    Hosted,
    /// Hosted elsewhere.
    External,
    /// A text snippet.
    Snippet,
    /// A post.
    Post,
    /// Deleted; only the placeholder remains.
    Tombstone,
    /// Hidden by the free plan's history limit.
    HiddenByLimit,
    /// Any other value, verbatim.
    #[strum(default)]
    Other(String),
}

impl From<String> for FileAccess {
    fn from(value: String) -> Self {
        Self::from_str(&value).unwrap_or(Self::Other(value))
    }
}

impl From<FileAccess> for String {
    fn from(value: FileAccess) -> String {
        match value {
            FileAccess::Other(access) => access,
            known => <&'static str>::from(known).to_owned(),
        }
    }
}

impl From<String> for FileMode {
    fn from(value: String) -> Self {
        Self::from_str(&value).unwrap_or(Self::Other(value))
    }
}

impl From<FileMode> for String {
    fn from(value: FileMode) -> String {
        match value {
            FileMode::Other(mode) => mode,
            known => <&'static str>::from(known).to_owned(),
        }
    }
}
