//! Artifact models and errors.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};

/// Most files one version may hold.
pub const MAX_FILES: usize = 255;
/// Largest file in bytes (16 MiB).
pub const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
/// Largest version, all files together, in bytes (64 MiB).
pub const MAX_VERSION_BYTES: u64 = 64 * 1024 * 1024;
/// Longest file path in characters.
pub const MAX_PATH_CHARS: usize = 512;
/// The page every version must have; the origin's root serves it.
pub const ENTRY_PATH: &str = "index.html";
/// Content types a file may declare.
pub const ALLOWED_CONTENT_TYPES: &[&str] = &[
    "text/html",
    "text/css",
    "text/javascript",
    "application/javascript",
    "application/json",
    "text/plain",
    "text/markdown",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/avif",
    "font/woff",
    "font/woff2",
    "font/ttf",
    "font/otf",
    "video/mp4",
    "video/webm",
    "audio/mpeg",
    "application/pdf",
    "application/wasm",
];

/// A validated file path inside a version: relative, `/`-separated, without
/// empty, `.` or `..` segments.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ArtifactPath(pub(crate) String);

impl ArtifactPath {
    /// The path as written.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A lowercase hex SHA-256 digest naming a stored object.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Sha256(pub(crate) String);

impl Sha256 {
    /// The digest as 64 lowercase hex characters.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A scene id: a slug `[a-z0-9][a-z0-9-]{0,63}`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SceneId(pub(crate) String);

impl SceneId {
    /// The slug.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// One file of a version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredFile {
    /// The object's digest.
    pub sha256: Sha256,
    /// Size in bytes.
    pub size: u64,
    /// Declared content type, from [`ALLOWED_CONTENT_TYPES`].
    pub content_type: String,
}

/// A named page of a version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Scene {
    /// Stable slug, unique in the version.
    pub id: SceneId,
    /// Display title.
    pub title: String,
    /// The page, one of the version's files.
    pub path: ArtifactPath,
}

/// A validated version body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Manifest {
    /// Files by path.
    pub files: BTreeMap<ArtifactPath, StoredFile>,
    /// Scenes in display order.
    pub scenes: Vec<Scene>,
}

impl Manifest {
    /// All files' bytes together.
    pub fn total_size(&self) -> u64 {
        self.files.values().map(|file| file.size).sum()
    }
}

/// An immutable published version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactVersion {
    /// 1, 2, 3 … per artifact.
    pub number: i32,
    /// Files and scenes.
    pub manifest: Manifest,
    /// What changed.
    pub message: Option<String>,
    /// The Macro user who published it.
    pub created_by: String,
    /// The bot that published it for that user, if any.
    pub created_by_agent: Option<String>,
    /// Publish time.
    pub created_at: DateTime<Utc>,
}

/// A version in the history list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactVersionSummary {
    /// Version number.
    pub number: i32,
    /// What changed.
    pub message: Option<String>,
    /// The Macro user who published it.
    pub created_by: String,
    /// The bot that published it for that user, if any.
    pub created_by_agent: Option<String>,
    /// Publish time.
    pub created_at: DateTime<Utc>,
    /// Number of files.
    pub file_count: usize,
    /// All files' bytes together.
    pub total_size: u64,
}

/// An artifact with its current version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Artifact {
    /// The artifact document.
    pub document_id: String,
    /// Document name.
    pub name: String,
    /// Document owner, as a principal string.
    pub owner: String,
    /// The highest-numbered version; `None` until the first publish.
    pub current: Option<ArtifactVersion>,
}

/// A file as a publisher sends it.
#[derive(Debug, Clone)]
pub struct FileInput {
    /// Path inside the version.
    pub path: String,
    /// Declared content type.
    pub content_type: String,
    /// Hex SHA-256 of the bytes.
    pub sha256: String,
    /// The bytes, or `None` when the object is already stored for this
    /// artifact (uploaded, or part of an earlier version).
    pub content: Option<Vec<u8>>,
}

/// A scene as a publisher sends it.
#[derive(Debug, Clone)]
pub struct SceneInput {
    /// Slug.
    pub id: String,
    /// Display title.
    pub title: String,
    /// Page path.
    pub path: String,
}

/// Create a new artifact with its first version.
#[derive(Debug, Clone)]
pub struct CreateArtifact {
    /// Document name.
    pub name: String,
    /// Folder to create it in; the caller holds edit access to it.
    pub project_id: Option<uuid::Uuid>,
    /// Files of version 1, each carrying its bytes: nothing is stored for an
    /// artifact that does not exist yet. Empty to create the artifact without
    /// a version, so large files can be uploaded before publishing version 1.
    pub files: Vec<FileInput>,
    /// Scenes of version 1.
    pub scenes: Vec<SceneInput>,
    /// What it is.
    pub message: Option<String>,
}

/// Publish a new version of an existing artifact.
#[derive(Debug, Clone)]
pub struct PublishVersion {
    /// Files of the version.
    pub files: Vec<FileInput>,
    /// Scenes of the version.
    pub scenes: Vec<SceneInput>,
    /// What changed.
    pub message: Option<String>,
    /// The version the publisher built on; a different current version is a
    /// conflict.
    pub base_version: Option<i32>,
}

/// An object a publisher wants to upload directly.
#[derive(Debug, Clone)]
pub struct UploadInput {
    /// Hex SHA-256 of the bytes.
    pub sha256: String,
    /// Size in bytes.
    pub size: u64,
    /// Declared content type.
    pub content_type: String,
}

/// Where to `PUT` one object.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadTarget {
    /// The object's digest.
    pub sha256: Sha256,
    /// Presigned URL.
    pub url: String,
    /// Headers the `PUT` must carry.
    pub headers: BTreeMap<String, String>,
}

/// Who publishes: a Macro user, optionally through a bot or an agent their
/// signed token names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Publisher {
    /// The user the version is attributed to.
    pub user_id: String,
    /// The bot acting for them.
    pub agent: Option<String>,
}

/// Farthest a canvas coordinate may be from the origin, as the canvas
/// editing path accepts it.
pub const MAX_CANVAS_COORDINATE: f64 = 1_000_000.0;
/// Largest width or height of a canvas node.
pub const MAX_CANVAS_SIZE: f64 = 100_000.0;

/// Place an artifact, or one of its scenes, on a canvas.
#[derive(Debug, Clone)]
pub struct PlaceArtifact {
    /// The scene to show instead of `index.html`; it must exist in the
    /// current version.
    pub scene: Option<String>,
    /// World x of the node's top-left corner.
    pub x: f64,
    /// World y of the node's top-left corner.
    pub y: f64,
    /// Node width.
    pub width: f64,
    /// Node height.
    pub height: f64,
}

/// An artifact placed on a canvas.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Placement {
    /// The canvas item id of the new node.
    pub item_id: String,
}

/// Who views: the identity a view token is minted for.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Viewer {
    /// The viewing user, absent for anonymous public-link viewers.
    pub user_id: Option<String>,
    /// The bot viewing for them.
    pub actor: Option<String>,
}

/// Color scheme the page is asked to render in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Theme {
    /// Light.
    Light,
    /// Dark.
    Dark,
}

impl Theme {
    /// The `?theme=` value.
    pub fn as_str(&self) -> &'static str {
        match self {
            Theme::Light => "light",
            Theme::Dark => "dark",
        }
    }
}

/// Ask for a URL that renders a version.
#[derive(Debug, Clone, Default)]
pub struct ViewUrlRequest {
    /// The version, or the current one.
    pub version: Option<i32>,
    /// A scene to open instead of `index.html`.
    pub scene: Option<String>,
    /// Color scheme.
    pub theme: Option<Theme>,
}

/// A URL that renders a version on the artifact's own origin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ViewUrl {
    /// Full URL, carrying the view token in its path.
    pub url: String,
    /// The artifact's origin, to match frame messages against.
    pub origin: String,
    /// The version it renders.
    pub version: i32,
    /// When the token stops working.
    pub expires_at: DateTime<Utc>,
}

/// A signed view token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MintedToken {
    /// The token, safe to put in a URL path segment.
    pub token: String,
    /// When it expires.
    pub expires_at: DateTime<Utc>,
}

/// The origin artifacts are served from: `<scheme>://<document_id>.<host>[:<port>]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentOrigin {
    /// `http` or `https`.
    pub scheme: String,
    /// Lowercase host every artifact's subdomain sits under.
    pub host: String,
    /// Explicit port, when not the scheme's default.
    pub port: Option<u16>,
}

impl ContentOrigin {
    /// The origin of one artifact.
    pub fn for_document(&self, document_id: &str) -> String {
        match self.port {
            Some(port) => format!("{}://{document_id}.{}:{port}", self.scheme, self.host),
            None => format!("{}://{document_id}.{}", self.scheme, self.host),
        }
    }

    /// The document id a `Host` header names, when it is one artifact's host.
    pub fn document_id_from_host(&self, host_header: &str) -> Option<String> {
        let host = hostname(host_header);
        let label = host.strip_suffix(self.host.as_str())?.strip_suffix('.')?;
        let is_single_label = !label.is_empty() && !label.contains('.');
        is_single_label.then(|| label.to_string())
    }

    /// Whether a `Host` header is the artifact content host or any host
    /// under it. Such requests belong to the content router alone.
    pub fn serves_host(&self, host_header: &str) -> bool {
        let host = hostname(host_header);
        host == self.host || host.ends_with(&format!(".{}", self.host))
    }
}

/// The lowercase hostname of a `Host` header. The port is ignored: proxies in
/// front of the service may rewrite it.
fn hostname(host_header: &str) -> String {
    let host = match host_header.rsplit_once(':') {
        Some((host, port)) if port.bytes().all(|byte| byte.is_ascii_digit()) => host,
        _ => host_header,
    };
    host.to_ascii_lowercase()
}

/// A request for one file of a version on an artifact's origin.
#[derive(Debug, Clone)]
pub struct ContentRequest {
    /// The document id the `Host` header names.
    pub host_document_id: String,
    /// The view token from the path.
    pub token: String,
    /// The version number from the path.
    pub version: i32,
    /// The file path, empty for `index.html`.
    pub path: String,
    /// The digest the browser already has (`If-None-Match`), if any.
    pub cached_sha256: Option<String>,
}

/// A chunked object body.
pub type ObjectBody =
    std::pin::Pin<Box<dyn futures::Stream<Item = Result<bytes::Bytes, std::io::Error>> + Send>>;

/// What the content router serves.
pub enum ContentResponse {
    /// The file's bytes.
    File {
        /// Declared content type.
        content_type: String,
        /// Size in bytes.
        size: u64,
        /// The object's digest, its entity tag.
        sha256: Sha256,
        /// The bytes.
        body: ObjectBody,
    },
    /// The browser's copy is current.
    NotModified {
        /// The object's digest, its entity tag.
        sha256: Sha256,
    },
}

/// Artifact errors.
#[derive(Debug, thiserror::Error)]
pub enum ArtifactError {
    /// The artifact, version, scene or file does not exist.
    #[error("{0}")]
    NotFound(String),
    /// The request is malformed or breaks a limit.
    #[error("{0}")]
    BadRequest(String),
    /// The caller may not do this.
    #[error("{0}")]
    Forbidden(String),
    /// Another version was published since the base version.
    #[error("artifact is at version {current}, not {base}")]
    Conflict {
        /// The version the publisher built on.
        base: i32,
        /// The current version.
        current: i32,
    },
    /// Something failed that the caller cannot fix.
    #[error("internal error")]
    Internal(#[from] anyhow::Error),
}
