//! Walkthrough artifacts: what Cursor wrote, what Macro re-hosted, and the
//! markdown that puts them in the conversation.
//!
//! Cursor's agents save screenshots and screen recordings to an agent-scoped
//! artifacts store that nothing in the ACP stream mentions. A turn that
//! produced any collects them, re-hosts them somewhere permanent, and says so
//! in ordinary assistant text — artifacts are not a new kind of update, they
//! are a paragraph of markdown like any other.

use serde::{Deserialize, Serialize};

/// One file in the agent's artifacts store, as Cursor lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactListing {
    /// Workspace-relative path, always under `artifacts/`.
    pub path: String,
    /// Size in bytes, so a caller can decline a body before fetching it.
    pub size_bytes: u64,
    /// When Cursor last wrote it, as the timestamp string it sent. Compared,
    /// never interpreted: an agent that reshoots a screenshot writes the same
    /// path again, so the pair is the artifact's identity.
    pub updated_at: String,
}

impl ArtifactListing {
    /// This version of this artifact, as the key a diff is kept in.
    #[must_use]
    pub fn key(&self) -> String {
        format!("{}@{}", self.path, self.updated_at)
    }

    /// The file name a reader sees, without the `artifacts/` prefix.
    #[must_use]
    pub fn name(&self) -> &str {
        self.path.rsplit('/').next().unwrap_or(&self.path)
    }
}

/// An artifact's bytes, with whatever the store said they were.
pub struct FetchedArtifact {
    /// The download's `Content-Type`, when it sent a usable one.
    pub content_type: Option<String>,
    /// The bytes themselves.
    pub bytes: bytes::Bytes,
}

/// One artifact this session re-hosted, durable in the journal.
///
/// The URI is the whole point: Cursor's own download links expire in fifteen
/// minutes, and a conversation outlives that by years.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectedArtifact {
    /// `path@updated_at`, what later turns diff against.
    pub key: String,
    /// File name, as shown to the reader.
    pub name: String,
    /// The media type it was stored with.
    pub mime_type: String,
    /// Permanent URL the markdown points at.
    pub uri: String,
    /// Size in bytes, as Cursor listed it.
    pub size_bytes: u64,
}

/// Media types this crate infers from a file extension, when the download did
/// not say what it was serving.
const MIME_BY_EXTENSION: [(&str, &str); 14] = [
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("mp4", "video/mp4"),
    ("webm", "video/webm"),
    ("mov", "video/quicktime"),
    ("txt", "text/plain"),
    ("log", "text/plain"),
    ("json", "application/json"),
    ("md", "text/markdown"),
    ("pdf", "application/pdf"),
    ("svg", "image/svg+xml"),
];

/// What a store answers with when it is serving bytes it cannot identify.
const OPAQUE_MIME_TYPES: [&str; 2] = ["application/octet-stream", "binary/octet-stream"];

/// The media type to store `name` under.
///
/// The download's own header wins when it says anything specific. S3 serves
/// an object uploaded without a type as `binary/octet-stream`, which is true
/// and useless: it would render a screenshot as a file to download rather
/// than an image, so the extension decides instead.
#[must_use]
pub fn mime_type(name: &str, served: Option<&str>) -> String {
    let served = served
        .map(str::trim)
        .filter(|mime| !mime.is_empty())
        .filter(|mime| {
            let base = mime.split(';').next().unwrap_or(mime).trim();
            !OPAQUE_MIME_TYPES.contains(&base.to_ascii_lowercase().as_str())
        });
    if let Some(served) = served {
        return served.to_owned();
    }
    let extension = name.rsplit('.').next().unwrap_or_default().to_lowercase();
    MIME_BY_EXTENSION
        .iter()
        .find(|(candidate, _)| *candidate == extension)
        .map_or("application/octet-stream", |(_, mime)| mime)
        .to_owned()
}

/// The assistant text that presents `artifacts` to the reader.
///
/// A pure function of the collected list, because live delivery and a later
/// `session/load` replay both go through it and a session that renders
/// differently on reload is a bug the reader sees.
///
/// Images inline as markdown; videos use the editor's `<m-video>` block,
/// which is what Macro's document format renders a player from; everything
/// else is a link, which is the honest rendering of a file nobody can preview.
#[must_use]
pub fn artifact_markdown(artifacts: &[CollectedArtifact]) -> String {
    // A blank line before each entry: the first separates this from whatever
    // sentence the run's answer ended on, the rest make one paragraph per
    // file.
    let mut markdown = String::new();
    for artifact in artifacts {
        markdown.push_str("\n\n");
        markdown.push_str(&entry_markdown(artifact));
    }
    markdown
}

/// The `<m-video>` payload the Macro editor reads: a URL and how to read it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoBlock<'a> {
    url: &'a str,
    src_type: &'a str,
}

fn entry_markdown(artifact: &CollectedArtifact) -> String {
    if artifact.mime_type.starts_with("image/") {
        return format!("![{}]({})", artifact.name, artifact.uri);
    }
    if artifact.mime_type.starts_with("video/") {
        // A serialized struct rather than `json!`, whose map orders its keys
        // by whichever features the build happened to unify; this text is
        // compared byte for byte against a replay of it.
        let video = serde_json::to_string(&VideoBlock {
            url: &artifact.uri,
            src_type: "url",
        })
        .unwrap_or_default();
        return format!("<m-video>{video}</m-video>");
    }
    format!("[{}]({})", artifact.name, artifact.uri)
}

#[cfg(test)]
mod test {
    use super::*;

    fn collected(name: &str, mime_type: &str) -> CollectedArtifact {
        CollectedArtifact {
            key: format!("artifacts/{name}@2026-09-16T00:00:00Z"),
            name: name.to_owned(),
            mime_type: mime_type.to_owned(),
            uri: format!("https://files.macro.com/{name}"),
            size_bytes: 12,
        }
    }

    #[test]
    fn images_inline_videos_embed_and_the_rest_link() {
        let markdown = artifact_markdown(&[
            collected("shot.png", "image/png"),
            collected("walkthrough.mp4", "video/mp4"),
            collected("notes.txt", "text/plain"),
        ]);
        assert_eq!(
            markdown,
            "\n\n![shot.png](https://files.macro.com/shot.png)\
             \n\n<m-video>{\"url\":\"https://files.macro.com/walkthrough.mp4\",\"srcType\":\"url\"}</m-video>\
             \n\n[notes.txt](https://files.macro.com/notes.txt)"
        );
    }

    #[test]
    fn an_opaque_served_type_falls_back_to_the_extension() {
        assert_eq!(
            mime_type("shot.png", Some("binary/octet-stream")),
            "image/png"
        );
        assert_eq!(mime_type("shot.png", Some("")), "image/png");
        assert_eq!(mime_type("clip.mov", None), "video/quicktime");
        assert_eq!(mime_type("mystery.bin", None), "application/octet-stream");
        assert_eq!(mime_type("shot.png", Some("image/webp")), "image/webp");
    }

    #[test]
    fn a_listing_keys_on_path_and_write_time() {
        let listing = ArtifactListing {
            path: "artifacts/shot.png".into(),
            size_bytes: 1,
            updated_at: "2026-09-16T00:00:00Z".into(),
        };
        assert_eq!(listing.key(), "artifacts/shot.png@2026-09-16T00:00:00Z");
        assert_eq!(listing.name(), "shot.png");
    }
}
