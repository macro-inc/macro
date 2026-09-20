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
    /// UTF-8 body when this file can be shown as a code block. Absent for
    /// images, videos, and anything we could not decode or that was too
    /// large to put in the journal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
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

/// The largest text body we will copy into the journal for an inline
/// preview. Bigger files stay a link; the bytes are already re-hosted.
const MAX_INLINE_TEXT_BYTES: usize = 1024 * 1024;

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
/// which is what Macro's document format renders a player from; text files
/// whose body we kept become a fenced `txt` code block; everything else is
/// a link, which is the honest rendering of a file nobody can preview.
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
    if let Some(text) = &artifact.text {
        return fenced_txt_block(text);
    }
    format!("[{}]({})", artifact.name, artifact.uri)
}

/// The UTF-8 body to keep on a collected artifact, when the file is a
/// text preview the conversation can show as a code block.
#[must_use]
pub fn inline_text(name: &str, mime_type: &str, bytes: &[u8]) -> Option<String> {
    if !is_inlineable_text(name, mime_type) || bytes.len() > MAX_INLINE_TEXT_BYTES {
        return None;
    }
    String::from_utf8(bytes.to_vec()).ok()
}

fn is_inlineable_text(name: &str, mime_type: &str) -> bool {
    let base = mime_type
        .split(';')
        .next()
        .unwrap_or(mime_type)
        .trim()
        .to_ascii_lowercase();
    if base == "text/plain" {
        return true;
    }
    matches!(
        name.rsplit('.')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "txt" | "log"
    )
}

/// A fenced `txt` block whose fence is longer than any backtick run in
/// `content`, so a file that itself contains fences still parses as one
/// block.
fn fenced_txt_block(content: &str) -> String {
    let fence = code_fence(content);
    if content.ends_with('\n') {
        format!("{fence}txt\n{content}{fence}")
    } else {
        format!("{fence}txt\n{content}\n{fence}")
    }
}

fn code_fence(content: &str) -> String {
    let mut longest = 2;
    let mut run = 0usize;
    for ch in content.chars() {
        if ch == '`' {
            run += 1;
            longest = longest.max(run);
        } else {
            run = 0;
        }
    }
    "`".repeat(longest + 1)
}

#[cfg(test)]
mod test {
    use super::*;

    fn collected(name: &str, mime_type: &str) -> CollectedArtifact {
        collected_text(name, mime_type, None)
    }

    fn collected_text(name: &str, mime_type: &str, text: Option<&str>) -> CollectedArtifact {
        CollectedArtifact {
            key: format!("artifacts/{name}@2026-09-16T00:00:00Z"),
            name: name.to_owned(),
            mime_type: mime_type.to_owned(),
            uri: format!("https://files.macro.com/{name}"),
            size_bytes: 12,
            text: text.map(str::to_owned),
        }
    }

    #[test]
    fn images_inline_videos_embed_text_fences_and_the_rest_link() {
        let markdown = artifact_markdown(&[
            collected("shot.png", "image/png"),
            collected("walkthrough.mp4", "video/mp4"),
            collected_text("notes.txt", "text/plain", Some("hello\nworld")),
            collected("bundle.zip", "application/zip"),
        ]);
        assert_eq!(
            markdown,
            "\n\n![shot.png](https://files.macro.com/shot.png)\
             \n\n<m-video>{\"url\":\"https://files.macro.com/walkthrough.mp4\",\"srcType\":\"url\"}</m-video>\
             \n\n```txt\nhello\nworld\n```\
             \n\n[bundle.zip](https://files.macro.com/bundle.zip)"
        );
    }

    #[test]
    fn a_text_file_without_a_kept_body_stays_a_link() {
        assert_eq!(
            artifact_markdown(&[collected("notes.txt", "text/plain")]),
            "\n\n[notes.txt](https://files.macro.com/notes.txt)"
        );
    }

    #[test]
    fn a_fence_inside_the_file_does_not_close_the_block() {
        let markdown = artifact_markdown(&[collected_text(
            "notes.txt",
            "text/plain",
            Some("already\n```\nfenced"),
        )]);
        assert_eq!(markdown, "\n\n````txt\nalready\n```\nfenced\n````");
    }

    #[test]
    fn plain_text_bytes_are_kept_and_the_rest_are_not() {
        assert_eq!(
            inline_text("notes.txt", "text/plain", b"hello"),
            Some("hello".into())
        );
        assert_eq!(
            inline_text("notes.txt", "text/plain; charset=utf-8", b"hello"),
            Some("hello".into())
        );
        assert_eq!(
            inline_text("trace.log", "application/octet-stream", b"log"),
            Some("log".into())
        );
        assert_eq!(inline_text("shot.png", "image/png", b"png"), None);
        assert_eq!(inline_text("notes.txt", "text/plain", b"\xff"), None);
        assert_eq!(
            inline_text(
                "notes.txt",
                "text/plain",
                &vec![b'x'; MAX_INLINE_TEXT_BYTES + 1]
            ),
            None
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
